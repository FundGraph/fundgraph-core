import { basename } from 'node:path';
import type { Evidence, FundingSource, Package, Repository } from './domain/models.js';
import { discoverDependencies } from './inputs/discovery.js';
import type { DiscoveryResult } from './inputs/types.js';
import { parseRegistryMetadata } from './metadata/adapters.js';
import { registryFor } from './metadata/normalization.js';
import { parsePackageFundingMetadata } from './funding/metadata.js';
import { parseGithubFundingFile } from './funding/github.js';
import { resolveFundingRelationships } from './resolution/resolver.js';
import type { FundingClaim } from './resolution/types.js';
import { createReport } from './reporting/report.js';
import type { ReportDocument } from './reporting/types.js';
import { NetworkClient, type CacheOptions } from './network/index.js';

export interface ProjectAnalysisOptions {
  network?: NetworkClient;
  cache?: CacheOptions;
  offline?: boolean;
  signal?: AbortSignal;
  observedAt?: string;
  maxResponseBytes?: number;
}

export interface ProjectAnalysisResult {
  discovery: DiscoveryResult;
  report: ReportDocument;
  networkFailures: Array<{ packageId: string; url: string; message: string }>;
}

function metadataUrl(pkg: { ecosystem: string; name: string }): string | undefined {
  if (pkg.ecosystem === 'npm') return `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`;
  if (pkg.ecosystem === 'pypi') return `https://pypi.org/pypi/${encodeURIComponent(pkg.name)}/json`;
  if (pkg.ecosystem === 'cargo') return `https://crates.io/api/v1/crates/${encodeURIComponent(pkg.name)}`;
  return undefined;
}

function packageName(packageId: string): { ecosystem: 'npm' | 'pypi' | 'cargo'; name: string } | undefined {
  const separator = packageId.indexOf(':');
  const ecosystem = packageId.slice(0, separator);
  if (ecosystem !== 'npm' && ecosystem !== 'pypi' && ecosystem !== 'cargo') return undefined;
  return { ecosystem, name: packageId.slice(separator + 1) };
}

function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()].sort((a, b) => a.id.localeCompare(b.id));
}

function requestOptions(url: string, options: ProjectAnalysisOptions, allowedHosts: string[]) {
  return {
    url,
    allowedHosts,
    ...(options.cache === undefined ? {} : { cache: options.cache }),
    ...(options.offline === undefined ? {} : { offline: options.offline }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.maxResponseBytes === undefined ? {} : { maxResponseBytes: options.maxResponseBytes }),
  };
}

/**
 * Runs the complete network-backed analysis pipeline. Network access is explicit
 * at the call site; parsers remain pure and every fetched payload becomes evidence.
 */
