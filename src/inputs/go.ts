import { basename, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { Dependency, DependencyType } from '../domain/models.js';
import { addEdge, createDependency, diagnostic, readBoundedFile } from './common.js';
import type { DependencyEdge, DiscoveryOptions, PartialDiscovery } from './types.js';

interface GoRequirement {
  name: string;
  version: string;
  dependencyType: DependencyType;
  line: number;
}

function parseRequirement(line: string, lineNumber: number, diagnostics: PartialDiscovery['diagnostics'], path: string): GoRequirement | undefined {
  const dependencyType: DependencyType = /\/\/\s*indirect\s*$/.test(line) ? 'unknown' : 'runtime';
  const withoutComment = line.replace(/\/\/.*$/, '').trim();
  if (!withoutComment) return undefined;
  const tokens = withoutComment.split(/\s+/);
  if (tokens.length < 2 || !tokens[0] || !tokens[1] || tokens.length > 2) {
    diagnostics.push(diagnostic('MALFORMED_MANIFEST', `Malformed Go require directive on line ${lineNumber}`, path, 'error'));
    return undefined;
  }
  const name = tokens[0];
  const version = tokens[1];
  if (!/^[A-Za-z0-9][A-Za-z0-9._~/-]*$/.test(name) || !/^v\d+/.test(version)) {
    diagnostics.push(diagnostic('MALFORMED_MANIFEST', `Invalid Go module requirement on line ${lineNumber}`, path, 'error'));
    return undefined;
  }
  return { name, version, dependencyType, line: lineNumber };
}

function parseGoMod(source: string, path: string, diagnostics: PartialDiscovery['diagnostics']): { moduleName?: string; requirements: GoRequirement[] } {
  let moduleName: string | undefined;
  let inRequireBlock = false;
  const requirements: GoRequirement[] = [];
  source.split(/\r?\n/).forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) return;
    const moduleMatch = trimmed.match(/^module\s+([^\s]+)$/);
    if (moduleMatch) {
      if (moduleName !== undefined) diagnostics.push(diagnostic('MALFORMED_MANIFEST', `Duplicate module directive on line ${lineNumber}`, path, 'error'));
      else moduleName = moduleMatch[1];
      return;
    }
    if (/^require\s*\($/.test(trimmed)) {
      inRequireBlock = true;
      return;
    }
    if (inRequireBlock && trimmed === ')') {
      inRequireBlock = false;
      return;
    }
    const single = trimmed.match(/^require\s+(.+)$/);
    if (single) {
      const requirement = parseRequirement(single[1]!, lineNumber, diagnostics, path);
      if (requirement) requirements.push(requirement);
      return;
    }
    if (inRequireBlock) {
      const requirement = parseRequirement(trimmed, lineNumber, diagnostics, path);
      if (requirement) requirements.push(requirement);
    }
  });
  if (inRequireBlock) diagnostics.push(diagnostic('MALFORMED_MANIFEST', 'Unclosed require block in go.mod', path, 'error'));
  if (!moduleName) diagnostics.push(diagnostic('MALFORMED_MANIFEST', 'go.mod has no module directive', path, 'error'));
  const unique = new Map<string, GoRequirement>();
  for (const requirement of requirements) unique.set(`${requirement.name}@${requirement.version}`, requirement);
  return { ...(moduleName === undefined ? {} : { moduleName }), requirements: [...unique.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)) };
}

export function discoverGo(root: string, options: DiscoveryOptions = {}): PartialDiscovery {
  const diagnostics: PartialDiscovery['diagnostics'] = [];
  const graph: { nodes: Dependency[]; edges: DependencyEdge[] } = { nodes: [], edges: [] };
  const projectId = `project:${encodeURIComponent(resolve(root))}`;
  const manifestPath = join(root, 'go.mod');
  if (!existsSync(manifestPath)) {
    diagnostics.push(diagnostic('MANIFEST_MISSING', 'go.mod was not found', manifestPath));
    return { ecosystem: 'go', projectName: basename(root), graph, diagnostics };
  }
  let source = '';
  try { source = readBoundedFile(manifestPath, options); } catch (error) {
    diagnostics.push(diagnostic('MALFORMED_MANIFEST', error instanceof Error ? error.message : 'Unable to read go.mod', manifestPath, 'error'));
  }
  const parsed = parseGoMod(source, manifestPath, diagnostics);
  for (const requirement of parsed.requirements) {
    const node = createDependency('go', requirement.name, manifestPath, `require[${requirement.line}]`, requirement.dependencyType, requirement.version, requirement.version);
    graph.nodes.push(node);
    addEdge(graph.edges, projectId, node, requirement.dependencyType);
  }
  graph.nodes.sort((a, b) => a.id.localeCompare(b.id));
  graph.edges.sort((a, b) => `${a.fromId}:${a.toId}`.localeCompare(`${b.fromId}:${b.toId}`));
  return { ecosystem: 'go', projectName: parsed.moduleName ?? basename(root), graph, diagnostics };
}
