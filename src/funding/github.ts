import { makeEvidence, makeSource, safeFundingUrl, validateFundingPayload } from './common.js';
import type { FundingContext, FundingParseResult } from './types.js';

const SUPPORTED_KEYS = new Set(['github', 'patreon', 'open_collective', 'ko_fi', 'liberapay', 'drips', 'custom', 'polar', 'tidelift']);
const PROVIDER_HOSTS: Record<string, string> = {
  github: 'https://github.com/sponsors/',
  patreon: 'https://www.patreon.com/',
  open_collective: 'https://opencollective.com/',
  ko_fi: 'https://ko-fi.com/',
  liberapay: 'https://liberapay.com/',
  drips: 'https://www.drips.network/app/projects/',
  polar: 'https://polar.sh/',
};

function stripComment(line: string): string { return line.replace(/\s+#.*$/, '').trim(); }
function values(raw: string): string[] {
  const value = raw.trim();
  if (value.startsWith('[') && value.endsWith(']')) return value.slice(1, -1).split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  return [value.replace(/^['"]|['"]$/g, '')];
}

function endpoint(key: string, value: string): string | undefined {
  if (key === 'custom') return safeFundingUrl(value);
  if (key === 'tidelift') return safeFundingUrl(value.startsWith('http') ? value : `https://tidelift.com/funding/${value}`);
  const base = PROVIDER_HOSTS[key];
  return base ? safeFundingUrl(`${base}${value.replace(/^@/, '')}`) : undefined;
}

export function parseGithubFundingFile(source: string, context: FundingContext): FundingParseResult {
  const diagnostics = validateFundingPayload(source, context);
  const evidence = makeEvidence('funding-file', source, context);
  const sources = [] as FundingParseResult['sources'];
  try {
    for (const rawLine of source.split(/\r?\n/)) {
      const line = stripComment(rawLine);
      if (!line || line.startsWith('#')) continue;
      const separator = line.indexOf(':');
      if (separator < 1) {
        diagnostics.push({ code: 'MALFORMED_FUNDING_FILE', message: `Malformed FUNDING.yml line: ${rawLine}`, source: context.source });
        continue;
      }
      const key = line.slice(0, separator).trim();
      if (!SUPPORTED_KEYS.has(key)) continue;
      for (const item of values(line.slice(separator + 1))) {
        const url = endpoint(key, item);
        if (!url) diagnostics.push({ code: 'UNSAFE_FUNDING_URL', message: `Funding entry was rejected for ${key}`, source: context.source });
        else sources.push(makeSource(url, evidence, key));
      }
    }
  } catch (error) {
    diagnostics.push({ code: 'MALFORMED_FUNDING_FILE', message: error instanceof Error ? error.message : 'Malformed FUNDING.yml', source: context.source });
  }
  return { sources, evidence: [evidence], diagnostics };
}

