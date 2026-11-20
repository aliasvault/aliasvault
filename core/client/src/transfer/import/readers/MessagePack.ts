/*
 * A MessagePack reader: every type except extensions, with string map keys only.
 */

/** Nesting deeper than any export goes, so hostile input cannot exhaust the stack. */
const MAX_DEPTH = 32;

/**
 * Raised when bytes are not MessagePack this reader accepts.
 */
export class MessagePackException extends Error {
  /**
   * Create the exception.
   */
  public constructor() {
    super('The data is not valid MessagePack');
    this.name = 'MessagePackException';
    Object.setPrototypeOf(this, MessagePackException.prototype);
  }
}

/**
 * Read one MessagePack value that spans the whole input. Maps become objects without a prototype, binary data a
 * Uint8Array and 64-bit integers numbers.
 * @param bytes - The MessagePack bytes
 * @returns The value
 * @throws {MessagePackException} When the bytes are truncated, nested too deep or hold an unsupported type.
 */
export function readMessagePack(bytes: Uint8Array): unknown {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let position = 0;

  /**
   * Move past a number of bytes.
   * @param length - The number of bytes
   * @returns The position they start at
   */
  const take = (length: number): number => {
    if (position + length > bytes.length) {
      throw new MessagePackException();
    }
    position += length;
    return position - length;
  };

  /**
   * Read a big-endian unsigned integer.
   * @param size - 1, 2, 4 or 8 bytes
   * @returns The integer
   */
  const uint = (size: number): number => {
    const start = take(size);
    switch (size) {
      case 1: return view.getUint8(start);
      case 2: return view.getUint16(start);
      case 4: return view.getUint32(start);
      default: return Number(view.getBigUint64(start));
    }
  };

  /**
   * Read a string.
   * @param length - Its length in bytes
   * @returns The string
   */
  const text = (length: number): string => {
    const start = take(length);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start, start + length));
    } catch {
      throw new MessagePackException();
    }
  };

  /**
   * Read the values of an array one by one, so a length the input cannot back fails before it allocates.
   * @param length - The number of values
   * @param depth - The nesting depth of the array
   * @returns The values
   */
  const array = (length: number, depth: number): unknown[] => {
    const values: unknown[] = [];
    for (let i = 0; i < length; i++) {
      values.push(value(depth + 1));
    }
    return values;
  };

  /**
   * Read a map.
   * @param length - The number of entries
   * @param depth - The nesting depth of the map
   * @returns The map as an object
   */
  const map = (length: number, depth: number): Record<string, unknown> => {
    const members = Object.create(null) as Record<string, unknown>;
    for (let i = 0; i < length; i++) {
      const key = value(depth + 1);
      if (typeof key !== 'string') {
        throw new MessagePackException();
      }
      members[key] = value(depth + 1);
    }
    return members;
  };

  /**
   * Read one value.
   * @param depth - Its nesting depth
   * @returns The value
   */
  const value = (depth: number): unknown => {
    if (depth > MAX_DEPTH) {
      throw new MessagePackException();
    }
    const marker = view.getUint8(take(1));
    if (marker <= 0x7f) {
      return marker;
    }
    if (marker <= 0x8f) {
      return map(marker & 0x0f, depth);
    }
    if (marker <= 0x9f) {
      return array(marker & 0x0f, depth);
    }
    if (marker <= 0xbf) {
      return text(marker & 0x1f);
    }
    if (marker >= 0xe0) {
      return marker - 0x100;
    }
    switch (marker) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xc4: case 0xc5: case 0xc6: {
        const length = uint(1 << (marker - 0xc4));
        const start = take(length);
        return bytes.slice(start, start + length);
      }
      case 0xca: return view.getFloat32(take(4));
      case 0xcb: return view.getFloat64(take(8));
      case 0xcc: case 0xcd: case 0xce: case 0xcf: return uint(1 << (marker - 0xcc));
      case 0xd0: return view.getInt8(take(1));
      case 0xd1: return view.getInt16(take(2));
      case 0xd2: return view.getInt32(take(4));
      case 0xd3: return Number(view.getBigInt64(take(8)));
      case 0xd9: case 0xda: case 0xdb: return text(uint(1 << (marker - 0xd9)));
      case 0xdc: case 0xdd: return array(uint(2 << (marker - 0xdc)), depth);
      case 0xde: case 0xdf: return map(uint(2 << (marker - 0xde)), depth);
      default: throw new MessagePackException();
    }
  };

  const result = value(0);
  if (position !== bytes.length) {
    throw new MessagePackException();
  }
  return result;
}
