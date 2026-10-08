import { basename, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { Dependency, DependencyType } from '../domain/models.js';
import { addEdge, createDependency, diagnostic, findWorkspaceFiles, normalizePackageName, readBoundedFile } from './common.js';
import { parseSimpleToml } from './toml.js';
import type { DependencyEdge, DiscoveryOptions, PartialDiscovery } from './types.js';

interface LockedPackage { name: string; version?: string; dependencies?: unknown[] }

function manifestEntries(source: string, diagnostics: PartialDiscovery['diagnostics'], path: string): { name: string; spec: unknown; type: DependencyType; locator: string }[] {
  const result: { name: string; spec: unknown; type: DependencyType; locator: string }[] = [];
  try {
    const parsed = parseSimpleToml(source);
    for (const [section, values] of Object.entries(parsed.sections)) {
      let type: DependencyType | undefined;
      if (section === 'dependencies' || section.endsWith('.dependencies')) type = 'runtime';
      else if (section === 'dev-dependencies' || section.endsWith('.dev-dependencies')) type = 'dev';
      else if (section === 'build-dependencies' || section.endsWith('.build-dependencies')) type = 'build';
      if (!type) continue;
      for (const [name, spec] of Object.entries(values)) {
        if (name === 'workspace') continue;
        const inline = typeof spec === 'object' && spec !== null ? spec as Record<string, unknown> : undefined;
        const actualName = typeof inline?.package === 'string' ? inline.package : name;
        const dependencyType = inline?.optional === true ? 'optional' : type;
        result.push({ name: normalizePackageName(actualName), spec, type: dependencyType, locator: `${section}.${name}` });
      }
    }
  } catch (error) {
    diagnostics.push(diagnostic('MALFORMED_MANIFEST', error instanceof Error ? error.message : 'Malformed Cargo.toml', path, 'error'));
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

function lockPackages(source: string): LockedPackage[] {
  const parsed = parseSimpleToml(source);
  return (parsed.arrays.package ?? []).flatMap((entry) => {
    if (typeof entry.name !== 'string') return [];
    const version = typeof entry.version === 'string' ? entry.version : undefined;
    const dependencies = Array.isArray(entry.dependencies) ? entry.dependencies : undefined;
    return [{ name: normalizePackageName(entry.name), ...(version === undefined ? {} : { version }), ...(dependencies === undefined ? {} : { dependencies }) }];
  });
}

function dependencyName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return normalizePackageName(value.trim().split(/\s+/)[0]!);
}

export function discoverCargo(root: string, options: DiscoveryOptions = {}): PartialDiscovery {
  const diagnostics: PartialDiscovery['diagnostics'] = [];
  const graph: { nodes: Dependency[]; edges: DependencyEdge[] } = { nodes: [], edges: [] };
  const projectId = `project:${encodeURIComponent(resolve(root))}`;
  const rootPath = join(root, 'Cargo.toml');
  const rootSource = existsSync(rootPath) ? (() => { try { return readBoundedFile(rootPath, options); } catch (error) { diagnostics.push(diagnostic('MALFORMED_MANIFEST', error instanceof Error ? error.message : 'Unable to read Cargo.toml', rootPath, 'error')); return ''; } })() : '';
  if (!existsSync(rootPath)) diagnostics.push(diagnostic('MANIFEST_MISSING', 'Cargo.toml was not found', rootPath));
  let rootToml: ReturnType<typeof parseSimpleToml> = { sections: {}, arrays: {} };
  try { rootToml = parseSimpleToml(rootSource); } catch (error) { diagnostics.push(diagnostic('MALFORMED_MANIFEST', error instanceof Error ? error.message : 'Malformed Cargo.toml', rootPath, 'error')); }
  const rootName = typeof rootToml.sections.package?.name === 'string' ? rootToml.sections.package.name : basename(root);
  const members = Array.isArray(rootToml.sections.workspace?.members) ? rootToml.sections.workspace.members.filter((item): item is string => typeof item === 'string') : [];
  const manifestPaths = [rootPath, ...findWorkspaceFiles(root, members, 'Cargo.toml')];
  const lockPath = join(root, 'Cargo.lock');
  const locked = new Map<string, LockedPackage>();
  if (existsSync(lockPath)) {
    try {
      for (const entry of lockPackages(readBoundedFile(lockPath, options))) {
        if (!locked.has(entry.name)) locked.set(entry.name, entry);
      }
    } catch (error) {
      diagnostics.push(diagnostic('MALFORMED_LOCKFILE', error instanceof Error ? error.message : 'Malformed Cargo.lock', lockPath));
    }
  } else {
    diagnostics.push(diagnostic('LOCKFILE_MISSING', 'Cargo.lock was not found; only manifest dependencies can be discovered', lockPath));
  }
  const nodesByName = new Map<string, Dependency>();
  for (const entry of locked.values()) {
    const node = createDependency('cargo', entry.name, lockPath, `package.${entry.name}`, 'unknown', undefined, entry.version);
    nodesByName.set(entry.name, node);
    graph.nodes.push(node);
  }
  const ensure = (name: string, spec: unknown, type: DependencyType, sourcePath: string, locator: string, parentId: string): void => {
    const normalized = normalizePackageName(name);
    const lock = locked.get(normalized);
    let node = nodesByName.get(normalized);
    if (!node) {
      const inline = typeof spec === 'object' && spec !== null ? spec as Record<string, unknown> : undefined;
      const requested = typeof inline?.version === 'string' ? inline.version : typeof spec === 'string' ? spec : undefined;
      node = createDependency('cargo', normalized, sourcePath, locator, type, requested, lock?.version);
      nodesByName.set(normalized, node);
      graph.nodes.push(node);
    } else {
      node.dependencyType = type;
      node.source = { path: sourcePath, locator };
    }
    addEdge(graph.edges, parentId, node, type);
  };
  for (const path of manifestPaths) {
    if (!existsSync(path)) continue;
    let source = '';
    try { source = readBoundedFile(path, options); } catch (error) { diagnostics.push(diagnostic('MALFORMED_MANIFEST', error instanceof Error ? error.message : 'Unable to read Cargo.toml', path, 'error')); continue; }
    for (const entry of manifestEntries(source, diagnostics, path)) ensure(entry.name, entry.spec, entry.type, path, entry.locator, projectId);
  }
  for (const entry of locked.values()) {
    const parent = nodesByName.get(entry.name);
    if (!parent || !entry.dependencies) continue;
    for (const dependency of entry.dependencies) {
      const name = dependencyName(dependency);
      const child = name ? nodesByName.get(name) : undefined;
      if (child) addEdge(graph.edges, parent.id, child, 'runtime');
      else if (name) diagnostics.push(diagnostic('DEPENDENCY_UNRESOLVED', `Could not resolve ${name} from Cargo.lock`, lockPath));
    }
  }
  graph.nodes.sort((a, b) => a.id.localeCompare(b.id));
  graph.edges.sort((a, b) => `${a.fromId}:${a.toId}`.localeCompare(`${b.fromId}:${b.toId}`));
  return { ecosystem: 'cargo', projectName: rootName, graph, diagnostics };
}

