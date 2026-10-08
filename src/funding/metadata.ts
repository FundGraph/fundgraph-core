import { makeEvidence, makeSource, safeFundingUrl, validateFundingPayload } from './common.js';
import type { FundingContext, FundingParseResult } from './types.js';

function urlsFromFunding(value: unknown): Array<{ url: string; label?: string }> {
  if (typeof value === 'string') return [{ url: value }];
  if (Array.isArray(value)) return value.flatMap((item) => urlsFromFunding(item));
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record.url === 'string') return [{ url: record.url, ...(typeof record.type === 'string' ? { label: record.type } : {}) }];
  }
  return [];
}

function readFundingValue(ecosystem: 'npm' | 'pypi' | 'cargo', payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;
  if (ecosystem === 'npm') return record.funding;
  if (ecosystem === 'pypi') {
    const info = record.info as Record<string, unknown> | undefined;
    const urls = info?.project_urls as Record<string, unknown> | undefined;
    const funding = Object.entries(urls ?? {}).filter(([key]) => /fund|sponsor|donat/i.test(key)).map(([, value]) => value);
    return funding.length > 0 ? funding : info?.funding;
  }
  return record.funding ?? (record.crate as Record<string, unknown> | undefined)?.funding;
}

export function parsePackageFundingMetadata(ecosystem: 'npm' | 'pypi' | 'cargo', payload: unknown, context: FundingContext): FundingParseResult {
  const diagnostics = validateFundingPayload(payload, context);
  const evidence = makeEvidence('package-metadata', payload, context);
  const sources = urlsFromFunding(readFundingValue(ecosystem, payload)).flatMap(({ url, label }) => {
    const safe = safeFundingUrl(url);
    if (!safe) {
      diagnostics.push({ code: 'UNSAFE_FUNDING_URL', message: `Funding URL was rejected: ${url}`, source: context.source });
      return [];
    }
    return [makeSource(safe, evidence, label)];
  });
  return { sources, evidence: [evidence], diagnostics };
}

