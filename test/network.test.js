import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FundGraphError, NetworkClient, fetchJsonBatch, invalidateCache } from '../dist/index.js';

const response = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...headers },
});

test('retries 429 with bounded backoff and returns the successful response', async () => {
  let calls = 0;
  const delays = [];
  const client = new NetworkClient({
    fetchImpl: async () => (++calls === 1 ? response({ error: 'slow down' }, 429, { 'retry-after': '0' }) : response({ ok: true })),
    sleep: async (delay) => delays.push(delay),
    random: () => 0,
  });
  const result = await client.json({ url: 'https://example.test/data', retries: 2 });
  assert.deepEqual(result.value, { ok: true });
  assert.equal(result.attempts, 2);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [0]);
  assert.equal(result.diagnostics[0].code, 'RATE_LIMITED');
});

test('does not retry non-retryable HTTP responses', async () => {
  let calls = 0;
  await assert.rejects(() => new NetworkClient({ fetchImpl: async () => { calls += 1; return response({ denied: true }, 401); }, sleep: async () => {} }).json({ url: 'https://example.test/denied', retries: 3 }), (error) => error instanceof FundGraphError && error.code === 'NETWORK_FAILURE');
  assert.equal(calls, 1);
});

test('opt-in cache supports online population and offline replay', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fundgraph-cache-'));
  let calls = 0;
  const client = new NetworkClient({ fetchImpl: async () => { calls += 1; return response({ value: 42 }); } });
  const request = { url: 'https://example.test/cached', cache: { directory, ttlMs: 60_000 } };
  const online = await client.json(request);
  const offline = await client.json({ ...request, offline: true });
  assert.equal(online.source, 'network');
  assert.equal(offline.source, 'cache');
  assert.deepEqual(offline.value, { value: 42 });
  assert.equal(calls, 1);
  assert.equal((await readdir(directory)).length, 1);
  await invalidateCache(request.cache, request.url);
  assert.equal((await readdir(directory)).length, 0);
});

test('corrupt cache is diagnosed online and stale cache is rejected offline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fundgraph-cache-corrupt-'));
  const cache = { directory, ttlMs: 1 };
  const client = new NetworkClient({ fetchImpl: async () => response({ refreshed: true }) });
  const request = { url: 'https://example.test/stale', cache };
  await client.json(request);
  const file = (await readdir(directory))[0];
  assert.ok(file);
  await writeFile(join(directory, file), '{not-json');
  const recovered = await client.json(request);
  assert.equal(recovered.value.refreshed, true);
  assert.equal(recovered.diagnostics[0].code, 'CACHE_CORRUPT');
  await writeFile(join(directory, file), JSON.stringify({ schemaVersion: '1.0', url: request.url, fetchedAt: new Date(0).toISOString(), body: { old: true } }));
  const stale = await client.json({ ...request, offline: true });
  assert.equal(stale.source, 'cache');
  assert.equal(stale.diagnostics[0].code, 'CACHE_STALE');
});

test('batch requests preserve successful partial results and report failures', async () => {
  const result = await fetchJsonBatch([
    { url: 'https://example.test/good' },
    { url: 'https://example.test/bad' },
  ], {
    maxRetries: 0,
    fetchImpl: async (url) => url.endsWith('/good') ? response({ good: true }) : Promise.reject(new Error('connection reset')),
  });
  assert.equal(result.results.length, 1);
  assert.deepEqual(result.results[0].value, { good: true });
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].error, 'NETWORK_FAILURE');
});

test('cancellation is typed and never retried', async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  await assert.rejects(() => new NetworkClient({ fetchImpl: async () => { called = true; return response({}); } }).json({ url: 'https://example.test/cancel', signal: controller.signal }), (error) => error instanceof FundGraphError && error.code === 'CANCELLED');
  assert.equal(called, false);
});
