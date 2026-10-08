import type { Evidence, FundingSource, Package, Relationship, Repository } from '../domain/models.js';

export interface RepositoryCandidate {
  packageId: string;
  repositoryId: string;
  evidenceIds: string[];
  ruleId: string;
}

export interface FundingClaim {
  repositoryId: string;
  fundingSourceId: string;
  evidenceIds: string[];
  ruleId: string;
}

export interface ResolutionInput {
  packages: Package[];
  repositories: Repository[];
  fundingSources: FundingSource[];
  evidence?: Evidence[];
  repositoryCandidates?: RepositoryCandidate[];
  fundingClaims?: FundingClaim[];
}

export interface ResolutionResult {
  relationships: Relationship[];
  diagnostics: string[];
}

