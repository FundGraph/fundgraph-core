import { stableStringify } from '../serialization/stable.js';
import type { Evidence, FundingSource } from '../domain/models.js';
import type { FundingContext, FundingDiagnostic } from './types.js';

export const MAX_FUNDING_PAYLOAD_BYTES = 1_048_576;

export function safeFundingUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return undefined;
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch {
    return undefined;
  }
}

export function fundingProvider(url: string): string {
  const host = new URL(url).hostname.toLowerCase();
  if (host === 'github.com' || host === 'www.github.com') return 'github-sponsors';
  if (host === 'opencollective.com' || host === 'www.opencollective.com') return 'open-collective';
  if (host === 'drips.network' || host === 'www.drips.network') return 'drips';
  if (host === 'ko-fi.com' || host === 'www.ko-fi.com') return 'ko-fi';
  if (host === 'liberapay.com' || host === 'www.liberapay.com') return 'liberapay';
  if (host === 'patreon.com' || host === 'www.patreon.com') return 'patreon';
  return host;
}

export function evidenceId(kind: string, context: FundingContext, payload: unknown): string {
  return `evidence:funding:${encodeURIComponent(`${kind}:${context.source}:${stableStringify(payload)}`)}`;
}

export function makeEvidence(kind: 'package-metadata' | 'funding-file' | 'provider-response', payload: unknown, context: FundingContext): Evidence {
  return {
    schemaVersion: '1.0',
    kind: 'Evidence',
    id: evidenceId(kind, context, payload),
    evidenceKind: kind,
    source: context.source,
    observedAt: context.observedAt,
    value: payload,
    ...(context.parser === undefined ? {} : { parser: context.parser }),
  };
}

export function makeSource(url: string, evidence: Evidence, label?: string): FundingSource {
  return {
    schemaVersion: '1.0',
    kind: 'FundingSource',
    id: `funding:${encodeURIComponent(url)}`,
    provider: fundingProvider(url),
    url,
    evidenceIds: [evidence.id],
    ...(label === undefined ? {} : { label }),
  };
}

export function validateFundingPayload(payload: unknown, context: FundingContext): FundingDiagnostic[] {
  const diagnostics: FundingDiagnostic[] = [];
  if (typeof payload === 'string' && new TextEncoder().encode(payload).byteLength > (context.maxPayloadBytes ?? MAX_FUNDING_PAYLOAD_BYTES)) {
    diagnostics.push({ code: 'FUNDING_PAYLOAD_TOO_LARGE', message: `Funding payload exceeds ${context.maxPayloadBytes ?? MAX_FUNDING_PAYLOAD_BYTES} bytes`, source: context.source });
  }
  if (typeof payload === 'object' && payload !== null) {
    try {
      if (new TextEncoder().encode(stableStringify(payload)).byteLength > (context.maxPayloadBytes ?? MAX_FUNDING_PAYLOAD_BYTES)) diagnostics.push({ code: 'FUNDING_PAYLOAD_TOO_LARGE', message: `Funding payload exceeds ${context.maxPayloadBytes ?? MAX_FUNDING_PAYLOAD_BYTES} bytes`, source: context.source });
    } catch {
      diagnostics.push({ code: 'MALFORMED_FUNDING_METADATA', message: 'Funding payload is not serializable', source: context.source });
    }
  }
  return diagnostics;
}

