import { FundGraphError } from '../domain/errors.js';
import { isIP } from 'node:net';
import { isCacheSafe, readCache, writeCache } from './cache.js';
import type { BatchResult, NetworkClientOptions, NetworkDiagnostic, NetworkRequest, NetworkResult } from './types.js';

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BACKOFF_MS = 5_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

function isPrivateAddress(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (isIP(host) === 4) {
    const octets = host.split('.').map(Number);
    const first = octets[0] ?? -1;
    const second = octets[1] ?? -1;
    return first === 0 || first === 10 || first === 127 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
  }
  if (isIP(host) === 6) return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80') || host.startsWith('::ffff:127.');
  return false;
}

export function validateNetworkUrl(value: string, options: Pick<NetworkRequest, 'allowHttp' | 'allowedHosts'> = {}): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FundGraphError('UNSAFE_URL', 'Network URL is invalid', 'url');
  }
  if ((url.protocol !== 'https:' && !(options.allowHttp && url.protocol === 'http:')) || url.username || url.password || isPrivateAddress(url.hostname)) {
    throw new FundGraphError('UNSAFE_URL', 'Network URL must use a public credential-free HTTP(S) destination', 'url');
  }
  if (options.allowedHosts && options.allowedHosts.length > 0) {
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const allowed = options.allowedHosts.some((candidate) => {
      const normalized = candidate.toLowerCase().replace(/^\.+|\.+$/g, '');
      return host === normalized || host.endsWith(`.${normalized}`);
    });
    if (!allowed) throw new FundGraphError('UNSAFE_URL', 'Network host is not in the explicit allowlist', 'url');
  }
  return url;
}

function abortError(signal?: AbortSignal): FundGraphError {
  return new FundGraphError(signal?.aborted ? 'CANCELLED' : 'NETWORK_TIMEOUT', signal?.aborted ? 'Network request was cancelled' : 'Network request timed out');
}

