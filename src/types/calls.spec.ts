import {
  PluginPayloadTooLargeError,
  PluginValidationError,
} from '../errors/sdk-errors';
import { copyCallPayload, MAX_CALL_PAYLOAD_BYTES } from './calls';

describe('copyCallPayload', () => {
  it('should copy plain JSON and turn undefined into null', () => {
    const value = { a: [1, 'x', true, null, { b: 2 }] };
    const copy = copyCallPayload(value, 'Input');

    expect(copy).toEqual(value);
    expect(copy).not.toBe(value);
    expect(copyCallPayload(undefined, 'Input')).toBeNull();
    expect(copyCallPayload(Object.create(null), 'Input')).toEqual({});
  });

  it.each([
    [new Date()],
    [{ when: new Date() }],
    [{ fn: () => 1 }],
    [{ missing: undefined }],
    [new Map()],
    [Number.NaN],
    [new (class Thing {})()],
  ])('should reject what is not plain JSON: %p', (value) => {
    expect(() => copyCallPayload(value, 'Input')).toThrow(
      PluginValidationError,
    );
  });

  it('should reject payloads above the size limit', () => {
    expect(() =>
      copyCallPayload('x'.repeat(MAX_CALL_PAYLOAD_BYTES), 'Result'),
    ).toThrow(PluginPayloadTooLargeError);
  });
});
