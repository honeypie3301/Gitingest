import { createWriteStream } from 'node:fs';
import { open as openFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { crc32, inflateRawSync } from 'node:zlib';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import type { Entry, ZipFile } from 'yauzl';
import { openCachedZip, readZipBytes } from './zip-reader';
import { buildAsciiTree, formatTokens, isBinaryPath } from '../src/services/ingestFormatting';
import { assertNotRateLimited } from '../src/services/githubRateLimit';

export interface ArchiveOptions {
  owner: string;
  repo: string;
  branch: string;
  subpath?: string;
  pattern?: string;
  pattern_type?: 'include' | 'exclude';
  max_file_size?: number;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (files: number) => void;
  preview_chars?: number;
}

export const PREVIEW_CHARS = 200_000;

export class ArchiveDownloadError extends Error {
  constructor(public status: number) { super(`Repository archive download failed (${status}).`); }
}

function decodeEntryName(entry: Entry): string {
  const raw = entry.fileName as unknown as Buffer;
  let name = raw.toString('utf8');
  if (!(entry.generalPurposeBitFlag & 0x800)) {
    const field = entry.extraFields.filter(field => field.id === 0x7075).at(-1)?.data;
    if (field && field.length >= 5 && field[0] === 1 && field.readUInt32LE(1) === crc32(raw)) name = field.subarray(5).toString('utf8');
  }
  // Match JSZip's path decoding (including ASCII DEL), relative-component resolution and directory flags.
  const parts = name.split('/');
  const resolved: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === '.' || (part === '' && i !== 0 && i !== parts.length - 1)) continue;
    if (part === '..') resolved.pop(); else resolved.push(part);
  }
  name = resolved.join('/');
  if ((entry.externalFileAttributes & 0x10) && !name.endsWith('/')) name += '/';
  return name;
}

export async function downloadArchive(url: string, token: string, destination: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'GitIngest-Personal', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal,
  });
  await assertNotRateLimited(response);
  if (!response.ok || !response.body) throw new ArchiveDownloadError(response.status);
  await pipeline(Readable.fromWeb(response.body as any), createWriteStream(destination), { signal });
}

async function forEachEntry(zip: ZipFile, accept: (entry: Entry) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      zip.off('error', fail);
      zip.off('entry', entry);
      zip.off('end', end);
      signal?.removeEventListener('abort', abort);
    };
    const fail = (error: Error) => { cleanup(); reject(error); };
    const abort = () => fail(new DOMException('Ingestion cancelled', 'AbortError'));
    const entry = (value: Entry) => {
      try {
        value.fileName = decodeEntryName(value);
        accept(value);
      } catch (error) { fail(error as Error); return; }
      zip.readEntry();
    };
    const end = () => { cleanup(); resolve(); };
    zip.on('error', fail).on('entry', entry).on('end', end);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    else zip.readEntry();
  });
}

function readEntry(zip: ZipFile, entry: Entry, signal?: AbortSignal): Promise<string> {
  // Most source files are tiny. Avoid constructing several streams and thread-pool jobs per file.
  if (entry.uncompressedSize <= 256 * 1024 && entry.compressedSize <= 256 * 1024 && !entry.isEncrypted() && [0, 8].includes(entry.compressionMethod)) {
    return new Promise<number>((resolve, reject) => {
      zip.readLocalFileHeader(entry, { minimal: true }, (error, header) => {
        if (error) { reject(error); return; }
        resolve(header.fileDataStart);
      });
    }).then(async position => {
      const compressed = await readZipBytes(zip, position, entry.compressedSize);
      signal?.throwIfAborted();
      const buffer = entry.compressionMethod === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize + 1 });
      if (buffer.length !== entry.uncompressedSize || crc32(buffer) !== entry.crc32) throw new Error('Corrupt ZIP entry');
      return buffer.toString('utf8');
    });
  }
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) { reject(error || new Error('Could not read entry')); return; }
      const abort = () => stream.destroy(new DOMException('Ingestion cancelled', 'AbortError'));
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.once('error', reject);
      stream.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.once('close', () => signal?.removeEventListener('abort', abort));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  });
}

