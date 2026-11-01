import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performIngest, verifyAuthWithServer } from '../../src/services/ingest';
import { waitForWorkerJob } from '../../src/services/workerJobs';
import { fullDigestSection, artifactUrl } from '../../src/services/digestExport';
import { ingestViaGitHubApi } from '../../src/services/githubApi';
import { githubRateLimitMessage } from '../../src/services/githubRateLimit';
import type { IngestResponse } from '../../src/types';

test('client output, job and rate-limit behavior', async t => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  const result: IngestResponse = { summary: 'summary', tree: 'tree', content: 'content' };
  await t.test('legacy copying still returns each exact complete section', async () => {
    assert.equal(await fullDigestSection(result, 'all'), 'summary\n\ntree\n\ncontent');
    assert.equal(await fullDigestSection(result, 'tree'), 'tree');
    assert.equal(await fullDigestSection(result, 'content'), 'content');
  });
  await t.test('worker copying fetches the complete tree, content and digest using character offsets', async () => {
    const full = 'summary\n\n完整 tree\n\nfull content 🌍';
    const remote = { ...result, tree: '完整', content: 'full', tree_preview_truncated: true, content_preview_truncated: true, content_offset: full.indexOf('full content'), artifact_url: 'https://storage.invalid/old', refreshArtifactUrl: async () => 'https://storage.invalid/refreshed' };
    globalThis.fetch = (async (url: any) => { assert.equal(url, 'https://storage.invalid/refreshed'); return new Response(full); }) as typeof fetch;
    assert.equal(await fullDigestSection(remote, 'all'), full);
    assert.equal(await fullDigestSection(remote, 'tree'), '完整 tree');
    assert.equal(await fullDigestSection(remote, 'content'), 'full content 🌍');
    assert.equal(await artifactUrl(remote), 'https://storage.invalid/refreshed');
  });
  await t.test('completed jobs return immediately and refresh download links on demand', async () => {
    const id = '00000000-0000-0000-0000-000000000001';
    const headers = { Authorization: 'Bearer owner-token' };
    globalThis.fetch = (async (url: any, init: any) => {
      assert.equal(url, `/api/ingest/jobs/${id}`); assert.equal(init.headers.Authorization, headers.Authorization);
      return Response.json({ state: 'completed', result: { ...result, artifact_url: 'https://storage.invalid/new' } });
    }) as typeof fetch;
    const completed = await waitForWorkerJob({ id, state: 'completed', result }, headers);
    assert.equal(completed.content, result.content);
    assert.equal(await completed.refreshArtifactUrl!(), 'https://storage.invalid/new');
  });
  await t.test('backend failures and rate limits never start browser ingestion', async () => {
    for (const status of [403, 429, 500, 502, 504]) {
      let requests = 0;
      globalThis.fetch = (async () => { requests++; return Response.json({ error: 'GitHub API rate limit exceeded.' }, { status }); }) as typeof fetch;
      await assert.rejects(performIngest({ input_text: 'owner/repo' }), /rate limit/);
      assert.equal(requests, 1);
    }
  });
  await t.test('plain-text platform failures explain server failure instead of reporting JSON syntax errors', async () => {
    let requests = 0;
    globalThis.fetch = (async () => {
      requests++;
      return new Response('A server error has occurred\n\nFUNCTION_INVOCATION_FAILED', { status: 500, headers: { 'content-type': 'text/plain' } });
    }) as typeof fetch;
    const auth = await verifyAuthWithServer('new-test-token');
    assert.equal(auth.success, false);
    assert.match(auth.error!, /HTTP 500.*server function failed/);
    assert.doesNotMatch(auth.error!, /Unexpected token|not valid JSON|invalid token/i);
    await assert.rejects(performIngest({ input_text: 'owner/repo' }), /HTTP 500.*server function failed/);
    assert.equal(requests, 2);
  });
  await t.test('HTML and malformed JSON responses do not expose raw markup or parsing errors', async () => {
    for (const body of ['<html><body>Bad Gateway</body></html>', '{"success":', '']) {
      globalThis.fetch = (async () => new Response(body, { status: 502 })) as typeof fetch;
      const auth = await verifyAuthWithServer('new-test-token');
      assert.equal(auth.success, false);
      assert.match(auth.error!, /HTTP 502/);
      assert.doesNotMatch(auth.error!, /<html>|Unexpected token|not valid JSON/i);
    }
  });
  await t.test('structured backend errors never cause another ingestion even if they mention fetch or 404', async () => {
    for (const error of ['fetch failed', 'Repository not found (404)']) {
      let requests = 0;
      globalThis.fetch = (async () => { requests++; return Response.json({ error }, { status: 502 }); }) as typeof fetch;
      await assert.rejects(performIngest({ input_text: 'owner/repo' }));
      assert.equal(requests, 1);
    }
  });
  await t.test('cancellation submits an explicit cancellation request', async () => {
    const requests: string[] = [];
    globalThis.fetch = (async (_url: any, init: any) => { requests.push(init.method); return Response.json({ cancelled: true }); }) as typeof fetch;
    const controller = new AbortController();
    const waiting = waitForWorkerJob({ id: '00000000-0000-0000-0000-000000000001', state: 'running' }, {}, controller.signal);
    controller.abort();
    await assert.rejects(waiting, { name: 'AbortError' });
    assert.deepEqual(requests, ['DELETE']);
  });
  await t.test('browser fallback refuses truncated or large file trees before per-file calls', async () => {
    for (const tree of [{ truncated: true, tree: [] }, { tree: Array.from({ length: 1001 }, (_, i) => ({ type: 'blob', path: `${i}.json`, sha: String(i), size: 1 })) }]) {
      let fileRequests = 0;
      globalThis.fetch = (async (url: any) => {
        if (String(url).includes('/zipball/')) return new Response('', { status: 404 });
        if (String(url).includes('/git/trees/')) return Response.json(tree);
        fileRequests++; return new Response('unexpected');
      }) as typeof fetch;
      await assert.rejects(ingestViaGitHubApi({ input_text: 'owner/repo/tree/main' }, 'pat'), /truncated|too large/);
      assert.equal(fileRequests, 0);
    }
  });
  await t.test('primary and secondary GitHub limits include reset information when available', async () => {
    const message = await githubRateLimitMessage(Response.json({ message: 'API rate limit exceeded' }, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1793518850' } }));
    assert.match(message!, /Retry after .*Z/);
    assert.match((await githubRateLimitMessage(Response.json({ message: 'secondary rate limit' }, { status: 403 })))!, /rate limit/);
    assert.equal(await githubRateLimitMessage(Response.json({ message: 'Forbidden' }, { status: 403 })), undefined);
  });
});
