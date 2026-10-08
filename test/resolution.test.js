import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFundingRelationships, validateModel } from '../dist/index.js';

const evidence = (id, kind = 'package-metadata') => ({ schemaVersion: '1.0', kind: 'Evidence', id, evidenceKind: kind, source: `https://example.test/${id}`, observedAt: '2026-10-08T12:00:00.000Z', value: { id } });
const pkg = (id, repositoryId, evidenceIds = ['e:pkg']) => ({ schemaVersion: '1.0', kind: 'Package', id, ecosystem: 'npm', name: id, registryId: 'registry:npm', ...(repositoryId === undefined ? {} : { repositoryId }), evidenceIds });
const repo = (id, evidenceIds = ['e:repo']) => ({ schemaVersion: '1.0', kind: 'Repository', id, url: `https://github.com/example/${id}`, host: 'github.com', owner: 'example', name: id, evidenceIds });
const source = (id, evidenceIds = ['e:funding']) => ({ schemaVersion: '1.0', kind: 'FundingSource', id, provider: 'github-sponsors', url: `https://github.com/sponsors/${id}`, evidenceIds });

test('resolves a direct package-to-repository relationship with explainable confidence', () => {
  const result = resolveFundingRelationships({
    packages: [pkg('package:one', 'repo:one')],
    repositories: [repo('repo:one')],
    fundingSources: [],
    evidence: [evidence('e:pkg'), evidence('e:repo')],
  });
  assert.equal(result.diagnostics.length, 0);
  const relationship = result.relationships[0];
  assert.equal(relationship?.status, 'supported');
  assert.equal(relationship?.confidence.level, 'high');
  assert.equal(relationship?.ruleId, 'package.repositoryId');
  assert.doesNotThrow(() => validateModel(relationship));
});

test('emits unresolved relationship when repository identity is missing', () => {
  const result = resolveFundingRelationships({ packages: [pkg('package:missing')], repositories: [], fundingSources: [] });
  assert.equal(result.relationships[0]?.status, 'unresolved');
  assert.equal(result.relationships[0]?.confidence.level, 'unknown');
});

test('preserves conflicting repository candidates as ambiguous relationships', () => {
  const result = resolveFundingRelationships({
    packages: [pkg('package:ambiguous')],
    repositories: [repo('repo:a'), repo('repo:b')],
    fundingSources: [],
    repositoryCandidates: [
      { packageId: 'package:ambiguous', repositoryId: 'repo:a', evidenceIds: ['e:a'], ruleId: 'registry.repository' },
      { packageId: 'package:ambiguous', repositoryId: 'repo:b', evidenceIds: ['e:b'], ruleId: 'repository.field' },
    ],
  });
  assert.equal(result.relationships.length, 2);
  assert.ok(result.relationships.every((item) => item.status === 'ambiguous' && item.confidence.level === 'unknown'));
  assert.equal(result.diagnostics.length, 1);
});

test('resolves explicit repository funding claims without inferring human identity', () => {
  const result = resolveFundingRelationships({
    packages: [pkg('package:funded', 'repo:funded')],
    repositories: [repo('repo:funded')],
    fundingSources: [source('funding:one')],
    fundingClaims: [{ repositoryId: 'repo:funded', fundingSourceId: 'funding:one', evidenceIds: ['e:funding'], ruleId: 'funding-file.github' }],
  });
  const relationship = result.relationships.find((item) => item.type === 'repository-funding');
  assert.equal(relationship?.status, 'supported');
  assert.equal(relationship?.ruleId, 'funding-file.github');
  assert.equal(relationship?.confidence.level, 'medium');
});

test('marks multiple explicit funding sources for one repository as ambiguous', () => {
  const result = resolveFundingRelationships({
    packages: [],
    repositories: [repo('repo:multiple')],
    fundingSources: [source('funding:a'), source('funding:b')],
    fundingClaims: [
      { repositoryId: 'repo:multiple', fundingSourceId: 'funding:a', evidenceIds: ['e:a'], ruleId: 'package.metadata.funding' },
      { repositoryId: 'repo:multiple', fundingSourceId: 'funding:b', evidenceIds: ['e:b'], ruleId: 'funding-file.github' },
    ],
  });
  assert.equal(result.relationships.length, 2);
  assert.ok(result.relationships.every((item) => item.status === 'ambiguous' && item.confidence.level === 'unknown'));
});

test('marks claims referencing missing entities as contradictory', () => {
  const result = resolveFundingRelationships({ packages: [], repositories: [], fundingSources: [], fundingClaims: [{ repositoryId: 'repo:none', fundingSourceId: 'funding:none', evidenceIds: ['e:missing'], ruleId: 'provider.response' }] });
  assert.equal(result.relationships[0]?.status, 'contradictory');
  assert.equal(result.diagnostics.length, 1);
});

