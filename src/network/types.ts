import type { FundGraphErrorCode } from '../domain/errors.js';

export type NetworkSource = 'network' | 'cache';

export interface NetworkDiagnostic {
  code: FundGraphErrorCode | 'CACHE_MISS' | 'CACHE_REVALIDATED';
  message: string;
  url?: string;
  attempt?: number;
}

export interface CacheOptions {
  directory: string;
  ttlMs: number;
}

export interface NetworkRequest {
  url: string;
  init?: RequestInit;
  retries?: number;
  timeoutMs?: number;
  cache?: CacheOptions;
  offline?: boolean;
  signal?: AbortSignal;
}

export interface NetworkResult<T> {
  value: T;
  source: NetworkSource;
  attempts: number;
  diagnostics: NetworkDiagnostic[];
  fetchedAt: string;
}

export interface NetworkFailure {
  url: string;
  error: FundGraphErrorCode;
  message: string;
}

export interface BatchResult<T> {
  results: Array<NetworkResult<T>>;
  failures: NetworkFailure[];
  diagnostics: NetworkDiagnostic[];
}

export interface NetworkClientOptions {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  maxRetries?: number;
  maxTimeoutMs?: number;
  maxBackoffMs?: number;
}
