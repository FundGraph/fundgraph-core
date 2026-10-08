import { resolve } from 'node:path';
import { existsSync, lstatSync } from 'node:fs';
import { FundGraphError } from '../domain/errors.js';
import { projectFor } from './common.js';
import { discoverCargo } from './cargo.js';
import { discoverNpm } from './npm.js';
import { discoverPypi } from './pypi.js';
import type { DependencyGraph, DiscoveryOptions, DiscoveryResult, PartialDiscovery } from './types.js';
import { diagnostic } from './common.js';

export function discoverDependencies(projectPath: string, options: DiscoveryOptions = {}): DiscoveryResult {
  const root = resolve(projectPath);
  if (!existsSync(root) || !lstatSync(root).isDirectory()) throw new FundGraphError('INVALID_MODEL', `Project path is not a directory: ${projectPath}`);
  const partials: PartialDiscovery[] = [];
  if (existsSync(resolve(root, 'package.json'))) partials.push(discoverNpm(root, options));
  if (existsSync(resolve(root, 'pyproject.toml')) || existsSync(resolve(root, 'requirements.txt'))) partials.push(discoverPypi(root, options));
  if (existsSync(resolve(root, 'Cargo.toml'))) partials.push(discoverCargo(root, options));

  const diagnostics = partials.flatMap((partial) => partial.diagnostics);
  const ecosystems = partials.map((partial) => partial.ecosystem).sort();
  const graph: DependencyGraph = { nodes: [], edges: [] };
  const nodeIds = new Set<string>();
  const edgeKeys = new Set<string>();
  for (const partial of partials) {
    for (const node of partial.graph.nodes) {
      if (!nodeIds.has(node.id)) {
        nodeIds.add(node.id);
        graph.nodes.push(node);
      }
    }
    for (const edge of partial.graph.edges) {
      const key = `${edge.fromId}:${edge.toId}:${edge.source.path}:${edge.source.locator}`;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        graph.edges.push(edge);
      }
    }
  }
  if (partials.length === 0) diagnostics.push(diagnostic('UNSUPPORTED_INPUT', 'No supported project manifest was found. Expected package.json, pyproject.toml, requirements.txt, or Cargo.toml.', resolve(root)));
  const project = projectFor(root, partials[0]?.projectName ?? '', ecosystems, graph.edges.filter((edge) => edge.fromId === `project:${encodeURIComponent(root)}`).map((edge) => edge.toId));
  graph.nodes.sort((a, b) => a.id.localeCompare(b.id));
  graph.edges.sort((a, b) => `${a.fromId}:${a.toId}:${a.source.locator}`.localeCompare(`${b.fromId}:${b.toId}:${b.source.locator}`));
  diagnostics.sort((a, b) => `${a.code}:${a.sourcePath ?? ''}:${a.message}`.localeCompare(`${b.code}:${b.sourcePath ?? ''}:${b.message}`));
  return { project, graph, diagnostics, ecosystems };
}

