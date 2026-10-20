import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeProject, NetworkClient } from '../dist/index.js';

test('analyzeProject orchestrates discovery, registry metadata, funding evidence, resolution, and reporting', async () => {
  const project = mkdtempSync(join(tmpdir(), 'fundgraph-analysis-'));
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'analysis-fixture', dependencies: { 'fixture-package': '^1.0.0' } }));
  writeFileSync(join(project, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/fixture-package': { version: '1.2.3' } } }));
  const client = new NetworkClient({
    fetchImpl: async (url) => {
      if (url === 'https://api.github.com/repos/example/fixture-package/contents/.github/FUNDING.yml') {
        return new Response('', { status: 404 });
      }
      assert.equal(url, 'https://registry.npmjs.org/fixture-package/1.2.3');
      return new Response(JSON.stringify({
        name: 'fixture-package',
        version: '1.2.3',
        repository: { type: 'git', url: 'git+https://github.com/example/fixture-package.git' },
        funding: { type: 'github', url: 'https://github.com/sponsors/example' },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    now: () => Date.parse('2026-10-18T12:00:00.000Z'),
  });
  const result = await analyzeProject(project, { network: client });
  assert.equal(result.networkFailures.length, 0);
  assert.equal(result.report.summary.packageCount, 1);
  assert.equal(result.report.summary.fundingSourceCount, 1);
  assert.equal(result.report.summary.evidenceCount, 2);
  assert.equal(result.report.summary.supportedCount, 2);
  assert.equal(result.report.relationships.every((relationship) => relationship.evidenceIds.length > 0), true);
});
