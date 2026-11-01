import { createReadStream } from 'node:fs';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { ingestArchive } from '../../worker/archive';
import { referenceIngest } from './reference';

const [mode, filename, parallel = '4'] = process.argv.slice(2);
if (!filename || !['legacy', 'native'].includes(mode)) {
  throw new Error('Usage: npm run benchmark:ingest -- <legacy|native> <archive.zip> [concurrency]');
}
const directory = await mkdtemp(path.join(os.tmpdir(), 'gitingest-benchmark-'));
let peakRss = process.memoryUsage().rss;
const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 10);
const started = performance.now();
try {
  const options = { owner: 'honeypie3301', repo: 'Mods-Source-C0de', branch: 'main', concurrency: Number(parallel) };
  let digestHash: string;
  let result: { files_analyzed: number; total_chars: number };
  if (mode === 'legacy') {
    const legacy = await referenceIngest(await readFile(filename), options);
    digestHash = createHash('sha256').update(legacy.digest).digest('hex');
    result = legacy;
  } else {
    const digestFile = path.join(directory, 'digest.txt');
    result = await ingestArchive(filename, path.join(directory, 'content.txt'), digestFile, options);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(digestFile)) hash.update(chunk);
    digestHash = hash.digest('hex');
  }
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  console.log(JSON.stringify({ mode, concurrency: mode === 'native' ? Number(parallel) : 1, milliseconds: Math.round(performance.now() - started), peak_rss_mib: Math.round(peakRss / 1024 ** 2), files: result.files_analyzed, characters: result.total_chars, sha256: digestHash }));
} finally {
  clearInterval(sampler);
  await rm(directory, { recursive: true, force: true });
}
