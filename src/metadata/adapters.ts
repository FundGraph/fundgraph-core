import { stableStringify } from '../serialization/stable.js';
import type { Evidence, Package, Repository } from '../domain/models.js';
import { canonicalRepositoryUrl, packageId, registryFor, repositoryId, repositoryParts, sourceDiagnostics } from './normalization.js';
import type { MetadataContext, MetadataEcosystem, MetadataParseResult } from './types.js';

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function evidenceFor(ecosystem: MetadataEcosystem, payload: unknown, context: MetadataContext): Evidence {
  const digestInput = stableStringify(payload);
  return {
    schemaVersion: '1.0',
    kind: 'Evidence',
    id: `evidence:${ecosystem}:${encodeURIComponent(`${context.source}:${digestInput}`)}`,
    evidenceKind: 'package-metadata',
    source: context.source,
    observedAt: context.observedAt,
    value: payload,
    ...(context.parser === undefined ? {} : { parser: context.parser }),
  };
}

function packageAndRepository(ecosystem: MetadataEcosystem, name: string, version: string | undefined, repositoryValue: unknown, evidence: Evidence): { package: Package; repository?: Repository } {
  const url = canonicalRepositoryUrl(repositoryValue);
  const repository = url === undefined ? undefined : (() => {
    const parts = repositoryParts(url);
    return {
      schemaVersion: '1.0' as const,
      kind: 'Repository' as const,
      id: repositoryId(url),
      url,
      ...parts,
      evidenceIds: [evidence.id],
    };
  })();
  const packageValue: Package = {
    schemaVersion: '1.0',
    kind: 'Package',
    id: packageId(ecosystem, name),
    ecosystem,
    name,
    registryId: registryFor(ecosystem).id,
    evidenceIds: [evidence.id],
    ...(version === undefined ? {} : { version }),
    ...(repository === undefined ? {} : { repositoryId: repository.id }),
  };
  return { package: packageValue, ...(repository === undefined ? {} : { repository }) };
}

function parseNpm(payload: unknown, context: MetadataContext): MetadataParseResult {
  const registry = registryFor('npm');
  const diagnostics = sourceDiagnostics('npm', payload, context);
  const evidence = evidenceFor('npm', payload, context);
  const record = objectValue(payload);
  const name = typeof record?.name === 'string' ? record.name : undefined;
  if (name === undefined) diagnostics.push({ code: 'MISSING_METADATA_FIELD', message: 'npm metadata is missing name' });
  if (record === undefined || name === undefined) return { registry, evidence: [evidence], diagnostics };
  const version = typeof record.version === 'string' ? record.version : undefined;
  const repositoryValue = typeof record.repository === 'string' ? record.repository : objectValue(record.repository)?.url;
  return { registry, evidence: [evidence], diagnostics, ...packageAndRepository('npm', name, version, repositoryValue, evidence) };
}

function parsePypi(payload: unknown, context: MetadataContext): MetadataParseResult {
  const registry = registryFor('pypi');
  const diagnostics = sourceDiagnostics('pypi', payload, context);
  const evidence = evidenceFor('pypi', payload, context);
  const info = objectValue(objectValue(payload)?.info);
  const name = typeof info?.name === 'string' ? info.name : undefined;
  if (name === undefined) diagnostics.push({ code: 'MISSING_METADATA_FIELD', message: 'PyPI metadata is missing info.name' });
  if (info === undefined || name === undefined) return { registry, evidence: [evidence], diagnostics };
  const version = typeof info.version === 'string' ? info.version : undefined;
  const projectUrls = objectValue(info.project_urls);
  const repositoryValue = Object.entries(projectUrls ?? {}).sort(([a], [b]) => a.localeCompare(b)).find(([key, value]) => /repository|source|github|gitlab/i.test(key) && typeof value === 'string')?.[1] ?? info.home_page;
  return { registry, evidence: [evidence], diagnostics, ...packageAndRepository('pypi', name, version, repositoryValue, evidence) };
}

function parseCargo(payload: unknown, context: MetadataContext): MetadataParseResult {
  const registry = registryFor('cargo');
  const diagnostics = sourceDiagnostics('cargo', payload, context);
  const evidence = evidenceFor('cargo', payload, context);
  const record = objectValue(payload);
  const crate = objectValue(record?.crate) ?? record;
  const name = typeof crate?.name === 'string' ? crate.name : typeof crate?.id === 'string' ? crate.id : undefined;
  if (name === undefined) diagnostics.push({ code: 'MISSING_METADATA_FIELD', message: 'Cargo metadata is missing crate.name' });
  if (crate === undefined || name === undefined) return { registry, evidence: [evidence], diagnostics };
  const version = typeof crate.max_version === 'string' ? crate.max_version : typeof crate.version === 'string' ? crate.version : undefined;
  return { registry, evidence: [evidence], diagnostics, ...packageAndRepository('cargo', name, version, crate.repository, evidence) };
}

export function parseRegistryMetadata(ecosystem: MetadataEcosystem, payload: unknown, context: MetadataContext): MetadataParseResult {
  if (ecosystem === 'npm') return parseNpm(payload, context);
  if (ecosystem === 'pypi') return parsePypi(payload, context);
  return parseCargo(payload, context);
}

