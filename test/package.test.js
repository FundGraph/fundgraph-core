import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('package metadata identifies the public repository and supported runtime', () => {
  assert.equal(packageJson.name, '@fundgraph/core');
  assert.equal(packageJson.version, '0.1.2');
  assert.equal(packageJson.repository.url, 'https://github.com/FundGraph/fundgraph-core.git');
  assert.equal(packageJson.homepage, 'https://github.com/FundGraph/fundgraph-core#readme');
  assert.equal(packageJson.bugs.url, 'https://github.com/FundGraph/fundgraph-core/issues');
  assert.equal(packageJson.engines.node, '>=20');
  assert.equal(packageJson.publishConfig.access, 'public');
});
