import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FundGraphError, NetworkClient, validateNetworkUrl } from '../dist/index.js';

const response = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...headers },
});

test('network URL policy rejects insecure, credential-bearing, and private destinations', () => {
  for (const url of ['http://example.test/data', 'https://user:secret@example.test/data', 'https://127.0.0.1/data', 'https://localhost/data', 'file:///private']) {
    assert.throws(() => validateNetworkUrl(url), (error) => error instanceof FundGraphError && error.code === 'UNSAFE_URL');
  }
  assert.equal(validateNetworkUrl('http://example.test/data', { allowHttp: true }).protocol, 'http:');
  assert.throws(() => validateNetworkUrl('https://other.test/data', { allowedHosts: ['example.test'] }), /allowlist/);
  assert.equal(validateNetworkUrl('https://api.example.test/data', { allowedHosts: ['example.test'] }).hostname, 'api.example.test');
});

test('redirects are rejected rather than followed', async () => {
  const client = new NetworkClient({ fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://attacker.test' } }) });
  await assert.rejects(() => client.json({ url: 'https://example.test/redirect' }), (error) => error instanceof FundGraphError && error.code === 'UNSAFE_URL');
});

test('response size is bounded before JSON parsing completes', async () => {
  const client = new NetworkClient({ fetchImpl: async () => response({ payload: 'this is larger than ten bytes' }) });
  await assert.rejects(() => client.json({ url: 'https://example.test/large', maxResponseBytes: 10 }), (error) => error instanceof FundGraphError && error.code === 'FIELD_TOO_LARGE');
});

test('cache refuses authenticated responses and does not expose credentials in errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fundgraph-security-'));
  const client = new NetworkClient({ fetchImpl: async () => response({ private: true }) });
  const result = await client.json({
    url: 'https://example.test/private',
    init: { headers: { authorization: 'Bearer super-secret-token' } },
    cache: { directory, ttlMs: 60_000 },
  });
  assert.equal(result.diagnostics.at(-1).code, 'CACHE_UNSAFE');
  assert.doesNotMatch(result.diagnostics[0].message, /super-secret-token/);
});
