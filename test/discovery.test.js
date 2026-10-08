import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverDependencies } from '../dist/index.js';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const copyFixture = (name) => {
  const destination = mkdtempSync(join(tmpdir(), `fundgraph-${name}-`));
  cpSync(join(fixtures, name), destination, { recursive: true });
  return destination;
};
const names = (result) => result.graph.nodes.map((node) => node.packageId).sort();

test('discovers npm aliases, workspaces, optional dependencies, transitive edges, and source locations', () => {
  const result = discoverDependencies(copyFixture('npm-workspace'));
  assert.deepEqual(result.ecosystems, ['npm']);
  assert.ok(names(result).includes('npm:real-lib'));
  assert.ok(names(result).includes('npm:transitive-lib'));
  const alias = result.graph.nodes.find((node) => node.packageId === 'npm:real-lib');
  assert.equal(alias?.alias, 'alias-lib');
  assert.equal(alias?.resolvedVersion, '1.2.0');
  assert.ok(result.graph.nodes.some((node) => node.packageId === 'npm:workspace-lib'));
  assert.ok(result.graph.nodes.some((node) => node.dependencyType === 'optional'));
  assert.ok(result.graph.edges.some((edge) => edge.toId === alias?.id && edge.fromId.startsWith('project:')));
  assert.equal(result.diagnostics.length, 0);
  assert.ok(alias?.source.path.endsWith('package.json'));
});

test('discovers PyPI dependencies, optional dependencies, lock versions, and transitive edges', () => {
  const result = discoverDependencies(copyFixture('pypi-poetry'));
  assert.deepEqual(result.ecosystems, ['pypi']);
  assert.ok(names(result).includes('pypi:requests'));
  assert.ok(names(result).includes('pypi:urllib3'));
  const pytest = result.graph.nodes.find((node) => node.packageId === 'pypi:pytest');
  assert.equal(pytest?.dependencyType, 'optional');
  assert.equal(result.graph.nodes.find((node) => node.packageId === 'pypi:requests')?.resolvedVersion, '2.31.0');
  assert.ok(result.graph.edges.some((edge) => edge.fromId === result.graph.nodes.find((node) => node.packageId === 'pypi:requests')?.id && edge.toId === result.graph.nodes.find((node) => node.packageId === 'pypi:urllib3')?.id));
});

test('discovers Cargo workspace members, optional dependencies, and lock transitive edges', () => {
  const result = discoverDependencies(copyFixture('cargo-workspace'));
  assert.deepEqual(result.ecosystems, ['cargo']);
  assert.ok(names(result).includes('cargo:serde'));
  assert.ok(names(result).includes('cargo:regex'));
  assert.ok(names(result).includes('cargo:aho-corasick'));
  assert.equal(result.graph.nodes.find((node) => node.packageId === 'cargo:serde')?.dependencyType, 'optional');
  assert.ok(result.graph.edges.some((edge) => edge.toId === result.graph.nodes.find((node) => node.packageId === 'cargo:aho-corasick')?.id));
});

test('discovers Go module requirements without executing the Go toolchain', () => {
  const result = discoverDependencies(copyFixture('go-module'));
  assert.deepEqual(result.ecosystems, ['go']);
  assert.equal(result.project.name, 'example.com/fundgraph/demo');
  assert.ok(names(result).includes('go:github.com/example/direct'));
  assert.ok(names(result).includes('go:golang.org/x/text'));
  assert.equal(result.graph.nodes.find((node) => node.packageId === 'go:github.com/example/direct')?.resolvedVersion, 'v1.2.3');
  assert.equal(result.graph.nodes.find((node) => node.packageId === 'go:golang.org/x/text')?.dependencyType, 'unknown');
  assert.equal(result.diagnostics.length, 0);
});

test('reports malformed Go module files without guessing requirements', () => {
  const root = mkdtempSync(join(tmpdir(), 'fundgraph-go-malformed-'));
  writeFileSync(join(root, 'go.mod'), 'require (\n\tbroken\n');
  const result = discoverDependencies(root);
  assert.ok(result.diagnostics.some((item) => item.code === 'MALFORMED_MANIFEST'));
  assert.equal(result.graph.nodes.length, 0);
});

test('reports missing and malformed lockfiles without inventing resolved versions', () => {
  const root = mkdtempSync(join(tmpdir(), 'fundgraph-missing-lock-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'missing-lock', dependencies: { demo: '^1.0.0' } }));
  const missing = discoverDependencies(root);
  assert.ok(missing.diagnostics.some((item) => item.code === 'LOCKFILE_MISSING'));
  assert.equal(missing.graph.nodes[0]?.resolvedVersion, undefined);
  writeFileSync(join(root, 'package-lock.json'), '{ malformed');
  const malformed = discoverDependencies(root);
  assert.ok(malformed.diagnostics.some((item) => item.code === 'MALFORMED_LOCKFILE'));
});

