import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createReport,
  renderReportJson,
  renderReportText,
} from '../dist/index.js';

const evidence = {
  schemaVersion: '1.0',
  kind: 'Evidence',
  id: 'evidence:repo',
  evidenceKind: 'repository-metadata',
  source: 'https://github.com/example/project',
  value: { funding: ['https://github.com/sponsors/example'] },
};

const relationship = {
  schemaVersion: '1.0',
  kind: 'Relationship',
  id: 'relationship:funding',
  type: 'repository-funding',
  fromId: 'repo:example',
  toId: 'funding:github',
  confidence: {
    schemaVersion: '1.0',
    kind: 'Confidence',
    id: 'confidence:funding',
    level: 'high',
    rationale: 'Repository metadata names the funding endpoint.',
    evidenceIds: ['evidence:repo'],
  },
  evidenceIds: ['evidence:repo'],
  ruleId: 'repository-funding-metadata',
  status: 'supported',
};

function input(reverse = false) {
  const values = reverse ? [evidence].reverse() : [evidence];
  return {
    evidence: values,
    relationships: reverse ? [relationship].reverse() : [relationship],
    fundingSources: [{
      schemaVersion: '1.0', kind: 'FundingSource', id: 'funding:github', provider: 'github-sponsors',
      url: 'https://github.com/sponsors/example', evidenceIds: ['evidence:repo'],
    }],
    repositories: [{
      schemaVersion: '1.0', kind: 'Repository', id: 'repo:example', url: 'https://github.com/example/project',
      host: 'github.com', owner: 'example', name: 'project', evidenceIds: ['evidence:repo'],
    }],
    diagnostics: [{ code: 'NETWORK_FAILURE', message: 'offline', source: '\u001b[31mnetwork\u001b[0m' }],
  };
}

test('reports are stable regardless of input order and expose a machine schema', () => {
  const first = createReport(input());
  const second = createReport(input(true));
  assert.equal(renderReportJson(first, false), renderReportJson(second, false));
  assert.equal(first.kind, 'FundGraphReport');
  assert.equal(first.schemaVersion, '1.0');
  assert.equal(first.summary.supportedCount, 1);
  assert.equal(first.actions[0].url, 'https://github.com/sponsors/example');
});

test('text reports include evidence drill-down, diagnostics, limitations, and safe metadata', () => {
  const text = renderReportText(createReport(input()));
  assert.match(text, /evidence:repo \(repository-metadata; https:\/\/github\.com\/example\/project\)/);
  assert.match(text, /NETWORK_FAILURE: offline/);
  assert.doesNotMatch(text, /\u001b/);
  assert.match(text, /Limitations:/);
});

test('empty reports are valid and deterministic', () => {
  const report = createReport({});
  assert.deepEqual(report.summary, {
    dependencyCount: 0, packageCount: 0, registryCount: 0, repositoryCount: 0,
    fundingSourceCount: 0, evidenceCount: 0, relationshipCount: 0,
    supportedCount: 0, ambiguousCount: 0, contradictoryCount: 0, unresolvedCount: 0,
  });
  assert.equal(report.relationships.length, 0);
  assert.equal(report.limitations.length, 3);
});
