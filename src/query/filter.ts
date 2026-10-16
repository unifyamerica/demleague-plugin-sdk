import { PluginValidationError } from '../errors/sdk-errors';

// The deliberately small query language plugins get for their own collections. Anything that can run code
// or scan unbounded (`$where`, `$function`, `$expr`, `$regex`, ...) is rejected before it reaches MongoDB.
export const FILTER_COMPARISON_OPERATORS = [
  '$eq',
  '$ne',
  '$in',
  '$nin',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$exists',
] as const;
export const FILTER_LOGICAL_OPERATORS = ['$and', '$or'] as const;

export type FilterScalar = string | number | boolean | null | Date;

export type FieldCondition =
  | FilterScalar
  | {
      $eq?: FilterScalar;
      $ne?: FilterScalar;
      $in?: FilterScalar[];
      $nin?: FilterScalar[];
      $gt?: FilterScalar;
      $gte?: FilterScalar;
      $lt?: FilterScalar;
      $lte?: FilterScalar;
      $exists?: boolean;
    };

export type PluginFilter = {
  [field: string]: FieldCondition | PluginFilter[] | undefined;
  $and?: PluginFilter[];
  $or?: PluginFilter[];
};

export interface PluginQuery {
  filter?: PluginFilter;
  sort?: Record<string, 1 | -1>;
  limit?: number;
  skip?: number;
}

export const DEFAULT_QUERY_LIMIT = 25;
export const MAX_QUERY_LIMIT = 100;
const MAX_FILTER_DEPTH = 4;
const MAX_IN_VALUES = 100;
const FIELD_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

// ℹ️ Realm-independent on purpose: values made by `structuredClone` (the test harness copies documents with
// it) or in another VM context (Jest runs each test file in one) have that realm's `Date` and `Object.prototype`,
// so `instanceof Date` and `=== Object.prototype` would reject them.
export const isDate = (value: unknown): value is Date =>
  Object.prototype.toString.call(value) === '[object Date]';

const isScalar = (value: unknown): value is FilterScalar =>
  value === null ||
  isDate(value) ||
  ['string', 'number', 'boolean'].includes(typeof value);

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.prototype.toString.call(value) !== '[object Object]'
  ) {
    return false;
  }
  // `Object.prototype` of any realm (its own prototype is null), or no prototype at all
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
};

function assertField(field: string): void {
  if (!FIELD_PATTERN.test(field)) {
    throw new PluginValidationError(`Invalid filter field "${field}"`);
  }
}

function assertCondition(field: string, condition: unknown): void {
  if (isScalar(condition)) {
    return;
  }

  if (!isPlainObject(condition)) {
    throw new PluginValidationError(
      `Filter on "${field}" must be a value or an operator object`,
    );
  }

  for (const [operator, operand] of Object.entries(condition)) {
    if (
      !(FILTER_COMPARISON_OPERATORS as readonly string[]).includes(operator)
    ) {
      throw new PluginValidationError(
        `Operator "${operator}" is not allowed (field "${field}")`,
      );
    }

    if (operator === '$in' || operator === '$nin') {
      if (
        !Array.isArray(operand) ||
        operand.length > MAX_IN_VALUES ||
        !operand.every(isScalar)
      ) {
        throw new PluginValidationError(
          `${operator} on "${field}" must be an array of at most ${MAX_IN_VALUES} values`,
        );
      }
    } else if (operator === '$exists') {
      if (typeof operand !== 'boolean') {
        throw new PluginValidationError(
          `$exists on "${field}" must be a boolean`,
        );
      }
    } else if (!isScalar(operand)) {
      throw new PluginValidationError(
        `${operator} on "${field}" must be a scalar value`,
      );
    }
  }
}

/** Throws a `PluginValidationError` unless `filter` only uses the allowed fields and operators. */
export function assertSafeFilter(filter: unknown, depth = 0): void {
  if (filter === undefined) {
    return;
  }

  if (!isPlainObject(filter)) {
    throw new PluginValidationError('Filter must be an object');
  }

  if (depth > MAX_FILTER_DEPTH) {
    throw new PluginValidationError('Filter is nested too deeply');
  }

  for (const [key, value] of Object.entries(filter)) {
    if ((FILTER_LOGICAL_OPERATORS as readonly string[]).includes(key)) {
      if (!Array.isArray(value) || value.length === 0) {
        throw new PluginValidationError(`${key} must be a non-empty array`);
      }
      value.forEach((nested) => assertSafeFilter(nested, depth + 1));
      continue;
    }

    assertField(key);
    assertCondition(key, value);
  }
}

/** Validates the sort/limit/skip of a query and fills in the defaults. */
export function normalizeQuery(query: PluginQuery = {}): Required<PluginQuery> {
  assertSafeFilter(query.filter);

  const sort = query.sort ?? {};
  for (const [field, direction] of Object.entries(sort)) {
    assertField(field);
    if (direction !== 1 && direction !== -1) {
      throw new PluginValidationError(`Sort on "${field}" must be 1 or -1`);
    }
  }

  const limit = query.limit ?? DEFAULT_QUERY_LIMIT;
  const skip = query.skip ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_QUERY_LIMIT) {
    throw new PluginValidationError(
      `limit must be an integer between 1 and ${MAX_QUERY_LIMIT}`,
    );
  }
  if (!Number.isInteger(skip) || skip < 0) {
    throw new PluginValidationError('skip must be a non-negative integer');
  }

  return { filter: query.filter ?? {}, sort, limit, skip };
}

const MAX_DOCUMENT_DEPTH = 10;

/**
 * Throws a `PluginValidationError` unless `document` can be stored as-is: plain data only, no keys that
 * MongoDB would read as operators (`$…`) or paths (`a.b`), not nested too deeply.
 */
export function assertSafeDocument(document: unknown, depth = 0): void {
  if (depth > MAX_DOCUMENT_DEPTH) {
    throw new PluginValidationError('Document is nested too deeply');
  }

  if (Array.isArray(document)) {
    document.forEach((item) => assertSafeDocument(item, depth + 1));
    return;
  }

  if (document === null || typeof document !== 'object' || isDate(document)) {
    if (
      typeof document === 'function' ||
      typeof document === 'symbol' ||
      typeof document === 'bigint'
    ) {
      throw new PluginValidationError(
        `Documents can't contain a ${typeof document}`,
      );
    }
    return;
  }

  if (!isPlainObject(document)) {
    throw new PluginValidationError(
      'Documents may only contain plain objects, arrays and scalars',
    );
  }

  for (const [key, value] of Object.entries(document)) {
    if (key.startsWith('$') || key.includes('.') || key.includes('\0')) {
      throw new PluginValidationError(`Invalid document key "${key}"`);
    }
    assertSafeDocument(value, depth + 1);
  }
}
