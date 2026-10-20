import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsePackageFundingMetadata, parseRegistryMetadata, validateModel } from '../dist/index.js';

const fixture = (relativePath) => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${relativePath}`, import.meta.url)), 'utf8'));
const observedAt = '2026-10-08T12:00:00.000Z';

const recordedProviders = [
  {
    ecosystem: 'npm',
    metadata: 'metadata/npm.json',
    funding: 'funding/npm-funded.json',
    source: 'https://registry.npmjs.org/@scope%2Ffixture-package',
    metadataParser: 'npm-registry',
  },
  {
    ecosystem: 'pypi',
    metadata: 'metadata/pypi.json',
    funding: 'funding/pypi-funded.json',
    source: 'https://pypi.org/pypi/fixture-package/json',
    metadataParser: 'pypi-json',
  },
  {
    ecosystem: 'cargo',
    metadata: 'metadata/cargo.json',
    funding: 'funding/cargo-funded.json',
    source: 'https://crates.io/api/v1/crates/fixture-crate',
    metadataParser: 'crates-api',
  },
];

test('recorded registry responses preserve provider provenance and observation time', () => {
  for (const provider of recordedProviders) {
    const context = { source: provider.source, observedAt, parser: provider.metadataParser };
    const result = parseRegistryMetadata(provider.ecosystem, fixture(provider.metadata), context);

    assert.equal(result.diagnostics.length, 0, provider.ecosystem);
    assert.equal(result.evidence.length, 1, provider.ecosystem);
    assert.equal(result.evidence[0].source, provider.source);
    assert.equal(result.evidence[0].observedAt, observedAt);
    assert.equal(result.evidence[0].parser, provider.metadataParser);
    assert.deepEqual(result.evidence[0].value, fixture(provider.metadata));
    for (const evidence of result.evidence) assert.doesNotThrow(() => validateModel(evidence));
  }
});

test('recorded provider funding responses retain declared URLs without treating them as verified identities', () => {
  for (const provider of recordedProviders) {
    const result = parsePackageFundingMetadata(
      provider.ecosystem,
      fixture(provider.funding),
      { source: provider.source, observedAt, parser: `${provider.ecosystem}-funding` },
    );

    assert.ok(result.sources.length > 0, provider.ecosystem);
    assert.equal(result.diagnostics.length, 0, provider.ecosystem);
    assert.ok(result.sources.every((source) => source.evidenceIds.length > 0));
    assert.ok(result.evidence.every((evidence) => evidence.observedAt === observedAt));
    assert.ok(result.sources.every((source) => source.url.startsWith('https://')));
    for (const source of result.sources) assert.doesNotThrow(() => validateModel(source));
  }
});

test('recorded observations are explicit snapshots and do not silently become current truth', () => {
  const first = parseRegistryMetadata('npm', fixture('metadata/npm.json'), {
    source: 'https://registry.npmjs.org/@scope%2Ffixture-package',
    observedAt: '2026-10-08T12:00:00.000Z',
    parser: 'npm-registry',
  });
  const later = parseRegistryMetadata('npm', fixture('metadata/npm.json'), {
    source: 'https://registry.npmjs.org/@scope%2Ffixture-package',
    observedAt: '2026-10-20T12:00:00.000Z',
    parser: 'npm-registry',
  });

  assert.notEqual(first.evidence[0].observedAt, later.evidence[0].observedAt);
  assert.deepEqual(first.evidence[0].value, later.evidence[0].value);
});
