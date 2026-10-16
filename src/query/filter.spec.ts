import { runInNewContext } from 'vm';
import { PluginValidationError } from '../errors/sdk-errors';
import {
  assertSafeDocument,
  assertSafeFilter,
  MAX_QUERY_LIMIT,
  normalizeQuery,
} from './filter';

describe('assertSafeFilter', () => {
  it.each([
    [{}],
    [{ title: 'a', archived: false, score: 3, deletedAt: null }],
    [
      {
        createdAt: { $gte: new Date('2026-01-01') },
        tags: { $in: ['a', 'b'] },
      },
    ],
    [{ 'meta.color': { $exists: true } }],
    [
      {
        $or: [
          { title: 'a' },
          { $and: [{ score: { $gt: 1 } }, { score: { $lt: 5 } }] },
        ],
      },
    ],
  ])('should accept %j', (filter) => {
    expect(() => assertSafeFilter(filter)).not.toThrow();
  });

  it.each([
    ['code execution', { $where: 'sleep(1000)' }],
    ['$expr', { $expr: { $gt: ['$a', '$b'] } }],
    ['$regex', { title: { $regex: '.*' } }],
    ['an operator-looking field', { $title: 'a' }],
    ['a sub-document value', { meta: { color: 'red' } }],
    ['an empty $or', { $or: [] }],
    ['a non-array $in', { tags: { $in: 'a' } }],
    ['a non-boolean $exists', { tags: { $exists: 1 } }],
    ['an object operand', { score: { $gt: { $gt: 1 } } }],
    [
      'deep nesting',
      {
        $or: [{ $or: [{ $or: [{ $or: [{ $or: [{ $or: [{ a: 1 }] }] }] }] }] }],
      },
    ],
    ['an array', [{ a: 1 }]],
  ])('should reject %s', (_name, filter) => {
    expect(() => assertSafeFilter(filter)).toThrow(PluginValidationError);
  });
});

describe('normalizeQuery', () => {
  it('should fill in the defaults', () => {
    expect(normalizeQuery()).toEqual({
      filter: {},
      sort: {},
      limit: 25,
      skip: 0,
    });
  });

  it('should reject a limit above the maximum and a bad sort', () => {
    expect(() => normalizeQuery({ limit: MAX_QUERY_LIMIT + 1 })).toThrow(
      PluginValidationError,
    );
    expect(() => normalizeQuery({ skip: -1 })).toThrow(PluginValidationError);
    expect(() => normalizeQuery({ sort: { title: 2 as 1 } })).toThrow(
      PluginValidationError,
    );
    expect(() => normalizeQuery({ sort: { $natural: 1 } })).toThrow(
      PluginValidationError,
    );
  });
});

describe('assertSafeDocument', () => {
  it('should accept plain data', () => {
    expect(() =>
      assertSafeDocument({
        title: 'a',
        tags: ['x'],
        meta: { at: new Date(), n: null },
        items: [{ a: 1 }],
      }),
    ).not.toThrow();
  });

  it('should accept dates and objects from another realm', () => {
    const foreign = runInNewContext(
      '({ at: new Date(0), meta: { tags: ["x"] }, items: [{ a: 1 }] })',
    ) as unknown;
    expect(() => assertSafeDocument(foreign)).not.toThrow();
    expect(() =>
      assertSafeFilter({ at: { $gte: runInNewContext('new Date(0)') } }),
    ).not.toThrow();
  });

  it.each([
    ['an operator key', { $set: { admin: true } }],
    ['a nested operator key', { meta: { $where: '1' } }],
    ['a dotted key', { 'a.b': 1 }],
    ['a function', { fn: () => 1 }],
    ['a class instance', { map: new Map() }],
  ])('should reject %s', (_name, document) => {
    expect(() => assertSafeDocument(document)).toThrow(PluginValidationError);
  });
});
