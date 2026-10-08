import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FundGraphError,
  SCHEMA_VERSION,
  hasContradictoryRelationship,
  serializeModel,
  stableStringify,
  validateModel,
} from '../dist/index.js';

const evidence = {
  schemaVersion: SCHEMA_VERSION,
  kind: 'Evidence',
  id: 'evidence:package-funding',
  evidenceKind: 'package-metadata',
  source: 'https://registry.example.test/package/demo',
  value: { funding: [{ url: 'https://github.com/example/demo' }], package: 'demo' },
};

test('validates every required domain model shape', () => {
  const confidence = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'Confidence',
    id: 'confidence:medium',
    level: 'medium',
    rationale: 'A direct package declaration supports the relationship.',
    evidenceIds: [evidence.id],
  };
  const models = [
    { schemaVersion: SCHEMA_VERSION, kind: 'Project', id: 'project:demo', name: 'demo', rootPath: '.', ecosystems: ['npm'], dependencyIds: ['dependency:demo'] },
    { schemaVersion: SCHEMA_VERSION, kind: 'Dependency', id: 'dependency:demo', packageId: 'package:demo', dependencyType: 'runtime', source: { path: 'package.json', locator: 'dependencies.demo' }, parentIds: [] },
    { schemaVersion: SCHEMA_VERSION, kind: 'Registry', id: 'registry:npm', ecosystem: 'npm', name: 'npm', baseUrl: 'https://registry.npmjs.org', packageUrlTemplate: 'https://registry.npmjs.org/{name}' },
    { schemaVersion: SCHEMA_VERSION, kind: 'Package', id: 'package:demo', ecosystem: 'npm', name: 'demo', registryId: 'registry:npm', evidenceIds: [evidence.id] },
    { schemaVersion: SCHEMA_VERSION, kind: 'Repository', id: 'repository:demo', url: 'https://github.com/example/demo', host: 'github.com', owner: 'example', name: 'demo', evidenceIds: [evidence.id] },
    { schemaVersion: SCHEMA_VERSION, kind: 'FundingSource', id: 'funding:demo', provider: 'github', url: 'https://github.com/sponsors/example', evidenceIds: [evidence.id] },
    evidence,
    confidence,
    { schemaVersion: SCHEMA_VERSION, kind: 'Relationship', id: 'relationship:funding', type: 'repository-funding', fromId: 'repository:demo', toId: 'funding:demo', confidence, evidenceIds: [evidence.id], ruleId: 'funding-file.github', status: 'supported' },
  ];
  for (const model of models) assert.doesNotThrow(() => validateModel(model));
});

test('rejects unsupported schema versions and unsafe URLs', () => {
  assert.throws(
    () => validateModel({ ...evidence, schemaVersion: '2.0' }),
    (error) => error instanceof FundGraphError && error.code === 'UNSUPPORTED_SCHEMA',
  );
  assert.throws(
    () => validateModel({ schemaVersion: SCHEMA_VERSION, kind: 'Repository', id: 'repo:unsafe', url: 'file:///secret', host: 'local', evidenceIds: [] }),
    (error) => error instanceof FundGraphError && error.code === 'UNSAFE_URL',
  );
  assert.throws(
    () => validateModel({ schemaVersion: SCHEMA_VERSION, kind: 'Repository', id: 'repo:large', url: 'https://example.test/repo', host: 'example.test', owner: 'x'.repeat(4097), evidenceIds: [] }),
    (error) => error instanceof FundGraphError && error.code === 'FIELD_TOO_LARGE',
  );
});

test('serializes object keys deterministically while preserving arrays', () => {
  const a = { z: 1, nested: { b: 2, a: 1 }, list: [{ z: 3, a: 2 }] };
  const b = { list: [{ a: 2, z: 3 }], nested: { a: 1, b: 2 }, z: 1 };
  assert.equal(stableStringify(a), stableStringify(b));
});

test('preserves contradictory evidence as an explicit relationship state', () => {
  const relationship = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'Relationship',
    id: 'relationship:conflict',
    type: 'repository-funding',
    fromId: 'repository:demo',
    toId: 'funding:conflict',
    confidence: { schemaVersion: SCHEMA_VERSION, kind: 'Confidence', id: 'confidence:unknown', level: 'unknown', rationale: 'Two sources disagree.', evidenceIds: ['evidence:a', 'evidence:b'] },
    evidenceIds: ['evidence:a', 'evidence:b'],
    ruleId: 'conflict-preserved',
    status: 'contradictory',
  };
  assert.equal(hasContradictoryRelationship(relationship), true);
  assert.match(serializeModel(relationship), /contradictory/);
});

