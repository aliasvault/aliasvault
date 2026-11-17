import { describe, expect, it } from 'vitest';

import { MessagePackException, readMessagePack } from '../MessagePack';

/**
 * Read MessagePack given as byte values.
 * @param bytes - The bytes
 * @returns The value
 */
const read = (...bytes: number[]): unknown => readMessagePack(Uint8Array.from(bytes));

describe('MessagePack', () => {
  it('reads scalars of every width', () => {
    expect(read(0x7f)).toBe(127);
    expect(read(0xff)).toBe(-1);
    expect(read(0xe0)).toBe(-32);
    expect(read(0xcc, 0xff)).toBe(255);
    expect(read(0xcd, 0x01, 0x00)).toBe(256);
    expect(read(0xce, 0x00, 0x01, 0x00, 0x00)).toBe(65536);
    expect(read(0xcf, 0, 0, 0, 1, 0, 0, 0, 0)).toBe(4294967296);
    expect(read(0xd0, 0x80)).toBe(-128);
    expect(read(0xd1, 0xff, 0x00)).toBe(-256);
    expect(read(0xd2, 0xff, 0xff, 0xff, 0xfe)).toBe(-2);
    expect(read(0xd3, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfd)).toBe(-3);
    expect(read(0xcb, 0x3f, 0xf8, 0, 0, 0, 0, 0, 0)).toBe(1.5);
    expect(read(0xca, 0x3f, 0xc0, 0, 0)).toBe(1.5);
    expect([read(0xc0), read(0xc2), read(0xc3)]).toEqual([null, false, true]);
  });

  it('reads strings, binary data, arrays and maps', () => {
    expect(read(0xa2, 0x68, 0x69)).toBe('hi');
    expect(read(0xd9, 0x02, 0x68, 0x69)).toBe('hi');
    expect(read(0xc4, 0x02, 0x01, 0x02)).toEqual(Uint8Array.from([1, 2]));
    expect(read(0x92, 0x01, 0xa1, 0x61)).toEqual([1, 'a']);
    expect(read(0xdc, 0x00, 0x01, 0x05)).toEqual([5]);
    expect(read(0x82, 0xa1, 0x61, 0x01, 0xa1, 0x62, 0x91, 0xc0)).toEqual({ a: 1, b: [null] });
    expect(read(0xde, 0x00, 0x01, 0xa1, 0x61, 0x01)).toEqual({ a: 1 });
  });

  it('keeps a map key named like a prototype member as data', () => {
    const value = read(0x81, 0xa9, ...new TextEncoder().encode('__proto__'), 0x01) as Record<string, unknown>;
    expect(Object.keys(value)).toEqual(['__proto__']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('refuses input it cannot read', () => {
    const unreadable = [
      [],
      [0xa2, 0x68],
      [0x92, 0x01],
      [0xdd, 0xff, 0xff, 0xff, 0xff],
      [0x01, 0x02],
      [0x81, 0x01, 0x01],
      [0xc1],
      [0xd4, 0x01, 0x00],
      [0xa1, 0xff],
      new Array<number>(40).fill(0x91),
    ];
    for (const bytes of unreadable) {
      expect(() => read(...bytes)).toThrow(MessagePackException);
    }
  });
});
