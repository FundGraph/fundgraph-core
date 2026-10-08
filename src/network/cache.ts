import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FundGraphError } from '../domain/errors.js';
import type { CacheOptions } from './types.js';

interface CacheRecord {
  schemaVersion: '1.0';
  url: string;
  fetchedAt: string;
  body: unknown;
}

const DEFAULT_MAX_CACHE_BYTES = 4 * 1024 * 1024;

function cachePath(options: CacheOptions, url: string): string {
  const key = createHash('sha256').update(url, 'utf8').digest('hex');
  return join(options.directory, `${key}.json`);
}

export function isCacheSafe(init: RequestInit | undefined): boolean {
  if (!init?.headers) return true;
  const headers = new Headers(init.headers);
  return !headers.has('authorization') && !headers.has('cookie') && !headers.has('proxy-authorization');
}

export async function readCache<T>(options: CacheOptions, url: string, now: number): Promise<{ value: T; fetchedAt: string; stale: boolean }> {
  let raw: string;
  try {
    const path = cachePath(options, url);
    const metadata = await stat(path);
    if (metadata.size > (options.maxBytes ?? DEFAULT_MAX_CACHE_BYTES)) throw new FundGraphError('FIELD_TOO_LARGE', 'Cached response exceeds the cache size limit');
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof FundGraphError) throw error;
    const code = error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'ENOENT' ? 'CACHE_MISS' : 'CACHE_CORRUPT';
    throw new FundGraphError(code === 'CACHE_MISS' ? 'CACHE_STALE' : 'CACHE_CORRUPT', code === 'CACHE_MISS' ? 'No cached response exists' : 'Cached response cannot be read');
  }
  let record: CacheRecord;
  try {
    record = JSON.parse(raw) as CacheRecord;
    if (record.schemaVersion !== '1.0' || record.url !== url || typeof record.fetchedAt !== 'string' || !('body' in record)) throw new Error('invalid cache record');
    if (Number.isNaN(Date.parse(record.fetchedAt))) throw new Error('invalid cache timestamp');
  } catch {
    throw new FundGraphError('CACHE_CORRUPT', 'Cached response has an invalid format');
  }
  const age = now - Date.parse(record.fetchedAt);
  return { value: record.body as T, fetchedAt: record.fetchedAt, stale: age < 0 || age > options.ttlMs };
}

export async function writeCache(options: CacheOptions, url: string, body: unknown, fetchedAt: string, init?: RequestInit): Promise<void> {
  if (!isCacheSafe(init)) throw new FundGraphError('CACHE_UNSAFE', 'Authenticated requests cannot be cached');
  await mkdir(options.directory, { recursive: true });
  const destination = cachePath(options, url);
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
  const record: CacheRecord = { schemaVersion: '1.0', url, fetchedAt, body };
  const serialized = JSON.stringify(record);
  if (Buffer.byteLength(serialized, 'utf8') > (options.maxBytes ?? DEFAULT_MAX_CACHE_BYTES)) throw new FundGraphError('FIELD_TOO_LARGE', 'Response exceeds the cache size limit');
  await writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, destination);
}

export async function invalidateCache(options: CacheOptions, url: string): Promise<void> {
  try {
    await unlink(cachePath(options, url));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'ENOENT')) throw error;
  }
}
