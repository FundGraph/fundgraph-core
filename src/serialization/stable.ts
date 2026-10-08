import { FundGraphError } from '../domain/errors.js';

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        const item = record[key];
        if (item !== undefined) result[key] = sortValue(item);
        return result;
      }, {});
  }
  return value;
}

export function stableStringify(value: unknown): string {
  try {
    const result = JSON.stringify(sortValue(value));
    if (result === undefined) throw new Error('Value is not JSON serializable');
    return result;
  } catch (error) {
    throw new FundGraphError('INVALID_SERIALIZATION', error instanceof Error ? error.message : 'Unable to serialize value');
  }
}

