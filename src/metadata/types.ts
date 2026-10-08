import type { Evidence, Package, Registry, Repository } from '../domain/models.js';

export type MetadataEcosystem = 'npm' | 'pypi' | 'cargo';

export type MetadataDiagnosticCode =
  | 'MALFORMED_METADATA'
  | 'MISSING_METADATA_FIELD'
  | 'UNSAFE_METADATA_SOURCE'
  | 'UNSUPPORTED_METADATA'
  | 'PAYLOAD_TOO_LARGE';

export interface MetadataDiagnostic {
  code: MetadataDiagnosticCode;
  message: string;
}

export interface MetadataContext {
  source: string;
  observedAt: string;
  parser?: string;
  maxPayloadBytes?: number;
}

export interface MetadataParseResult {
  registry: Registry;
  package?: Package;
  repository?: Repository;
  evidence: Evidence[];
  diagnostics: MetadataDiagnostic[];
}

