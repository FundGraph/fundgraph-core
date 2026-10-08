export const SCHEMA_VERSION = '1.0' as const;

export type SchemaVersion = typeof SCHEMA_VERSION;
export type Ecosystem = 'npm' | 'pypi' | 'cargo' | (string & {});
export type DependencyType = 'runtime' | 'dev' | 'optional' | 'peer' | 'build' | 'unknown';
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'unknown';
export type RelationshipType =
  | 'depends-on'
  | 'package-repository'
  | 'repository-funding'
  | 'supports';
export type RelationshipStatus = 'supported' | 'ambiguous' | 'contradictory' | 'unresolved';
export type EvidenceKind =
  | 'package-metadata'
  | 'repository-metadata'
  | 'funding-file'
  | 'provider-response'
  | 'local-input'
  | 'derived';

export interface Versioned {
  schemaVersion: SchemaVersion;
}

export interface Project extends Versioned {
  kind: 'Project';
  id: string;
  name: string;
  rootPath: string;
  ecosystems: Ecosystem[];
  dependencyIds: string[];
  analyzedAt?: string;
  toolVersion?: string;
}

export interface Dependency extends Versioned {
  kind: 'Dependency';
  id: string;
  packageId: string;
  requestedVersion?: string;
  resolvedVersion?: string;
  alias?: string;
  dependencyType: DependencyType;
  source: {
    path: string;
    locator: string;
  };
  parentIds: string[];
}

export interface Registry extends Versioned {
  kind: 'Registry';
  id: string;
  ecosystem: Ecosystem;
  name: string;
  baseUrl: string;
  packageUrlTemplate: string;
}

export interface Package extends Versioned {
  kind: 'Package';
  id: string;
  ecosystem: Ecosystem;
  name: string;
  version?: string;
  registryId: string;
  repositoryId?: string;
  evidenceIds: string[];
}

export interface Repository extends Versioned {
  kind: 'Repository';
  id: string;
  url: string;
  host: string;
  owner?: string;
  name?: string;
  evidenceIds: string[];
}

export interface FundingSource extends Versioned {
  kind: 'FundingSource';
  id: string;
  provider: string;
  url: string;
  label?: string;
  evidenceIds: string[];
}

export interface Evidence extends Versioned {
  kind: 'Evidence';
  id: string;
  evidenceKind: EvidenceKind;
  source: string;
  observedAt?: string;
  value: unknown;
  contentHash?: string;
  parser?: string;
}

export interface Confidence extends Versioned {
  kind: 'Confidence';
  id: string;
  level: ConfidenceLevel;
  rationale: string;
  evidenceIds: string[];
}

export interface Relationship extends Versioned {
  kind: 'Relationship';
  id: string;
  type: RelationshipType;
  fromId: string;
  toId: string;
  confidence: Confidence;
  evidenceIds: string[];
  ruleId: string;
  status: RelationshipStatus;
}

export type FundGraphModel =
  | Project
  | Dependency
  | Package
  | Registry
  | Repository
  | FundingSource
  | Evidence
  | Confidence
  | Relationship;

export type ModelKind = FundGraphModel['kind'];


