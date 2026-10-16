import {
  ExportedOperation,
  getExportedOperations,
} from './exported-operation.decorator';

describe('@ExportedOperation', () => {
  it('should find decorated methods, inherited ones included', () => {
    class Base {
      @ExportedOperation('items.count')
      count() {
        return 0;
      }
    }
    class Exports extends Base {
      @ExportedOperation('items.list')
      list() {
        return [];
      }

      helper() {
        return null;
      }
    }

    expect(getExportedOperations(Exports)).toEqual([
      { operation: 'items.list', methodName: 'list' },
      { operation: 'items.count', methodName: 'count' },
    ]);
  });

  it('should reject malformed operation names', () => {
    expect(() => ExportedOperation('Items.List')).toThrow('operation names');
  });
});