/** Native zlib, bounded decoding, ordered streaming output. No checkout or giant digest string. */
export async function ingestArchive(archive: string, contentFile: string, digestFile: string, options: ArchiveOptions) {
  const zip = await openCachedZip(archive);
  // Keep an error listener while entry streams run, including between metadata enumeration and reads.
  let archiveError: Error | undefined;
  const onError = (error: Error) => { archiveError = error; };
  zip.on('error', onError);
  const output = await openFile(contentFile, 'w');
  const maxChars = (options.max_file_size ?? 50) * 1024 * 1024;
  const concurrency = Math.max(1, Math.min(8, Number.isFinite(options.concurrency) ? Math.floor(options.concurrency!) : 4));
  const previewChars = options.preview_chars ?? PREVIEW_CHARS;
  const patterns = (options.pattern || '').split(/[\n,]+/).map(p => p.trim()).filter(Boolean).map(raw => {
    try { return { raw, regex: new RegExp(raw.replace(/\./g, '\\.').replace(/\*/g, '.*'), 'i') }; }
    catch { return { raw, regex: null }; }
  });
  const allowed = (name: string) => {
    if (options.subpath && !name.startsWith(options.subpath)) return false;
    if (!patterns.length) return true;
    const matches = patterns.some(({ regex, raw }) => regex ? regex.test(name) : name.includes(raw));
    return options.pattern_type === 'include' ? matches : !matches;
  };
  let filesAnalyzed = 0;
  let totalChars = 0;
  let contentPreview = '';
  let contentChars = 0;
  let skippedBinary = 0;
  let skippedSize = 0;
  let pendingBlocks: string[] = [];
  let pendingChars = 0;
  let lastYield = performance.now();
  try {
    let prefix: string | undefined;
    // Match JSZip's insertion order and replacement of duplicate entry names.
    const unique = new Map<string, Entry>();
    await forEachEntry(zip, entry => {
      if (prefix === undefined) prefix = entry.fileName.includes('/') ? entry.fileName.split('/')[0] + '/' : '';
      const name = prefix && entry.fileName.startsWith(prefix) ? entry.fileName.slice(prefix.length) : entry.fileName;
      if (entry.fileName.endsWith('/') || !name || name.startsWith('.git/') || isBinaryPath(name) || !allowed(name)) return;
      unique.set(name, entry);
    }, options.signal);
    const entries = Array.from(unique, ([name, entry]) => ({ name, entry }));
    unique.clear();
    const tree = `Directory structure:\n${buildAsciiTree(options.subpath || options.repo, entries.map(item => item.name))}`;
    for (let i = 0; i < entries.length;) {
      if (performance.now() - lastYield > 25) {
        await yieldToEventLoop(undefined, { signal: options.signal });
        lastYield = performance.now();
      }
      options.signal?.throwIfAborted();
      if (archiveError) throw archiveError;
      const batch: typeof entries = [];
      let bytes = 0;
      while (i < entries.length && batch.length < concurrency) {
        const next = entries[i];
        if (batch.length && bytes + next.entry.uncompressedSize > 64 * 1024 * 1024) break;
        batch.push(next); bytes += next.entry.uncompressedSize; i++;
      }
      const results = await Promise.all(batch.map(async ({ entry, name }) => {
        // The legacy size check is UTF-16 character length, not bytes. Do not change Unicode selection.
        if (entry.uncompressedSize > maxChars * 3) return { skip: 'size' as const };
        const content = await readEntry(zip, entry, options.signal);
        if (content.length > maxChars) return { skip: 'size' as const };
        if (content.includes('\0')) return { skip: 'binary' as const };
        return { name, content };
      }));
      for (const result of results) {
        if ('skip' in result) {
          if (result.skip === 'size') skippedSize++; else skippedBinary++;
          continue;
        }
        const block = `${filesAnalyzed ? '\n' : ''}================================================\nFile: ${result.name}\n================================================\n${result.content}\n`;
        pendingBlocks.push(block);
        pendingChars += block.length;
        if (pendingChars >= 1024 * 1024) {
          await output.writeFile(pendingBlocks.join(''), 'utf8');
          pendingBlocks = []; pendingChars = 0;
        }
        if (contentPreview.length < previewChars) contentPreview += block.slice(0, previewChars - contentPreview.length);
        contentChars += block.length;
        totalChars += result.content.length;
        filesAnalyzed++;
      }
      options.onProgress?.(i);
    }
    if (archiveError) throw archiveError;
    if (pendingBlocks.length) await output.writeFile(pendingBlocks.join(''), 'utf8');
    const estimatedTokens = formatTokens(Math.round(totalChars / 4));
    const summary = [
      `Repository: ${options.owner}/${options.repo}`, `Branch: ${options.branch}`,
      options.subpath ? `Subpath: ${options.subpath}` : null,
      `Files analyzed: ${filesAnalyzed}`, `Estimated tokens: ${estimatedTokens}`,
      `Total characters: ${totalChars.toLocaleString()}`,
    ].filter(Boolean).join('\n');
    const header = `${summary}\n\n${tree}\n\n`;
    await output.close();
    const { createReadStream } = await import('node:fs');
    await pipeline(Readable.from((async function* () {
      yield header;
      for await (const chunk of createReadStream(contentFile)) yield chunk;
    })()), createWriteStream(digestFile), { signal: options.signal });
    return {
      summary, tree: tree.slice(0, previewChars), content: contentPreview,
      repo_name: `${options.owner}/${options.repo}`, files_analyzed: filesAnalyzed,
      estimated_tokens: estimatedTokens, total_chars: totalChars,
      content_preview_truncated: contentChars > previewChars,
      tree_preview_truncated: tree.length > previewChars,
      content_offset: header.length, skipped_binary: skippedBinary, skipped_size: skippedSize,
      content_chars: contentChars,
    };
  } finally {
    await output.close().catch(() => {});
    zip.close();
    zip.off('error', onError);
  }
}
