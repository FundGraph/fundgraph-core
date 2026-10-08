export * from './domain/errors.js';
export * from './domain/models.js';
export * from './domain/validation.js';
export * from './serialization/stable.js';
export * from './inputs/types.js';
export * from './inputs/discovery.js';
export * from './metadata/index.js';
export * from './funding/index.js';
export * from './resolution/index.js';

import { validateModel } from './domain/validation.js';
import { stableStringify } from './serialization/stable.js';
import type { FundGraphModel } from './domain/models.js';

export function serializeModel(model: FundGraphModel): string {
  validateModel(model);
  return stableStringify(model);
}