export async function analyzeProject(projectPath: string, options: ProjectAnalysisOptions = {}): Promise<ProjectAnalysisResult> {
  const discovery = discoverDependencies(projectPath);
  const client = options.network ?? new NetworkClient();
  const observedAt = options.observedAt ?? new Date().toISOString();
  const diagnostics: Array<{ code: string; message: string; source?: string }> = discovery.diagnostics.map((item) => ({ code: item.code, message: item.message, ...(item.sourcePath === undefined ? {} : { source: item.sourcePath }) }));
  const registries = [] as ReturnType<typeof registryFor>[];
  const packages = [] as Package[];
  const repositories = [] as Repository[];
  const fundingSources = [] as FundingSource[];
  const evidence = [] as Evidence[];
  const claims: FundingClaim[] = [];
  const networkFailures: ProjectAnalysisResult['networkFailures'] = [];
  const packageIds = [...new Set(discovery.graph.nodes.map((node) => node.packageId))].sort();

  await Promise.all(packageIds.map(async (id) => {
    const identity = packageName(id);
    if (!identity) {
      diagnostics.push({ code: 'UNSUPPORTED_ECOSYSTEM', message: `No metadata provider is implemented for ${id}` });
      return;
    }
    const url = metadataUrl(identity);
    if (!url) return;
    try {
      const request = requestOptions(url, options, new URL(url).hostname === 'registry.npmjs.org' ? ['registry.npmjs.org'] : new URL(url).hostname === 'pypi.org' ? ['pypi.org'] : ['crates.io']);
      const response = await client.json<unknown>(request);
      const context = { source: url, observedAt: response.fetchedAt, parser: `${identity.ecosystem}-registry` };
      const metadata = parseRegistryMetadata(identity.ecosystem, response.value, context);
      registries.push(metadata.registry);
      evidence.push(...metadata.evidence);
      diagnostics.push(...metadata.diagnostics.map((item) => ({ code: item.code, message: item.message, source: url })));
      if (metadata.package) packages.push(metadata.package);
      if (metadata.repository) repositories.push(metadata.repository);
      const funding = parsePackageFundingMetadata(identity.ecosystem, response.value, { ...context, parser: `${identity.ecosystem}-funding` });
      evidence.push(...funding.evidence);
      fundingSources.push(...funding.sources);
      diagnostics.push(...funding.diagnostics.map((item) => ({ code: item.code, message: item.message, ...(item.source === undefined ? {} : { source: item.source }) })));
      if (metadata.repository) {
        for (const source of funding.sources) claims.push({ repositoryId: metadata.repository.id, fundingSourceId: source.id, evidenceIds: source.evidenceIds, ruleId: `${identity.ecosystem}.package-funding` });

        if (metadata.repository.host === 'github.com' && metadata.repository.owner && metadata.repository.name) {
          const fundingUrl = `https://api.github.com/repos/${encodeURIComponent(metadata.repository.owner)}/${encodeURIComponent(metadata.repository.name)}/contents/.github/FUNDING.yml`;
          try {
            const fundingResponse = await client.json<{ content?: string; encoding?: string }>(requestOptions(fundingUrl, options, ['api.github.com']));
            if (fundingResponse.value.encoding !== 'base64' || typeof fundingResponse.value.content !== 'string') {
              throw new Error('GitHub FUNDING.yml response did not contain base64 content');
            }
            const fundingFile = parseGithubFundingFile(Buffer.from(fundingResponse.value.content, 'base64').toString('utf8'), { source: fundingUrl, observedAt: fundingResponse.fetchedAt, parser: 'github-funding' });
            evidence.push(...fundingFile.evidence);
            fundingSources.push(...fundingFile.sources);
            diagnostics.push(...fundingFile.diagnostics.map((item) => ({ code: item.code, message: item.message, ...(item.source === undefined ? {} : { source: item.source }) })));
            for (const source of fundingFile.sources) claims.push({ repositoryId: metadata.repository.id, fundingSourceId: source.id, evidenceIds: source.evidenceIds, ruleId: 'github.funding-file' });
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Repository funding file request failed';
            if (!message.includes('HTTP 404')) {
              networkFailures.push({ packageId: id, url: fundingUrl, message });
              diagnostics.push({ code: 'NETWORK_FAILURE', message: `Could not retrieve FUNDING.yml for ${metadata.repository.id}: ${message}`, source: fundingUrl });
            }
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Metadata request failed';
      networkFailures.push({ packageId: id, url, message });
      diagnostics.push({ code: 'NETWORK_FAILURE', message: `Could not retrieve metadata for ${id}: ${message}`, source: url });
    }
  }));

  const resolution = resolveFundingRelationships({ packages: uniqueById(packages), repositories: uniqueById(repositories), fundingSources: uniqueById(fundingSources), evidence: uniqueById(evidence), fundingClaims: claims });
  diagnostics.push(...resolution.diagnostics.map((message) => ({ code: 'RELATIONSHIP_DIAGNOSTIC', message })));
  const report = createReport({ project: { ...discovery.project, name: discovery.project.name || basename(projectPath), analyzedAt: observedAt, toolVersion: '@fundgraph/core' }, dependencies: discovery.graph.nodes, registries: uniqueById(registries), packages: uniqueById(packages), repositories: uniqueById(repositories), fundingSources: uniqueById(fundingSources), evidence: uniqueById(evidence), relationships: resolution.relationships, diagnostics });
  return { discovery, report, networkFailures };
}
