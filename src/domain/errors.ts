export type FundGraphErrorCode =
  | 'INVALID_MODEL'
  | 'UNSUPPORTED_SCHEMA'
  | 'UNSAFE_URL'
  | 'FIELD_TOO_LARGE'
  | 'INVALID_SERIALIZATION'
  | 'NETWORK_FAILURE'
  | 'NETWORK_TIMEOUT'
  | 'RATE_LIMITED'
  | 'CANCELLED'
  | 'CACHE_CORRUPT'
  | 'CACHE_STALE'
  | 'CACHE_UNSAFE';

export class FundGraphError extends Error {
  readonly code: FundGraphErrorCode;
  readonly path: string | undefined;

  constructor(code: FundGraphErrorCode, message: string, path?: string) {
    super(message);
    this.name = 'FundGraphError';
    this.code = code;
    this.path = path;
  }
}

