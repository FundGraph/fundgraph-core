import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createReport,
  discoverDependencies,
  parsePackageFundingMetadata,
  parseRegistryMetadata,
  resolveFundingRelationships,
  stableStringify,
} from '../dist/index.js';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const fixture = (path) => JSON.parse(readFileSync(join(fixtures, path), 'utf8'));
const context = (source, parser) => ({ source, observedAt: '2026-10-08T12:00:00.000Z', parser });
const copy = (name) => {
  const destination = mkdtempSync(join(tmpdir(), `fundgraph-integration-${name}-`));
  cpSync(join(fixtures, name), destination, { recursive: true });
  return destination;
};

const ecosystems = [
  { name: 'npm', project: 'npm-workspace', metadata: 'metadata/npm.json', funding: 'funding/npm-funded.json', source: 'https://registry.npmjs.org/@scope%2Ffixture-package', parser: 'npm-registry' },
  { name: 'pypi', project: 'pypi-poetry', metadata: 'metadata/pypi.json', funding: 'funding/pypi-funded.json', source: 'https://pypi.org/pypi/fixture-package/json', parser: 'pypi-json' },
  { name: 'cargo', project: 'cargo-workspace', metadata: 'metadata/cargo.json', funding: 'funding/cargo-funded.json', source: 'https://crates.io/api/v1/crates/fixture-crate', parser: 'crates-api' },
];

test('fixture matrix contains every required Phase 10 category', () => {
  const matrix = fixture('integration/fixture-matrix.json');
  for (const [category, paths] of Object.entries(matrix)) {
    assert.ok(paths.length > 0, `${category} must have a fixture`);
    for (const path of paths) assert.equal(existsSync(join(fixtures, path)), true, `${category}: ${path}`);
  }
});

test('all supported ecosystems pass the complete analysis pipeline', () => {
  const run = (item) => {
    const discovery = discoverDependencies(join(fixtures, item.project));
    assert.ok(discovery.ecosystems.includes(item.name));
    const metadata = parseRegistryMetadata(item.name, fixture(item.metadata), context(item.source, item.parser));
    const funding = parsePackageFundingMetadata(item.name, fixture(item.funding), context(item.source, `${item.name}-funding`));
    assert.equal(metadata.diagnostics.length, 0);
    assert.equal(funding.diagnostics.length, 0);
    assert.ok(metadata.package);
    assert.ok(metadata.repository);
    assert.ok(funding.sources.length > 0);
    const evidence = [...metadata.evidence, ...funding.evidence];
    const resolution = resolveFundingRelationships({
      packages: [metadata.package],
      repositories: metadata.repository ? [metadata.repository] : [],
      fundingSources: funding.sources,
      evidence,
      fundingClaims: funding.sources.map((source) => ({ repositoryId: metadata.repository.id, fundingSourceId: source.id, evidenceIds: source.evidenceIds, ruleId: `${item.name}.funding-metadata` })),
    });
    const report = createReport({
      project: discovery.project,
      dependencies: discovery.graph.nodes,
      registries: [metadata.registry],
      packages: [metadata.package],
      repositories: metadata.repository ? [metadata.repository] : [],
      fundingSources: funding.sources,
      evidence,
      relationships: resolution.relationships,
      diagnostics: [...discovery.diagnostics.map((diagnostic) => diagnostic.message), ...resolution.diagnostics],
    });
    assert.equal(report.summary.contradictoryCount, 0);
    assert.ok(report.summary.supportedCount > 0);
    return report;
  };
  const outputs = ecosystems.map(run);
  const repeat = ecosystems.map(run);
  assert.equal(stableStringify(outputs), stableStringify(repeat));
  assert.equal(outputs.length, 3);
});

test('fixture categories preserve explicit failures and ambiguity', () => {
  const unfunded = parsePackageFundingMetadata('npm', fixture('funding/npm-unfunded.json'), context('https://registry.npmjs.org/unfunded', 'npm-funding'));
  const multiple = parsePackageFundingMetadata('npm', fixture('funding/npm-multiple.json'), context('https://registry.npmjs.org/multiple', 'npm-funding'));
  const missing = parseRegistryMetadata('npm', fixture('metadata/npm-missing-repository.json'), context('https://registry.npmjs.org/missing', 'npm-registry'));
  const contradictory = parsePackageFundingMetadata('npm', fixture('metadata/npm-contradictory.json'), context('https://registry.npmjs.org/contradictory', 'npm-funding'));
  assert.equal(unfunded.sources.length, 0);
  assert.equal(multiple.sources.length, 3);
  assert.equal(missing.repository, undefined);
  assert.equal(contradictory.sources.length, 2);
  const malformed = discoverDependencies(copy('malformed-lock'));
  assert.ok(malformed.diagnostics.some((item) => item.code === 'MALFORMED_LOCKFILE'));
});
