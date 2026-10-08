import { normalizePackageName } from '../inputs/common.js';
import { stableStringify } from '../serialization/stable.js';
import type { MetadataContext, MetadataDiagnostic } from './types.js';

export const MAX_METADATA_PAYLOAD_BYTES = 1_048_576;

export function allowedSource(ecosystem: 'npm' | 'pypi' | 'cargo', source: string): boolean {
  let parsed: URL;
  try { parsed = new URL(source); } catch { return false; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
  const hosts: Record<typeof ecosystem, string[]> = {
    npm: ['registry.npmjs.org'],
    pypi: ['pypi.org'],
    cargo: ['crates.io', 'api.crates.io'],
  };
  return hosts[ecosystem].includes(parsed.hostname.toLowerCase());
}

export function payloadSize(payload: unknown): number {
  return new TextEncoder().encode(stableStringify(payload)).byteLength;
}

export function sourceDiagnostics(ecosystem: 'npm' | 'pypi' | 'cargo', payload: unknown, context: MetadataContext): MetadataDiagnostic[] {
  const diagnostics: MetadataDiagnostic[] = [];
  if (!allowedSource(ecosystem, context.source)) diagnostics.push({ code: 'UNSAFE_METADATA_SOURCE', message: `Metadata source is not an allowed HTTPS ${ecosystem} registry endpoint` });
  try {
    if (payloadSize(payload) > (context.maxPayloadBytes ?? MAX_METADATA_PAYLOAD_BYTES)) diagnostics.push({ code: 'PAYLOAD_TOO_LARGE', message: `Metadata payload exceeds ${context.maxPayloadBytes ?? MAX_METADATA_PAYLOAD_BYTES} bytes` });
  } catch {
    diagnostics.push({ code: 'MALFORMED_METADATA', message: 'Metadata payload is not deterministically serializable' });
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) diagnostics.push({ code: 'MALFORMED_METADATA', message: 'Metadata payload must be a JSON object' });
  return diagnostics;
}

export function canonicalRepositoryUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  let candidate = value.trim();
  if (candidate.startsWith('git+')) candidate = candidate.slice(4);
  if (candidate.startsWith('github:')) candidate = `https://github.com/${candidate.slice(7)}`;
  if (!/^https?:\/\//i.test(candidate)) return undefined;
  try {
    const url = new URL(candidate);
    if (url.username || url.password) return undefined;
    url.protocol = 'https:';
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\.git$/i, '').replace(/\/+$/, '');
    return url.toString();
  } catch {
    return undefined;
  }
}

export function repositoryParts(url: string): { host: string; owner?: string; name?: string } {
  const parsed = new URL(url);
  const parts = parsed.pathname.split('/').filter(Boolean);
  const owner = parts[0];
  const name = parts[1];
  return { host: parsed.hostname.toLowerCase(), ...(owner === undefined ? {} : { owner }), ...(name === undefined ? {} : { name }) };
}

export function packageId(ecosystem: 'npm' | 'pypi' | 'cargo', name: string): string {
  return `${ecosystem}:${normalizePackageName(name)}`;
}

export function repositoryId(url: string): string {
  return `repository:${encodeURIComponent(url)}`;
}

export function registryFor(ecosystem: 'npm' | 'pypi' | 'cargo'): import('../domain/models.js').Registry {
  const definitions = {
    npm: { name: 'npm', baseUrl: 'https://registry.npmjs.org', packageUrlTemplate: 'https://registry.npmjs.org/{name}' },
    pypi: { name: 'PyPI', baseUrl: 'https://pypi.org', packageUrlTemplate: 'https://pypi.org/pypi/{name}/json' },
    cargo: { name: 'crates.io', baseUrl: 'https://crates.io', packageUrlTemplate: 'https://crates.io/api/v1/crates/{name}' },
  }[ecosystem];
  return { schemaVersion: '1.0', kind: 'Registry', id: `registry:${ecosystem}`, ecosystem, ...definitions };
}

