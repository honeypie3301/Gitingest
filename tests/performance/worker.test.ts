import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { createWorkerApp } from '../../worker/server';
import { referenceIngest } from './reference';

test('worker jobs, authenticated access, caching, downloads, cancellation and restart recovery', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gitingest-worker-test-'));
  const previous = { ...process.env };
  process.env.INGEST_WORKER_SECRET = 'test-worker-secret';
  process.env.INGEST_WORKER_PUBLIC_URL = 'https://worker.invalid';
  process.env.INGEST_DATA_DIR = root;
  delete process.env.INGEST_S3_BUCKET;
  await mkdir(path.join(root, 'jobs'));
  const interruptedId = '00000000-0000-0000-0000-000000000000';
  await writeFile(path.join(root, 'jobs', interruptedId + '.json'), JSON.stringify({ id: interruptedId, state: 'running', key: 'a'.repeat(64) }));
  const zip = new JSZip(); zip.file('root/a.txt', 'hello 世界\n');
  const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const realFetch = globalThis.fetch;
  let githubCalls = 0; let downloads = 0;
  let commit = 'a'.repeat(40);
  let broken = false; let blocked = false;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    if (!url.startsWith('https://api.github.com/')) return realFetch(input, init);
    githubCalls++;
    if (url.includes('/zipball/')) {
      downloads++;
      if (blocked) return new Response(new ReadableStream({ start() {} }));
      return new Response(new Uint8Array(broken ? Buffer.from('bad zip') : archive));
    }
    if (url.includes('/commits/')) return Response.json({ sha: commit });
    return Response.json({ default_branch: 'main' });
  }) as typeof fetch;
  const app = await createWorkerApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Authorization: 'Bearer test-worker-secret', 'Content-Type': 'application/json' };
  const submit = async (body: any = {}) => {
    const response = await realFetch(`${base}/jobs`, { method: 'POST', headers, body: JSON.stringify({ input_text: 'owner/repo', token: 'private-test-token', ...body }) });
    assert.ok(response.ok); return response.json();
  };
  const poll = async (id: string) => {
    for (let i = 0; i < 300; i++) {
      const job = await (await realFetch(`${base}/jobs/${id}`, { headers })).json();
      if (['completed', 'failed', 'cancelled'].includes(job.state)) return job;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Job did not terminate');
  };
  t.after(async () => {
    globalThis.fetch = realFetch;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });

  await t.test('unauthenticated worker requests are rejected', async () => {
    assert.equal((await realFetch(`${base}/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  });
  await t.test('interrupted jobs report a retryable failure after restart', async () => {
    const job = await (await realFetch(`${base}/jobs/${interruptedId}`, { headers })).json();
    assert.equal(job.state, 'failed'); assert.match(job.error, /restarted/);
  });
  let first: any;
  await t.test('cold ingestion downloads one archive and produces an exact complete digest', async () => {
    first = await poll((await submit()).id);
    assert.equal(first.state, 'completed');
    assert.equal(githubCalls, 3); assert.equal(downloads, 1);
    const url = new URL(first.result.artifact_url);
    const response = await realFetch(base + url.pathname + url.search);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition')!, /owner_repo_digest\.txt/);
    const expected = await referenceIngest(archive, { owner: 'owner', repo: 'repo', branch: 'main' });
    assert.equal(await response.text(), expected.digest);
    assert.equal((await realFetch(base + url.pathname + '?expires=1&signature=invalid')).status, 403);
    assert.ok(!JSON.stringify(first).includes('private-test-token'));
  });
  await t.test('an identical request skips archive transfer and decoding', async () => {
    const cached = await submit();
    assert.equal(cached.state, 'completed'); assert.equal(cached.timings.cache_hit, 1);
    assert.equal(downloads, 1);
  });
  await t.test('changing filters reuses the same commit archive', async () => {
    const changed = await poll((await submit({ pattern: '*.txt', pattern_type: 'include' })).id);
    assert.equal(changed.state, 'completed'); assert.equal(changed.timings.archive_cache_hit, 1);
    assert.equal(downloads, 1);
  });
  await t.test('duplicate queued jobs share their completed export without corrupting it', async () => {
    const before = downloads;
    const jobs = await Promise.all([submit({ pattern: 'a.txt', pattern_type: 'include' }), submit({ pattern: 'a.txt', pattern_type: 'include' })]);
    const results = await Promise.all(jobs.map(job => poll(job.id)));
    assert.ok(results.every(job => job.state === 'completed'));
    assert.equal(downloads, before);
    assert.equal(results[0].key, results[1].key);
  });
  await t.test('a failed archive is not published or cached as success', async () => {
    commit = 'b'.repeat(40); broken = true;
    const job = await poll((await submit()).id);
    assert.equal(job.state, 'failed');
    assert.ok(!job.result);
    broken = false;
    const retry = await poll((await submit()).id);
    assert.equal(retry.state, 'completed');
  });
  await t.test('cancellation aborts a pending transfer without affecting a completed export', async () => {
    commit = 'c'.repeat(40); blocked = true;
    const job = await submit();
    const cancel = await realFetch(`${base}/jobs/${job.id}`, { method: 'DELETE', headers });
    assert.equal(cancel.status, 200);
    assert.equal((await poll(job.id)).state, 'cancelled');
    blocked = false;
    assert.equal((await (await realFetch(`${base}/jobs/${first.id}`, { headers })).json()).state, 'completed');
    assert.ok(!(await readdir(path.join(root, 'archives'))).some(name => name.endsWith('.part')));
  });
});
