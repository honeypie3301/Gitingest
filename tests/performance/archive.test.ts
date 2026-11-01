import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { ingestArchive, type ArchiveOptions } from '../../worker/archive';
import { buildAsciiTree } from '../../src/services/ingestFormatting';
import { referenceIngest } from './reference';

const base: ArchiveOptions = { owner: 'owner', repo: 'repo', branch: 'main' };

export async function fixture() {
  const zip = new JSZip();
  zip.file('root/src/2.java', 'class Two {}\r\n');
  zip.file('root/src/10.java', 'class Ten {}\n');
  zip.file('root/data/中文.json', '{"text":"世界 🌍"}\n');
  zip.file('root/empty.txt', '');
  zip.file('root/README.md', '# README');
  zip.file('root/binary.unknown', Buffer.from([0, 1, 2, 3]));
  zip.file('root/asset.png', Buffer.from([1, 2, 3]));
  zip.file('root/.git/config', 'hidden');
  zip.file('root/large.txt', 'a'.repeat(2048));
  zip.file('root/unicode.txt', '界'.repeat(700));
  zip.file('root/malformed.txt', Buffer.from([0xe2, 0x28, 0xa1]));
  zip.file('root/control-\x7f.txt', 'ASCII DEL in a filename');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

test('native ingestion preserves legacy selection, order, formatting, Unicode and metrics', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gitingest-output-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const archive = path.join(directory, 'fixture.zip');
  const bytes = await fixture();
  await writeFile(archive, bytes);
  const scenarios: Partial<ArchiveOptions>[] = [
    {}, { pattern: '*.md, data/', pattern_type: 'exclude' },
    { pattern: '*.java, *.json', pattern_type: 'include' },
    { pattern: '[', pattern_type: 'include' }, { subpath: 'src' },
    { max_file_size: 1024 / 1024 / 1024 }, { max_file_size: 0 },
    { pattern: 'missing', pattern_type: 'include' },
  ];
  for (const [index, scenario] of scenarios.entries()) {
    await t.test(JSON.stringify(scenario), async () => {
      const options = { ...base, ...scenario };
      const expected = await referenceIngest(bytes, options);
      const digestPath = path.join(directory, `digest-${index}.txt`);
      const actual = await ingestArchive(archive, path.join(directory, `content-${index}.txt`), digestPath, options);
      assert.equal(await readFile(digestPath, 'utf8'), expected.digest);
      for (const field of ['summary', 'tree', 'content', 'files_analyzed', 'total_chars'] as const) assert.equal(actual[field], expected[field]);
      assert.equal(actual.content_offset, expected.summary.length + expected.tree.length + 4);
    });
  }
});

test('tree retains original directory-first order and connector formatting', () => {
  assert.equal(buildAsciiTree('repo', ['z.txt', 'b/2.txt', 'a/first.txt', 'b/1.txt']),
    '└── repo/\n    ├── a/\n    │   └── first.txt\n    ├── b/\n    │   ├── 1.txt\n    │   └── 2.txt\n    └── z.txt\n');
});

test('large previews do not truncate exported content or tree', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gitingest-preview-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const zip = new JSZip();
  zip.file('root/a.txt', 'z'.repeat(250_000));
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await writeFile(path.join(directory, 'archive.zip'), bytes);
  const result = await ingestArchive(path.join(directory, 'archive.zip'), path.join(directory, 'content'), path.join(directory, 'digest'), base);
  assert.equal(result.content.length, 200_000);
  assert.equal(result.content_preview_truncated, true);
  const expected = await referenceIngest(bytes, base);
  assert.equal(await readFile(path.join(directory, 'digest'), 'utf8'), expected.digest);
  const full = await ingestArchive(path.join(directory, 'archive.zip'), path.join(directory, 'content2'), path.join(directory, 'digest2'), { ...base, preview_chars: Number.MAX_SAFE_INTEGER });
  assert.equal(full.content, expected.content);
});

test('corrupt archives and cancelled ingestions fail rather than report partial success', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gitingest-errors-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const archive = path.join(directory, 'archive.zip');
  await writeFile(archive, 'not a zip');
  await assert.rejects(ingestArchive(archive, path.join(directory, 'content'), path.join(directory, 'digest'), base));
  await writeFile(archive, await fixture());
  await assert.rejects(ingestArchive(archive, path.join(directory, 'content'), path.join(directory, 'digest'), { ...base, signal: AbortSignal.abort() }), { name: 'AbortError' });
});
