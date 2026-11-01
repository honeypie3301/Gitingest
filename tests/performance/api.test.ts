import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import handler from '../../api/ingest';
import verifyAuth from '../../api/verify-auth';
import { referenceIngest } from './reference';

test('synchronous Vercel handler retains full legacy output without configuring a worker', async t => {
  const realFetch = globalThis.fetch;
  const workerUrl = process.env.INGEST_WORKER_URL;
  delete process.env.INGEST_WORKER_URL;
  t.after(() => {
    globalThis.fetch = realFetch;
    if (workerUrl === undefined) delete process.env.INGEST_WORKER_URL; else process.env.INGEST_WORKER_URL = workerUrl;
  });
  const zip = new JSZip(); zip.file('root/a.txt', 'text 🌍\n'.repeat(40_000));
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const key = process.env.OWNER_ACCESS_KEY || process.env.OWNER_PASSPHRASE || 'honeypie3301-84184414';
  const request = { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: { input_text: 'owner/repo/tree/main' } };
  let status = 200; let payload: any;
  const response = { status(value: number) { status = value; return this; }, json(value: unknown) { payload = value; return this; } };
  await t.test('complete JSON content, summary, tree and counts match the original', async () => {
    globalThis.fetch = (async () => new Response(new Uint8Array(bytes))) as typeof fetch;
    await handler(request, response);
    const expected = await referenceIngest(bytes, { owner: 'owner', repo: 'repo', branch: 'main' });
    assert.equal(status, 200);
    assert.equal(payload.summary, expected.summary);
    assert.equal(payload.content, expected.content);
    assert.equal(payload.tree, expected.tree);
    assert.equal(payload.files_analyzed, expected.files_analyzed);
    assert.equal(payload.total_chars, expected.total_chars);
    assert.deepEqual(Object.keys(payload).sort(), ['summary', 'tree', 'content', 'repo_name', 'files_analyzed', 'estimated_tokens', 'total_chars'].sort());
  });
  await t.test('archive rate limits are returned as 429 without an Unauthorized prefix', async () => {
    globalThis.fetch = (async () => Response.json({ message: 'API rate limit exceeded' }, { status: 403, headers: { 'x-ratelimit-remaining': '0' } })) as typeof fetch;
    await handler(request, response);
    assert.equal(status, 429); assert.match(payload.error, /rate limit/); assert.doesNotMatch(payload.error, /Unauthorized/);
  });
  await t.test('owner verification does not make another fallback request after a rate limit', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return Response.json({ message: 'API rate limit exceeded' }, { status: 403, headers: { 'x-ratelimit-remaining': '0' } });
    }) as typeof fetch;
    await verifyAuth({ method: 'POST', body: { auth: 'limited-test-pat' } }, response);
    assert.equal(status, 429); assert.match(payload.error, /rate limit/); assert.equal(calls, 1);
  });
});