function retryAfter(response: Response, now: number): number | undefined {
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

export class NetworkClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly maxRetries: number;
  private readonly maxTimeoutMs: number;
  private readonly maxBackoffMs: number;
  private readonly maxResponseBytes: number;

  constructor(options: NetworkClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.maxRetries = Math.max(0, Math.min(5, Math.floor(options.maxRetries ?? DEFAULT_RETRIES)));
    this.maxTimeoutMs = Math.max(1, Math.min(120_000, Math.floor(options.maxTimeoutMs ?? DEFAULT_TIMEOUT_MS)));
    this.maxBackoffMs = Math.max(0, Math.min(60_000, Math.floor(options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS)));
    this.maxResponseBytes = Math.max(1, Math.min(MAX_RESPONSE_BYTES, Math.floor(options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES)));
  }

  async json<T>(request: NetworkRequest): Promise<NetworkResult<T>> {
    if (request.signal?.aborted) throw abortError(request.signal);
    validateNetworkUrl(request.url, request);
    const diagnostics: NetworkDiagnostic[] = [];
    const cache = request.cache;
    const cacheAllowed = isCacheSafe(request.init);
    if (cache && !cacheAllowed) {
      diagnostics.push({ code: 'CACHE_UNSAFE', message: 'Authenticated requests bypass the cache', url: request.url });
    } else if (cache) {
      try {
        const cached = await readCache<T>(cache, request.url, this.now());
        if (!cached.stale || request.offline) {
          if (cached.stale) diagnostics.push({ code: 'CACHE_STALE', message: 'Using stale cached response in offline mode', url: request.url });
          return { value: cached.value, source: 'cache', attempts: 0, diagnostics, fetchedAt: cached.fetchedAt };
        }
        diagnostics.push({ code: 'CACHE_STALE', message: 'Cached response is stale; attempting network refresh', url: request.url });
      } catch (error) {
        const code = error instanceof FundGraphError ? error.code : 'CACHE_CORRUPT';
        if (request.offline) throw error;
        diagnostics.push({ code, message: error instanceof Error ? error.message : 'Cached response is unavailable', url: request.url });
      }
    } else if (request.offline) {
      throw new FundGraphError('NETWORK_FAILURE', 'Offline mode requires an enabled cache', request.url);
    }
    if (request.offline) throw new FundGraphError('CACHE_STALE', 'No fresh cached response is available in offline mode', request.url);

    const retries = Math.max(0, Math.min(this.maxRetries, Math.floor(request.retries ?? this.maxRetries)));
    const timeoutMs = Math.max(1, Math.min(this.maxTimeoutMs, Math.floor(request.timeoutMs ?? this.maxTimeoutMs)));
    const maxResponseBytes = Math.max(1, Math.min(this.maxResponseBytes, Math.floor(request.maxResponseBytes ?? this.maxResponseBytes)));
    let lastError: FundGraphError | undefined;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = () => controller.abort();
      let retryableHttpFailure = false;
      let httpResponseReceived = false;
      request.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const response = await this.fetchImpl(request.url, { ...request.init, redirect: 'manual', signal: controller.signal });
        if (response.status >= 300 && response.status < 400) throw new FundGraphError('UNSAFE_URL', 'Network redirects are rejected by the secure default policy', 'url');
        if (!response.ok) {
          httpResponseReceived = true;
          const retryable = RETRYABLE_STATUS.has(response.status);
          retryableHttpFailure = retryable;
          const code = response.status === 429 ? 'RATE_LIMITED' : 'NETWORK_FAILURE';
          lastError = new FundGraphError(code, `Network request returned HTTP ${response.status}`, request.url);
          if (!retryable || attempt === retries) throw lastError;
          const serverDelay = retryAfter(response, this.now());
          const exponential = Math.min(this.maxBackoffMs, 250 * (2 ** attempt));
          const delay = Math.min(this.maxBackoffMs, serverDelay ?? exponential + Math.floor(this.random() * 100));
          diagnostics.push({ code, message: `Retrying after HTTP ${response.status}`, url: request.url, attempt: attempt + 1 });
          await this.sleep(delay);
          continue;
        }
        let value: T;
        try {
          const reader = response.body?.getReader();
          if (!reader) {
            const text = await response.text();
            if (Buffer.byteLength(text, 'utf8') > maxResponseBytes) throw new FundGraphError('FIELD_TOO_LARGE', 'Network response exceeds the response size limit');
            value = JSON.parse(text) as T;
          } else {
            const chunks: Uint8Array[] = [];
            let size = 0;
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              size += chunk.value.byteLength;
              if (size > maxResponseBytes) {
                await reader.cancel();
                throw new FundGraphError('FIELD_TOO_LARGE', 'Network response exceeds the response size limit');
              }
              chunks.push(chunk.value);
            }
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            value = JSON.parse(new TextDecoder().decode(bytes)) as T;
          }
        } catch (error) {
          if (error instanceof FundGraphError) throw error;
          throw new FundGraphError('NETWORK_FAILURE', 'Network response was not valid JSON', request.url);
        }
        const fetchedAt = new Date(this.now()).toISOString();
        if (cache && cacheAllowed) {
          try {
            await writeCache(cache, request.url, value, fetchedAt, request.init);
          } catch (error) {
            diagnostics.push({ code: error instanceof FundGraphError ? error.code : 'CACHE_CORRUPT', message: error instanceof Error ? error.message : 'Unable to write cache', url: request.url });
          }
        }
        return { value, source: 'network', attempts: attempt + 1, diagnostics, fetchedAt };
      } catch (error) {
        if (request.signal?.aborted) throw abortError(request.signal);
        if (isAbort(error)) {
          lastError = abortError();
          if (attempt === retries) throw lastError;
          diagnostics.push({ code: 'NETWORK_TIMEOUT', message: 'Retrying after request timeout', url: request.url, attempt: attempt + 1 });
        } else if (error instanceof FundGraphError) {
          lastError = error;
          if (error === lastError && httpResponseReceived && error.code === 'NETWORK_FAILURE' && !retryableHttpFailure) throw error;
          if (error.code === 'RATE_LIMITED' || error.code === 'NETWORK_FAILURE') {
            if (attempt === retries) throw error;
          } else throw error;
        } else {
          lastError = new FundGraphError('NETWORK_FAILURE', error instanceof Error ? error.message : 'Network request failed', request.url);
          if (attempt === retries) throw lastError;
        }
        const delay = Math.min(this.maxBackoffMs, 250 * (2 ** attempt) + Math.floor(this.random() * 100));
        await this.sleep(delay);
      } finally {
        clearTimeout(timeout);
        request.signal?.removeEventListener('abort', onAbort);
      }
    }
    throw lastError ?? new FundGraphError('NETWORK_FAILURE', 'Network request failed', request.url);
  }

  async jsonBatch<T>(requests: readonly NetworkRequest[]): Promise<BatchResult<T>> {
    const settled = await Promise.allSettled(requests.map((request) => this.json<T>(request)));
    const results: NetworkResult<T>[] = [];
    const failures = [] as BatchResult<T>['failures'];
    const diagnostics: NetworkDiagnostic[] = [];
    settled.forEach((item, index) => {
      const request = requests[index];
      if (item.status === 'fulfilled') {
        results.push(item.value);
        diagnostics.push(...item.value.diagnostics);
      } else {
        const error = item.reason instanceof FundGraphError ? item.reason : new FundGraphError('NETWORK_FAILURE', 'Network request failed');
        failures.push({ url: request?.url ?? '', error: error.code, message: error.message });
        diagnostics.push({ code: error.code, message: error.message, ...(request?.url ? { url: request.url } : {}) });
      }
    });
    return { results, failures, diagnostics };
  }
}

export async function fetchJson<T>(request: NetworkRequest, options?: NetworkClientOptions): Promise<NetworkResult<T>> {
  return new NetworkClient(options).json<T>(request);
}

export async function fetchJsonBatch<T>(requests: readonly NetworkRequest[], options?: NetworkClientOptions): Promise<BatchResult<T>> {
  return new NetworkClient(options).jsonBatch<T>(requests);
}
