import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseGithubFundingFile,
  parsePackageFundingMetadata,
  parsePublicFundingResponse,
  stableStringify,
  validateModel,
} from '../dist/index.js';

const fixture = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/funding/${name}.json`, import.meta.url)), 'utf8'));
const context = (source, parser) => ({ source, observedAt: '2026-10-08T12:00:00.000Z', parser });

test('parses npm, PyPI, and Cargo package funding metadata with evidence', () => {
  const npm = parsePackageFundingMetadata('npm', fixture('npm-funded'), context('https://registry.npmjs.org/funded-package', 'npm-funding'));
  const pypi = parsePackageFundingMetadata('pypi', fixture('pypi-funded'), context('https://pypi.org/pypi/funded-package/json', 'pypi-funding'));
  const cargo = parsePackageFundingMetadata('cargo', fixture('cargo-funded'), context('https://crates.io/api/v1/crates/funded-crate', 'cargo-funding'));
  assert.equal(npm.sources.length, 2);
  assert.equal(pypi.sources.length, 1);
  assert.equal(cargo.sources.length, 1);
  for (const result of [npm, pypi, cargo]) {
    assert.equal(result.diagnostics.length, 0);
    assert.ok(result.sources.every((source) => source.evidenceIds.length > 0));
    for (const evidence of result.evidence) assert.doesNotThrow(() => validateModel(evidence));
    for (const source of result.sources) assert.doesNotThrow(() => validateModel(source));
  }
});

test('parses GitHub FUNDING.yml provider keys, arrays, custom URLs, and rejects unsafe URLs', () => {
  const source = readFileSync(fileURLToPath(new URL('./fixtures/funding/FUNDING.yml', import.meta.url)), 'utf8');
  const result = parseGithubFundingFile(source, context('https://github.com/example/project/blob/main/.github/FUNDING.yml', 'github-funding-file'));
  assert.equal(result.sources.length, 5);
  assert.ok(result.sources.some((item) => item.provider === 'github-sponsors'));
  assert.ok(result.sources.some((item) => item.provider === 'open-collective'));
  assert.ok(result.sources.some((item) => item.url === 'https://example.org/fund'));
  assert.ok(result.diagnostics.some((item) => item.code === 'UNSAFE_FUNDING_URL'));
  assert.equal(new Set(result.sources.flatMap((source) => source.evidenceIds)).size, 1);
});

test('preserves multiple and contradictory funding declarations instead of merging them', () => {
  const payload = { funding: ['https://github.com/sponsors/example', 'https://opencollective.com/example', 'https://example.org/alternate'] };
  const result = parsePackageFundingMetadata('npm', payload, context('https://registry.npmjs.org/conflicting', 'npm-funding'));
  assert.equal(result.sources.length, 3);
  assert.deepEqual(result.sources.map((source) => source.url), [
    'https://github.com/sponsors/example',
    'https://opencollective.com/example',
    'https://example.org/alternate',
  ]);
  assert.equal(new Set(result.sources.map((source) => source.id)).size, 3);
});

test('handles unfunded, malformed, and provider-failure payloads explicitly', () => {
  const unfunded = parsePackageFundingMetadata('npm', { name: 'unfunded' }, context('https://registry.npmjs.org/unfunded', 'npm-funding'));
  assert.equal(unfunded.sources.length, 0);
  assert.equal(unfunded.diagnostics.length, 0);
  const malformed = parsePackageFundingMetadata('npm', { funding: ['http://unsafe.example'] }, context('https://registry.npmjs.org/malformed', 'npm-funding'));
  assert.ok(malformed.diagnostics.some((item) => item.code === 'UNSAFE_FUNDING_URL'));
  const failed = parsePublicFundingResponse('public-provider', { error: 'rate limited' }, context('https://provider.example/api', 'provider-api'));
  assert.equal(failed.sources.length, 0);
  assert.ok(failed.diagnostics.some((item) => item.code === 'FUNDING_SOURCE_MISSING'));
});

test('funding evidence and sources are deterministic across repeated parsing', () => {
  const payload = { funding: [{ url: 'https://github.com/sponsors/example', type: 'github' }] };
  const a = parsePackageFundingMetadata('npm', payload, context('https://registry.npmjs.org/repeat', 'npm-funding'));
  const b = parsePackageFundingMetadata('npm', payload, context('https://registry.npmjs.org/repeat', 'npm-funding'));
  assert.equal(stableStringify(a), stableStringify(b));
});

