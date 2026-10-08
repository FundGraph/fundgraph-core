import { FundGraphError } from './errors.js';
import {
  SCHEMA_VERSION,
  type Confidence,
  type FundGraphModel,
  type ModelKind,
  type Relationship,
} from './models.js';

const MAX_STRING_LENGTH = 4_096;
const MAX_JSON_LENGTH = 64 * 1024;
const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:']);
const KINDS = new Set<ModelKind>([
  'Project',
  'Dependency',
  'Package',
  'Registry',
  'Repository',
  'FundingSource',
  'Evidence',
  'Confidence',
  'Relationship',
]);

function invalid(message: string, path?: string): never {
  throw new FundGraphError('INVALID_MODEL', message, path);
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) invalid('Expected a non-empty string', path);
  if (value.length > MAX_STRING_LENGTH) {
    throw new FundGraphError('FIELD_TOO_LARGE', `String exceeds ${MAX_STRING_LENGTH} characters`, path);
  }
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) invalid('Expected an array of strings', path);
  return value.map((item, index) => stringValue(item, `${path}[${index}]`));
}

function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : stringValue(value, path);
}

function urlValue(value: unknown, path: string): string {
  const url = stringValue(value, path);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new FundGraphError('UNSAFE_URL', 'Value is not a valid URL', path);
  }
  if (!SAFE_URL_PROTOCOLS.has(parsed.protocol) || parsed.username || parsed.password) {
    throw new FundGraphError('UNSAFE_URL', 'Only credential-free HTTP(S) URLs are allowed', path);
  }
  return url;
}

function schemaAndKind(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid('Expected an object');
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== SCHEMA_VERSION) {
    throw new FundGraphError('UNSUPPORTED_SCHEMA', `Expected schema version ${SCHEMA_VERSION}`, 'schemaVersion');
  }
  if (typeof record.kind !== 'string' || !KINDS.has(record.kind as ModelKind)) invalid('Unknown model kind', 'kind');
  return record;
}

function validateConfidence(value: unknown, path: string): asserts value is Confidence {
  const record = schemaAndKind(value);
  if (record.kind !== 'Confidence') invalid('Expected Confidence', `${path}.kind`);
  if (!['high', 'medium', 'low', 'unknown'].includes(stringValue(record.level, `${path}.level`))) {
    invalid('Invalid confidence level', `${path}.level`);
  }
  stringValue(record.rationale, `${path}.rationale`);
  stringArray(record.evidenceIds, `${path}.evidenceIds`);
}

export function validateModel(value: unknown): asserts value is FundGraphModel {
  const record = schemaAndKind(value);
  const kind = record.kind as ModelKind;
  stringValue(record.schemaVersion, 'schemaVersion');
  stringValue(record.id, 'id');

  switch (kind) {
    case 'Project':
      stringValue(record.name, 'name');
      stringValue(record.rootPath, 'rootPath');
      stringArray(record.ecosystems, 'ecosystems');
      stringArray(record.dependencyIds, 'dependencyIds');
      optionalString(record.analyzedAt, 'analyzedAt');
      optionalString(record.toolVersion, 'toolVersion');
      break;
    case 'Dependency':
      stringValue(record.packageId, 'packageId');
      optionalString(record.requestedVersion, 'requestedVersion');
      optionalString(record.resolvedVersion, 'resolvedVersion');
      if (!['runtime', 'dev', 'optional', 'peer', 'build', 'unknown'].includes(stringValue(record.dependencyType, 'dependencyType'))) {
        invalid('Invalid dependency type', 'dependencyType');
      }
      if (typeof record.source !== 'object' || record.source === null || Array.isArray(record.source)) invalid('Expected source object', 'source');
      stringValue((record.source as Record<string, unknown>).path, 'source.path');
      stringValue((record.source as Record<string, unknown>).locator, 'source.locator');
      stringArray(record.parentIds, 'parentIds');
      break;
    case 'Registry':
      stringValue(record.ecosystem, 'ecosystem');
      stringValue(record.name, 'name');
      urlValue(record.baseUrl, 'baseUrl');
      urlValue(record.packageUrlTemplate, 'packageUrlTemplate');
      break;
    case 'Package':
      stringValue(record.ecosystem, 'ecosystem');
      stringValue(record.name, 'name');
      optionalString(record.version, 'version');
      stringValue(record.registryId, 'registryId');
      optionalString(record.repositoryId, 'repositoryId');
      stringArray(record.evidenceIds, 'evidenceIds');
      break;
    case 'Repository':
      urlValue(record.url, 'url');
      stringValue(record.host, 'host');
      optionalString(record.owner, 'owner');
      optionalString(record.name, 'name');
      stringArray(record.evidenceIds, 'evidenceIds');
      break;
    case 'FundingSource':
      stringValue(record.provider, 'provider');
      urlValue(record.url, 'url');
      optionalString(record.label, 'label');
      stringArray(record.evidenceIds, 'evidenceIds');
      break;
    case 'Evidence':
      if (!['package-metadata', 'repository-metadata', 'funding-file', 'provider-response', 'local-input', 'derived'].includes(stringValue(record.evidenceKind, 'evidenceKind'))) {
        invalid('Invalid evidence kind', 'evidenceKind');
      }
      stringValue(record.source, 'source');
      optionalString(record.observedAt, 'observedAt');
      optionalString(record.contentHash, 'contentHash');
      optionalString(record.parser, 'parser');
      const serialized = JSON.stringify(record.value);
      if (serialized === undefined || serialized.length > MAX_JSON_LENGTH) {
        throw new FundGraphError('FIELD_TOO_LARGE', `Evidence value exceeds ${MAX_JSON_LENGTH} bytes`, 'value');
      }
      break;
    case 'Confidence':
      validateConfidence(record, 'confidence');
      break;
    case 'Relationship':
      if (!['depends-on', 'package-repository', 'repository-funding', 'supports'].includes(stringValue(record.type, 'type'))) {
        invalid('Invalid relationship type', 'type');
      }
      stringValue(record.fromId, 'fromId');
      stringValue(record.toId, 'toId');
      validateConfidence(record.confidence, 'confidence');
      stringArray(record.evidenceIds, 'evidenceIds');
      stringValue(record.ruleId, 'ruleId');
      if (!['supported', 'ambiguous', 'contradictory', 'unresolved'].includes(stringValue(record.status, 'status'))) {
        invalid('Invalid relationship status', 'status');
      }
      break;
  }
}

export function validateModelSet(values: readonly unknown[]): asserts values is FundGraphModel[] {
  if (!Array.isArray(values)) invalid('Expected an array of models');
  values.forEach((value, index) => {
    try {
      validateModel(value);
    } catch (error) {
      if (error instanceof FundGraphError && error.path) {
        throw new FundGraphError(error.code, error.message, `[${index}].${error.path}`);
      }
      throw error;
    }
  });
}

export function hasContradictoryRelationship(value: Relationship): boolean {
  validateModel(value);
  return value.status === 'contradictory';
}

