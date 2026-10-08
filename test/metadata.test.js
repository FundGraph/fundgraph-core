import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseRegistryMetadata, stableStringify, validateModel } from '../dist/index.js';

const fixture = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/metadata/${name}.json`, import.meta.url)), 'utf8'));
const context = (source, parser) => ({ source, observedAt: '2026-10-08T12:00:00.000Z', parser });

test('normalizes npm scoped package metadata and alternate repository URL forms', () => {
  const result = parseRegistryMetadata('npm', fixture('npm'), context('https://registry.npmjs.org/@scope%2Ffixture-package', 'npm-registry'));
  assert.equal(result.registry.id, 'registry:npm');
  assert.equal(result.package?.id, 'npm:@scope/fixture-package');
  assert.equal(result.package?.version, '1.2.3');
  assert.equal(result.repository?.url, 'https://github.com/ExampleOrg/Fixture');
  assert.equal(result.repository?.host, 'github.com');
  assert.equal(result.evidence[0]?.observedAt, '2026-10-08T12:00:00.000Z');
  assert.deepEqual(result.evidence[0]?.value, fixture('npm'));
});

test('normalizes PyPI project URLs and Cargo repository metadata', () => {
  const pypi = parseRegistryMetadata('pypi', fixture('pypi'), context('https://pypi.org/pypi/fixture-package/json', 'pypi-json'));
  const cargo = parseRegistryMetadata('cargo', fixture('cargo'), context('https://crates.io/api/v1/crates/fixture-crate', 'crates-api'));
  assert.equal(pypi.package?.id, 'pypi:fixture-package');
  assert.equal(pypi.repository?.url, 'https://github.com/ExampleOrg/Fixture');
  assert.equal(cargo.package?.id, 'cargo:fixture-crate');
  assert.equal(cargo.package?.version, '3.4.5');
  for (const model of [pypi.registry, pypi.package, pypi.repository, ...pypi.evidence, cargo.registry, cargo.package, cargo.repository, ...cargo.evidence]) {
    if (model) assert.doesNotThrow(() => validateModel(model));
  }
});

test('metadata normalization is deterministic and preserves malformed-source diagnostics', () => {
  const payload = { name: 'fixture', version: '1.0.0', repository: 'https://github.com/example/fixture.git' };
  const first = parseRegistryMetadata('npm', payload, context('https://registry.npmjs.org/fixture', 'npm-registry'));
  const second = parseRegistryMetadata('npm', payload, context('https://registry.npmjs.org/fixture', 'npm-registry'));
  assert.equal(stableStringify(first), stableStringify(second));
  const missing = parseRegistryMetadata('npm', { version: '1.0.0' }, context('https://registry.npmjs.org/missing', 'npm-registry'));
  assert.ok(missing.diagnostics.some((item) => item.code === 'MISSING_METADATA_FIELD'));
  const unsafe = parseRegistryMetadata('npm', payload, context('http://evil.example/fixture', 'npm-registry'));
  assert.ok(unsafe.diagnostics.some((item) => item.code === 'UNSAFE_METADATA_SOURCE'));
  const large = parseRegistryMetadata('npm', payload, { ...context('https://registry.npmjs.org/fixture', 'npm-registry'), maxPayloadBytes: 10 });
  assert.ok(large.diagnostics.some((item) => item.code === 'PAYLOAD_TOO_LARGE'));
});

