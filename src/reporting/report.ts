import type { Dependency, Evidence, FundingSource, Package, Project, Registry, Relationship, Repository } from '../domain/models.js';
import { stableStringify } from '../serialization/stable.js';
import type { ReportAction, ReportDiagnostic, ReportDocument, ReportInput, ReportSummary } from './types.js';
import { REPORT_SCHEMA_VERSION } from './types.js';

const DEFAULT_LIMITATIONS = [
  'Funding URLs are declarations to review, not endorsements or verified payment destinations.',
  'FundGraph does not verify human identity or execute payments.',
  'Missing, malformed, and contradictory metadata remains visible in the report.',
];

function compare(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true });
}

function byId<T extends { id: string }>(values: readonly T[]): T[] {
  return [...values].sort((a, b) => compare(a.id, b.id));
}

function diagnostics(values: readonly (ReportDiagnostic | string)[] | undefined): ReportDiagnostic[] {
  return [...(values ?? [])]
    .map((value): ReportDiagnostic => typeof value === 'string' ? { code: 'DIAGNOSTIC', message: value } : { ...value })
    .sort((a, b) => compare(`${a.code}:${a.message}:${a.source ?? ''}`, `${b.code}:${b.message}:${b.source ?? ''}`));
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compare);
}

function actionsFor(relationships: readonly Relationship[], fundingSources: readonly FundingSource[], supplied: readonly ReportAction[] | undefined): ReportAction[] {
  const generated: ReportAction[] = [];
  const sources = new Map(fundingSources.map((source) => [source.id, source]));
  for (const relationship of relationships) {
    if (relationship.status === 'supported' && relationship.type === 'repository-funding') {
      const source = sources.get(relationship.toId);
      if (source) generated.push({ kind: 'inspect', label: `Review funding source ${source.url}`, targetId: source.id, url: source.url });
    } else if (relationship.status === 'ambiguous' || relationship.status === 'contradictory' || relationship.status === 'unresolved') {
      generated.push({ kind: 'review', label: `Review ${relationship.status} relationship ${relationship.id}`, targetId: relationship.id });
    }
  }
  return [...(supplied ?? []), ...generated]
    .sort((a, b) => compare(`${a.kind}:${a.targetId ?? ''}:${a.label}`, `${b.kind}:${b.targetId ?? ''}:${b.label}`));
}

function summary(input: {
  dependencies: readonly Dependency[];
  packages: readonly Package[];
  registries: readonly Registry[];
  repositories: readonly Repository[];
  fundingSources: readonly FundingSource[];
  evidence: readonly Evidence[];
  relationships: readonly Relationship[];
}): ReportSummary {
  const counts = { supported: 0, ambiguous: 0, contradictory: 0, unresolved: 0 };
  for (const relationship of input.relationships) counts[relationship.status] += 1;
  return {
    dependencyCount: input.dependencies.length,
    packageCount: input.packages.length,
    registryCount: input.registries.length,
    repositoryCount: input.repositories.length,
    fundingSourceCount: input.fundingSources.length,
    evidenceCount: input.evidence.length,
    relationshipCount: input.relationships.length,
    supportedCount: counts.supported,
    ambiguousCount: counts.ambiguous,
    contradictoryCount: counts.contradictory,
    unresolvedCount: counts.unresolved,
  };
}

export function createReport(input: ReportInput): ReportDocument {
  const dependencies = byId(input.dependencies ?? []);
  const packages = byId(input.packages ?? []);
  const registries = byId(input.registries ?? []);
  const repositories = byId(input.repositories ?? []);
  const fundingSources = byId(input.fundingSources ?? []);
  const evidence = byId(input.evidence ?? []);
  const relationships = byId(input.relationships ?? []);
  const document: ReportDocument = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    kind: 'FundGraphReport',
    generatedBy: '@fundgraph/core',
    summary: summary({ dependencies, packages, registries, repositories, fundingSources, evidence, relationships }),
    dependencies,
    packages,
    registries,
    repositories,
    fundingSources,
    evidence,
    relationships,
    diagnostics: diagnostics(input.diagnostics),
    limitations: uniqueSorted([...(input.limitations ?? []), ...DEFAULT_LIMITATIONS]),
    actions: actionsFor(relationships, fundingSources, input.actions),
  };
  if (input.project) document.project = { ...input.project, ecosystems: [...input.project.ecosystems].sort(compare), dependencyIds: uniqueSorted(input.project.dependencyIds) };
  return document;
}

function safe(value: unknown): string {
  return String(value).replace(/[\u0000-\u001f\u007f\u001b]/g, '�');
}

function evidenceFor(document: ReportDocument, relationship: Relationship): string {
  const ids = uniqueSorted(relationship.evidenceIds);
  if (ids.length === 0) return 'none';
  const byEvidence = new Map(document.evidence.map((item) => [item.id, item]));
  return ids.map((id) => {
    const item = byEvidence.get(id);
    return item ? `${safe(id)} (${safe(item.evidenceKind)}; ${safe(item.source)})` : `${safe(id)} (missing)`;
  }).join(', ');
}

export function renderReportText(document: ReportDocument): string {
  const lines = [
    'FundGraph report',
    `Schema: ${document.schemaVersion}`,
    `Dependencies: ${document.summary.dependencyCount}`,
    `Packages: ${document.summary.packageCount}`,
    `Repositories: ${document.summary.repositoryCount}`,
    `Funding sources: ${document.summary.fundingSourceCount}`,
    `Evidence: ${document.summary.evidenceCount}`,
    `Relationships: ${document.summary.relationshipCount}`,
    `Relationship status: supported=${document.summary.supportedCount}, ambiguous=${document.summary.ambiguousCount}, contradictory=${document.summary.contradictoryCount}, unresolved=${document.summary.unresolvedCount}`,
  ];
  if (document.relationships.length) {
    lines.push('', 'Relationships:');
    for (const relationship of document.relationships) {
      lines.push(`- ${safe(relationship.id)}: ${safe(relationship.fromId)} --${safe(relationship.type)}--> ${safe(relationship.toId)} [${safe(relationship.status)}; confidence=${safe(relationship.confidence.level)}; evidence=${evidenceFor(document, relationship)}]`);
    }
  }
  if (document.diagnostics.length) {
    lines.push('', 'Diagnostics:');
    for (const diagnostic of document.diagnostics) lines.push(`- ${safe(diagnostic.code)}: ${safe(diagnostic.message)}${diagnostic.source ? ` (${safe(diagnostic.source)})` : ''}`);
  }
  lines.push('', 'Limitations:');
  for (const limitation of document.limitations) lines.push(`- ${safe(limitation)}`);
  if (document.actions.length) {
    lines.push('', 'Actions:');
    for (const action of document.actions) lines.push(`- ${safe(action.kind)}: ${safe(action.label)}${action.url ? ` (${safe(action.url)})` : ''}`);
  }
  return `${lines.join('\n')}\n`;
}

export function renderReportJson(document: ReportDocument, pretty = true): string {
  if (!pretty) return stableStringify(document);
  return JSON.stringify(JSON.parse(stableStringify(document)), null, 2);
}
