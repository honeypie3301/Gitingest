import { open, type FileHandle } from 'node:fs/promises';
import { Readable } from 'node:stream';
import yauzl, { type ZipFile } from 'yauzl';

const BLOCK_BYTES = 1024 * 1024;
const readers = new WeakMap<ZipFile, CachedZipReader>();

/** ZIP metadata uses many tiny reads. Share eight blocks instead of issuing one disk read per field. */
class CachedZipReader extends yauzl.RandomAccessReader {
  private blocks = new Map<number, Promise<Buffer>>();
  constructor(private file: FileHandle, private size: number) { super(); }

  private block(index: number): Promise<Buffer> {
    const cached = this.blocks.get(index);
    if (cached) {
      this.blocks.delete(index); this.blocks.set(index, cached);
      return cached;
    }
    const position = index * BLOCK_BYTES;
    const pending = (async () => {
      const buffer = Buffer.allocUnsafe(Math.min(BLOCK_BYTES, this.size - position));
      let filled = 0;
      while (filled < buffer.length) {
        const { bytesRead } = await this.file.read(buffer, filled, buffer.length - filled, position + filled);
        if (!bytesRead) throw new Error('Unexpected end of ZIP archive');
        filled += bytesRead;
      }
      return buffer;
    })();
    this.blocks.set(index, pending);
    if (this.blocks.size > 8) this.blocks.delete(this.blocks.keys().next().value!);
    return pending;
  }

  private async *range(start: number, end: number) {
    if (start < 0 || end > this.size || end < start) throw new Error('Invalid ZIP range');
    while (start < end) {
      const index = Math.floor(start / BLOCK_BYTES);
      const buffer = await this.block(index);
      const offset = start % BLOCK_BYTES;
      const length = Math.min(buffer.length - offset, end - start);
      yield buffer.subarray(offset, offset + length);
      start += length;
    }
  }

  _readStreamForRange(start: number, end: number) { return Readable.from(this.range(start, end)); }

  async readBytes(start: number, length: number) {
    if (!length) return Buffer.alloc(0);
    const pieces: Buffer[] = [];
    for await (const chunk of this.range(start, start + length)) pieces.push(chunk);
    return pieces.length === 1 ? pieces[0] : Buffer.concat(pieces);
  }

  read(buffer: Buffer, offset: number, length: number, position: number, callback: (error: Error | null) => void) {
    void (async () => {
      for await (const chunk of this.range(position, position + length)) {
        chunk.copy(buffer, offset); offset += chunk.length;
      }
    })().then(() => callback(null), error => callback(error));
  }

  close(callback: (error: Error | null) => void) {
    this.blocks.clear();
    void this.file.close().then(() => callback(null), callback);
  }
}

export async function openCachedZip(filename: string): Promise<ZipFile> {
  const file = await open(filename, 'r');
  try {
    const size = (await file.stat()).size;
    const reader = new CachedZipReader(file, size);
    return await new Promise<ZipFile>((resolve, reject) => {
      yauzl.fromRandomAccessReader(reader, size, { lazyEntries: true, autoClose: false, decodeStrings: false }, (error, zip) => {
        if (error || !zip) reject(error || new Error('Could not open archive'));
        else { readers.set(zip, reader); resolve(zip); }
      });
    });
  } catch (error) {
    await file.close().catch(() => {});
    throw error;
  }
}

export function readZipBytes(zip: ZipFile, position: number, length: number) {
  const reader = readers.get(zip);
  if (!reader) throw new Error('Archive is not open in the cached ZIP reader');
  return reader.readBytes(position, length);
}
