import { basename, relative, resolve, sep } from 'node:path';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import type { Dependency, DependencyType, Ecosystem, Project } from '../domain/models.js';
import type { DependencyEdge, DiscoveryDiagnostic, DiscoveryOptions } from './types.js';

export const DEFAULT_MAX_FILE_BYTES = 1_048_576;

export function readBoundedFile(path: string, options: DiscoveryOptions = {}): string {
  const maxBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const stats = lstatSync(path);
  if (!stats.isFile()) throw new Error(`Input is not a regular file: ${path}`);
  if (stats.size > maxBytes) throw new Error(`Input exceeds ${maxBytes} bytes: ${path}`);
  return readFileSync(path, 'utf8');
}

export function safeJson(path: string, options?: DiscoveryOptions): unknown {
  return JSON.parse(readBoundedFile(path, options));
}

export function withinRoot(root: string, candidate: string): boolean {
  const rootResolved = resolve(root);
  const candidateResolved = resolve(candidate);
  const pathFromRoot = relative(rootResolved, candidateResolved);
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !/^[A-Za-z]:/.test(pathFromRoot));
}

export function workspacePath(root: string, path: string): string | undefined {
  const candidate = resolve(root, path);
  return withinRoot(root, candidate) ? candidate : undefined;
}

export function idFor(ecosystem: Ecosystem, sourcePath: string, name: string, version?: string): string {
  return `dependency:${encodeURIComponent(`${ecosystem}:${sourcePath}:${name}:${version ?? ''}`)}`;
}

export function normalizePackageName(name: string): string {
  return name.trim().toLowerCase().replace(/[-_.]+/g, '-');
}

export function packageNameFromSpec(key: string, spec: unknown): { name: string; alias?: string; requestedVersion?: string } {
  const raw = typeof spec === 'string' ? spec.trim() : '';
  const aliasMatch = raw.match(/^npm:([^@]+)@(.+)$/);
  if (aliasMatch) return { name: aliasMatch[1]!, alias: key, ...(aliasMatch[2] === undefined ? {} : { requestedVersion: aliasMatch[2] }) };
  const versionMatch = raw.match(/(?:^|\s|\^|~|>=|<=|>|<|=)(v?\d[^\s]*)/);
  const requestedVersion = versionMatch?.[1] ?? (raw || undefined);
  return { name: key, ...(requestedVersion === undefined ? {} : { requestedVersion }) };
}

export function createDependency(
  ecosystem: Ecosystem,
  name: string,
  sourcePath: string,
  locator: string,
  dependencyType: DependencyType,
  requestedVersion?: string,
  resolvedVersion?: string,
  alias?: string,
): Dependency {
  const dependency: Dependency = {
    schemaVersion: '1.0',
    kind: 'Dependency',
    id: idFor(ecosystem, sourcePath, name, resolvedVersion ?? requestedVersion),
    packageId: `${ecosystem}:${ecosystem === 'go' ? name.trim() : normalizePackageName(name)}`,
    dependencyType,
    source: { path: sourcePath, locator },
    parentIds: [],
  };
  if (requestedVersion !== undefined) dependency.requestedVersion = requestedVersion;
  if (resolvedVersion !== undefined) dependency.resolvedVersion = resolvedVersion;
  if (alias !== undefined) dependency.alias = alias;
  return dependency;
}

export function addEdge(edges: DependencyEdge[], fromId: string, to: Dependency, dependencyType: DependencyType): void {
  edges.push({ fromId, toId: to.id, dependencyType, source: to.source });
  if (!to.parentIds.includes(fromId)) to.parentIds.push(fromId);
}

export function diagnostic(code: DiscoveryDiagnostic['code'], message: string, sourcePath?: string, severity: DiscoveryDiagnostic['severity'] = 'warning'): DiscoveryDiagnostic {
  return { code, severity, message, ...(sourcePath === undefined ? {} : { sourcePath }) };
}

export function projectFor(rootPath: string, name: string, ecosystems: Ecosystem[], dependencyIds: string[]): Project {
  return {
    schemaVersion: '1.0',
    kind: 'Project',
    id: `project:${encodeURIComponent(resolve(rootPath))}`,
    name: name || basename(rootPath),
    rootPath: resolve(rootPath),
    ecosystems,
    dependencyIds,
  };
}

export function findWorkspaceFiles(root: string, patterns: string[], filename: string): string[] {
  const results: string[] = [];
  for (const pattern of patterns) {
    const normalized = pattern.replaceAll('\\', '/').replace(/^\.\//, '');
    if (!normalized.includes('*')) {
      const path = workspacePath(root, resolve(root, normalized, filename));
      if (path && existsSync(path)) results.push(path);
      continue;
    }
    const parts = normalized.split('/');
    const starIndex = parts.findIndex((part) => part.includes('*'));
    const base = workspacePath(root, resolve(root, ...parts.slice(0, starIndex)));
    if (!base || !existsSync(base)) continue;
    for (const entry of lstatSync(base).isDirectory() ? readdirSync(base) : []) {
      const candidate = workspacePath(root, resolve(base, entry, ...parts.slice(starIndex + 1), filename));
      if (candidate && existsSync(candidate)) results.push(candidate);
    }
  }
  return [...new Set(results)].sort();
}

