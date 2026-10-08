import type { Evidence, FundingSource } from '../domain/models.js';

export type FundingDiagnosticCode =
  | 'MALFORMED_FUNDING_METADATA'
  | 'MALFORMED_FUNDING_FILE'
  | 'UNSAFE_FUNDING_URL'
  | 'FUNDING_PAYLOAD_TOO_LARGE'
  | 'FUNDING_SOURCE_MISSING';

export interface FundingDiagnostic {
  code: FundingDiagnosticCode;
  message: string;
  source?: string;
}

export interface FundingContext {
  source: string;
  observedAt: string;
  parser?: string;
  maxPayloadBytes?: number;
}

export interface FundingParseResult {
  sources: FundingSource[];
  evidence: Evidence[];
  diagnostics: FundingDiagnostic[];
}

