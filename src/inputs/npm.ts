import { basename, dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { Dependency, DependencyType } from '../domain/models.js';
import { addEdge, createDependency, diagnostic, findWorkspaceFiles, packageNameFromSpec, readBoundedFile } from './common.js';
import type { DependencyEdge, DiscoveryOptions, PartialDiscovery } from './types.js';

interface PackageLockEntry {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  optional?: boolean;
}

function dependencyEntries(manifest: Record<string, unknown>): Array<{ name: string; spec: unknown; type: DependencyType }> {
  const result = new Map<string, { name: string; spec: unknown; type: DependencyType }>();
  const groups: Array<[string, DependencyType]> = [
    ['dependencies', 'runtime'],
    ['devDependencies', 'dev'],
    ['optionalDependencies', 'optional'],
    ['peerDependencies', 'peer'],
  ];
  for (const [field, type] of groups) {
    const values = manifest[field];
    if (typeof values !== 'object' || values === null || Array.isArray(values)) continue;
    for (const [name, spec] of Object.entries(values as Record<string, unknown>)) {
      if (!result.has(name) || type === 'optional') result.set(name, { name, spec, type });
    }
  }
  return [...result.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function readManifest(path: string, options: DiscoveryOptions, diagnostics: PartialDiscovery['diagnostics']): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readBoundedFile(path, options));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('manifest must be a JSON object');
    return parsed as Record<string, unknown>;
  } catch (error) {
    diagnostics.push(diagnostic('MALFORMED_MANIFEST', error instanceof Error ? error.message : 'Malformed package.json', path, 'error'));
    return undefined;
  }
}

function lockKeyFor(parentKey: string, name: string, entries: Record<string, PackageLockEntry>): string | undefined {
  const candidates: string[] = [];
  let current = parentKey;
  while (true) {
    candidates.push(`${current ? `${current}/` : ''}node_modules/${name}`);
    const marker = current.lastIndexOf('/node_modules/');
    if (marker < 0) break;
    current = current.slice(0, marker);
  }
  candidates.push(`node_modules/${name}`);
  return candidates.find((candidate) => entries[candidate] !== undefined);
}

export function discoverNpm(root: string, options: DiscoveryOptions = {}): PartialDiscovery {
  const manifestPath = join(root, 'package.json');
  const diagnostics: PartialDiscovery['diagnostics'] = [];
  const graph: { nodes: Dependency[]; edges: DependencyEdge[] } = { nodes: [], edges: [] };
  const nodeByLockKey = new Map<string, Dependency>();
  const rootManifest = readManifest(manifestPath, options, diagnostics) ?? {};
  const rootName = typeof rootManifest.name === 'string' ? rootManifest.name : basename(root);
  const workspacePatterns = Array.isArray(rootManifest.workspaces)
    ? rootManifest.workspaces.filter((item): item is string => typeof item === 'string')
    : typeof rootManifest.workspaces === 'object' && rootManifest.workspaces !== null && Array.isArray((rootManifest.workspaces as { packages?: unknown }).packages)
      ? ((rootManifest.workspaces as { packages: unknown[] }).packages.filter((item): item is string => typeof item === 'string'))
      : [];
  const manifestPaths = [manifestPath, ...findWorkspaceFiles(root, workspacePatterns, 'package.json')];

  const lockPath = join(root, 'package-lock.json');
  let lockEntries: Record<string, PackageLockEntry> = {};
  if (existsSync(lockPath)) {
    try {
      const lock: unknown = JSON.parse(readBoundedFile(lockPath, options));
      if (typeof lock !== 'object' || lock === null || typeof (lock as { packages?: unknown }).packages !== 'object') throw new Error('package-lock.json must contain a packages object');
      lockEntries = (lock as { packages: Record<string, PackageLockEntry> }).packages;
      for (const [lockKey, entry] of Object.entries(lockEntries)) {
        if (!lockKey || !entry || typeof entry !== 'object') continue;
        const marker = lockKey.lastIndexOf('node_modules/');
        const lockName = marker >= 0 ? lockKey.slice(marker + 'node_modules/'.length) : lockKey;
        const name = entry.name ?? lockName;
        const node = createDependency('npm', name, lockPath, `packages.${lockKey}`, entry.optional ? 'optional' : 'unknown', undefined, entry.version);
        graph.nodes.push(node);
        nodeByLockKey.set(lockKey, node);
      }
    } catch (error) {
      diagnostics.push(diagnostic('MALFORMED_LOCKFILE', error instanceof Error ? error.message : 'Malformed package-lock.json', lockPath));
    }
  } else {
    diagnostics.push(diagnostic('LOCKFILE_MISSING', 'package-lock.json was not found; only manifest dependencies can be discovered', lockPath));
  }

  const ensureManifestDependency = (name: string, spec: unknown, type: DependencyType, sourcePath: string, parentId: string, locator: string): void => {
    const parsed = packageNameFromSpec(name, spec);
    const lockKey = lockKeyFor('', name, lockEntries) ?? lockKeyFor('', parsed.name, lockEntries);
    let node = lockKey ? nodeByLockKey.get(lockKey) : undefined;
    if (!node) {
      node = createDependency('npm', parsed.name, sourcePath, locator, type, parsed.requestedVersion, undefined, parsed.alias);
      graph.nodes.push(node);
    } else {
      node.dependencyType = type;
      node.source = { path: sourcePath, locator };
      if (parsed.alias) node.alias = parsed.alias;
      if (parsed.requestedVersion) node.requestedVersion = parsed.requestedVersion;
    }
    addEdge(graph.edges, parentId, node, type);
  };

  const projectId = `project:${encodeURIComponent(resolve(root))}`;
  for (const path of manifestPaths) {
    const manifest = readManifest(path, options, diagnostics);
    if (!manifest) continue;
    const parentId = path === manifestPath ? projectId : `workspace:${encodeURIComponent(path)}`;
    for (const entry of dependencyEntries(manifest)) ensureManifestDependency(entry.name, entry.spec, entry.type, path, parentId, `${path === manifestPath ? '' : 'workspace.'}dependencies.${entry.name}`);
  }

  for (const [lockKey, entry] of Object.entries(lockEntries)) {
    const parent = nodeByLockKey.get(lockKey);
    if (!parent || !entry.dependencies) continue;
    for (const [name, spec] of Object.entries(entry.dependencies)) {
      const childKey = lockKeyFor(lockKey, name, lockEntries);
      const child = childKey ? nodeByLockKey.get(childKey) : undefined;
      if (child) addEdge(graph.edges, parent.id, child, 'runtime');
      else diagnostics.push(diagnostic('DEPENDENCY_UNRESOLVED', `Could not resolve ${name} from ${lockKey}`, lockPath));
    }
  }
  graph.nodes.sort((a, b) => a.id.localeCompare(b.id));
  graph.edges.sort((a, b) => `${a.fromId}:${a.toId}`.localeCompare(`${b.fromId}:${b.toId}`));
  return { ecosystem: 'npm', projectName: rootName, graph, diagnostics };
}

