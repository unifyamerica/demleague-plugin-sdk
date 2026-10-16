import { FilterScalar, isDate, PluginFilter } from '../query/filter';

const comparable = (value: unknown): unknown =>
  isDate(value) ? value.getTime() : value;

const getPath = (record: Record<string, unknown>, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object'
          ? (value as Record<string, unknown>)[key]
          : undefined,
      record,
    );

function matchesCondition(value: unknown, condition: unknown): boolean {
  if (
    condition === null ||
    typeof condition !== 'object' ||
    isDate(condition)
  ) {
    return Array.isArray(value)
      ? value.some((item) => comparable(item) === comparable(condition))
      : comparable(value) === comparable(condition);
  }

  return Object.entries(condition as Record<string, unknown>).every(
    ([operator, operand]) => {
      const left = comparable(value) as number;
      const right = comparable(operand) as number;
      switch (operator) {
        case '$eq':
          return matchesCondition(value, operand);
        case '$ne':
          return !matchesCondition(value, operand);
        case '$in':
          return (operand as FilterScalar[]).some((item) =>
            matchesCondition(value, item),
          );
        case '$nin':
          return !(operand as FilterScalar[]).some((item) =>
            matchesCondition(value, item),
          );
        case '$gt':
          return left > right;
        case '$gte':
          return left >= right;
        case '$lt':
          return left < right;
        case '$lte':
          return left <= right;
        case '$exists':
          return (value !== undefined) === operand;
        default:
          return false;
      }
    },
  );
}

/** An in-memory evaluation of the SDK filter language, for the test harness. */
export function matchesFilter(
  record: Record<string, unknown>,
  filter: PluginFilter = {},
): boolean {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$and') {
      return (condition as PluginFilter[]).every((nested) =>
        matchesFilter(record, nested),
      );
    }
    if (key === '$or') {
      return (condition as PluginFilter[]).some((nested) =>
        matchesFilter(record, nested),
      );
    }
    return matchesCondition(getPath(record, key), condition);
  });
}
