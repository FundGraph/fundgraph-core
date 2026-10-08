import { makeEvidence, makeSource, safeFundingUrl, validateFundingPayload } from './common.js';
import type { FundingContext, FundingParseResult } from './types.js';

export function parsePublicFundingResponse(provider: string, payload: unknown, context: FundingContext): FundingParseResult {
  const diagnostics = validateFundingPayload(payload, context);
  const evidence = makeEvidence('provider-response', payload, context);
  const sources: FundingParseResult['sources'] = [];
  const values = Array.isArray(payload) ? payload : typeof payload === 'object' && payload !== null ? Object.values(payload as Record<string, unknown>) : [payload];
  for (const value of values) {
    const candidate = typeof value === 'string' ? value : typeof value === 'object' && value !== null ? (value as Record<string, unknown>).url : undefined;
    const url = safeFundingUrl(candidate);
    if (url) sources.push({ ...makeSource(url, evidence), provider });
    else if (candidate !== undefined) diagnostics.push({ code: 'UNSAFE_FUNDING_URL', message: `Provider response contained an invalid funding URL`, source: context.source });
  }
  if (sources.length === 0) diagnostics.push({ code: 'FUNDING_SOURCE_MISSING', message: 'Provider response contained no usable funding URL', source: context.source });
  return { sources, evidence: [evidence], diagnostics };
}

