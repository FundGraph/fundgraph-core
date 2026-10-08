import { basename, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { Dependency, DependencyType } from '../domain/models.js';
import { addEdge, createDependency, diagnostic, normalizePackageName, readBoundedFile } from './common.js';
import { parseSimpleToml } from './toml.js';
import type { DependencyEdge, DiscoveryOptions, PartialDiscovery } from './types.js';

interface LockedPackage { name: string; version?: string; dependencies?: Record<string, unknown> }

function requirementName(raw: string): { name: string; version?: string } | undefined {
  const line = raw.trim().split(';')[0]!.trim();
  if (!line || line.startsWith('#') || line.startsWith('-')) return undefined;
  const match = line.match(/^([A-Za-z0-9][A-Za-z0-9_.-]*)(?:\[[^\]]+\])?(?:\s*(.*))?$/);
  if (!match) return undefined;
  const version = match[2]?.trim() || undefined;
  return { name: normalizePackageName(match[1]!), ...(version === undefined ? {} : { version }) };
}

function directDependencies(path: string, source: string, diagnostics: PartialDiscovery['diagnostics']): Array<{ name: string; spec: unknown; type: DependencyType; locator: string }> {
  const result: Array<{ name: string; spec: unknown; type: DependencyType; locator: string }> = [];
  try {
    if (path.endsWith('requirements.txt')) {
      source.split(/\r?\n/).forEach((line, index) => {
        const dependency = requirementName(line);
        if (dependency) result.push({ name: dependency.name, spec: dependency.version, type: 'runtime', locator: `requirements[${index}]` });
      });
      return result;
    }
    const toml = parseSimpleToml(source);
    const project = toml.sections.project ?? {};
    const dependencies = project.dependencies;
    if (Array.isArray(dependencies)) dependencies.forEach((item, index) => {
      if (typeof item !== 'string') return;
      const dependency = requirementName(item);
      if (dependency) result.push({ name: dependency.name, spec: dependency.version, type: 'runtime', locator: `project.dependencies[${index}]` });
    });
    for (const [section, values] of Object.entries(toml.sections)) {
      if (section.startsWith('project.optional-dependencies.')) {
        const optionalValues = values.dependencies;
        if (!Array.isArray(optionalValues)) continue;
        for (const [index, item] of optionalValues.entries()) {
          if (typeof item !== 'string') continue;
          const dependency = requirementName(item);
          if (dependency) result.push({ name: dependency.name, spec: dependency.version, type: 'optional', locator: `${section}.${index}` });
        }
      }
    }
    const poetry = toml.sections['tool.poetry.dependencies'] ?? {};
    for (const [name, spec] of Object.entries(poetry)) {
      if (name.toLowerCase() === 'python') continue;
      result.push({ name: normalizePackageName(name), spec, type: 'runtime', locator: `tool.poetry.dependencies.${name}` });
    }
  } catch (error) {
    diagnostics.push(diagnostic('MALFORMED_MANIFEST', error instanceof Error ? error.message : 'Malformed Python manifest', path, 'error'));
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

function parsePoetryLock(path: string, source: string): LockedPackage[] {
  const parsed = parseSimpleToml(source);
  return (parsed.arrays.package ?? []).flatMap((entry) => {
    const name = typeof entry.name === 'string' ? normalizePackageName(entry.name) : undefined;
    if (!name) return [];
    const version = typeof entry.version === 'string' ? entry.version : undefined;
    const dependencies = typeof entry.dependencies === 'object' && entry.dependencies !== null ? entry.dependencies as Record<string, unknown> : undefined;
    return [{ name, ...(version === undefined ? {} : { version }), ...(dependencies === undefined ? {} : { dependencies }) }];
  });
}

export function discoverPypi(root: string, options: DiscoveryOptions = {}): PartialDiscovery {
  const diagnostics: PartialDiscovery['diagnostics'] = [];
  const graph: { nodes: Dependency[]; edges: DependencyEdge[] } = { nodes: [], edges: [] };
  const projectId = `project:${encodeURIComponent(resolve(root))}`;
  const manifestCandidates = ['pyproject.toml', 'requirements.txt'];
  const manifestPath = manifestCandidates.map((file) => join(root, file)).find(existsSync);
  const manifestSource = manifestPath ? (() => { try { return readBoundedFile(manifestPath, options); } catch (error) { diagnostics.push(diagnostic('MALFORMED_MANIFEST', error instanceof Error ? error.message : 'Unable to read Python manifest', manifestPath, 'error')); return ''; } })() : '';
  if (!manifestPath) diagnostics.push(diagnostic('MANIFEST_MISSING', 'No pyproject.toml or requirements.txt was found', join(root, 'pyproject.toml')));
  const manifestEntries = manifestPath ? directDependencies(manifestPath, manifestSource, diagnostics) : [];
  const projectName = manifestPath && manifestPath.endsWith('pyproject.toml') ? (() => { try { const project = parseSimpleToml(manifestSource).sections.project; return typeof project?.name === 'string' ? project.name : basename(root); } catch { return basename(root); } })() : basename(root);

  const lockPath = join(root, 'poetry.lock');
  const locked = new Map<string, LockedPackage>();
  if (existsSync(lockPath)) {
    try {
      for (const entry of parsePoetryLock(lockPath, readBoundedFile(lockPath, options))) locked.set(entry.name, entry);
    } catch (error) {
      diagnostics.push(diagnostic('MALFORMED_LOCKFILE', error instanceof Error ? error.message : 'Malformed poetry.lock', lockPath));
    }
  } else {
    diagnostics.push(diagnostic('LOCKFILE_MISSING', 'poetry.lock was not found; only manifest dependencies can be discovered', lockPath));
  }

  const nodesByName = new Map<string, Dependency>();
  for (const entry of locked.values()) {
    const node = createDependency('pypi', entry.name, lockPath, `package.${entry.name}`, 'unknown', undefined, entry.version);
    nodesByName.set(entry.name, node);
    graph.nodes.push(node);
  }
  const ensure = (name: string, spec: unknown, type: DependencyType, sourcePath: string, locator: string, parentId: string): void => {
    const normalized = normalizePackageName(name);
    const lock = locked.get(normalized);
    let node = nodesByName.get(normalized);
    if (!node) {
      node = createDependency('pypi', normalized, sourcePath, locator, type, typeof spec === 'string' ? spec : undefined, lock?.version);
      nodesByName.set(normalized, node);
      graph.nodes.push(node);
    } else {
      node.dependencyType = type;
      node.source = { path: sourcePath, locator };
    }
    addEdge(graph.edges, parentId, node, type);
  };
  for (const entry of manifestEntries) ensure(entry.name, entry.spec, entry.type, manifestPath ?? root, entry.locator, projectId);
  for (const entry of locked.values()) {
    const parent = nodesByName.get(entry.name);
    if (!parent || !entry.dependencies) continue;
    for (const [name, spec] of Object.entries(entry.dependencies)) {
      const normalized = normalizePackageName(name);
      const child = nodesByName.get(normalized);
      if (child) addEdge(graph.edges, parent.id, child, 'runtime');
      else diagnostics.push(diagnostic('DEPENDENCY_UNRESOLVED', `Could not resolve ${name} from poetry.lock`, lockPath));
    }
  }
  graph.nodes.sort((a, b) => a.id.localeCompare(b.id));
  graph.edges.sort((a, b) => `${a.fromId}:${a.toId}`.localeCompare(`${b.fromId}:${b.toId}`));
  return { ecosystem: 'pypi', projectName, graph, diagnostics };
}

