import type { Dependency, Ecosystem, Project } from '../domain/models.js';

export type DiscoveryDiagnosticCode =
  | 'MANIFEST_MISSING'
  | 'LOCKFILE_MISSING'
  | 'MALFORMED_MANIFEST'
  | 'MALFORMED_LOCKFILE'
  | 'UNSUPPORTED_INPUT'
  | 'WORKSPACE_INVALID'
  | 'DEPENDENCY_UNRESOLVED'
  | 'INPUT_TOO_LARGE';

export interface DiscoveryDiagnostic {
  code: DiscoveryDiagnosticCode;
  severity: 'warning' | 'error';
  message: string;
  sourcePath?: string;
}

export interface DependencyEdge {
  fromId: string;
  toId: string;
  dependencyType: Dependency['dependencyType'];
  source: {
    path: string;
    locator: string;
  };
}

export interface DependencyGraph {
  nodes: Dependency[];
  edges: DependencyEdge[];
}

export interface DiscoveryResult {
  project: Project;
  graph: DependencyGraph;
  diagnostics: DiscoveryDiagnostic[];
  ecosystems: Ecosystem[];
}

export interface PartialDiscovery {
  ecosystem: Ecosystem;
  projectName: string;
  graph: DependencyGraph;
  diagnostics: DiscoveryDiagnostic[];
}

export interface DiscoveryOptions {
  maxFileBytes?: number;
}

