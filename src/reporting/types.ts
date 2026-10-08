import type {
  Dependency,
  Evidence,
  FundingSource,
  Package,
  Project,
  Registry,
  Relationship,
  Repository,
} from '../domain/models.js';

export const REPORT_SCHEMA_VERSION = '1.0' as const;

export interface ReportDiagnostic {
  code: string;
  message: string;
  source?: string;
}

export interface ReportAction {
  kind: 'review' | 'inspect';
  label: string;
  targetId?: string;
  url?: string;
}

export interface ReportInput {
  project?: Project;
  dependencies?: readonly Dependency[];
  packages?: readonly Package[];
  registries?: readonly Registry[];
  repositories?: readonly Repository[];
  fundingSources?: readonly FundingSource[];
  evidence?: readonly Evidence[];
  relationships?: readonly Relationship[];
  diagnostics?: readonly (ReportDiagnostic | string)[];
  limitations?: readonly string[];
  actions?: readonly ReportAction[];
}

export interface ReportSummary {
  dependencyCount: number;
  packageCount: number;
  registryCount: number;
  repositoryCount: number;
  fundingSourceCount: number;
  evidenceCount: number;
  relationshipCount: number;
  supportedCount: number;
  ambiguousCount: number;
  contradictoryCount: number;
  unresolvedCount: number;
}

export interface ReportDocument {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  kind: 'FundGraphReport';
  generatedBy: '@fundgraph/core';
  project?: Project;
  summary: ReportSummary;
  dependencies: Dependency[];
  packages: Package[];
  registries: Registry[];
  repositories: Repository[];
  fundingSources: FundingSource[];
  evidence: Evidence[];
  relationships: Relationship[];
  diagnostics: ReportDiagnostic[];
  limitations: string[];
  actions: ReportAction[];
}
