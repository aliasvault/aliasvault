import { bytesToBase64 } from '../../../../../utilities/Base64';

/*
 * Builds the `content` of a Proton Pass passkey the way Proton's serializer writes it: MessagePack with named map
 * keys and bytes as arrays of integers.
 */

/**
 * Encode a value as MessagePack.
 * @param value - Null, a boolean, an integer from -32 to 255, a short string, an array or an object
 * @returns The bytes
 */
export function toMessagePack(value: unknown): number[] {
  /**
   * The header of an array or map.
   * @param fix - The marker of the short form
   * @param wide - The marker of the 16-bit form
   * @param length - The number of entries
   * @returns The bytes
   */
  const header = (fix: number, wide: number, length: number): number[] => length <= 15 ? [fix | length] : [wide, length >> 8, length & 0xff];

  if (value === null) {
    return [0xc0];
  }
  if (typeof value === 'boolean') {
    return [value ? 0xc3 : 0xc2];
  }
  if (typeof value === 'number') {
    return value >= 0 && value <= 127 ? [value] : value > 127 ? [0xcc, value] : [value + 0x100];
  }
  if (typeof value === 'string') {
    return [0xa0 | value.length, ...new TextEncoder().encode(value)];
  }
  if (Array.isArray(value)) {
    return [...header(0x90, 0xdc, value.length), ...value.flatMap(toMessagePack)];
  }
  const members = Object.entries(value as object);
  return [...header(0x80, 0xde, members.length), ...members.flatMap(([name, member]) => [...toMessagePack(name), ...toMessagePack(member)])];
}

/**
 * The stored form of a passkey for example.com.
 * @param scalar - The private scalar
 * @param curve - The COSE curve, 1 (P-256) by default
 * @returns The stored passkey
 */
export function protonStoredPasskey(scalar: Uint8Array, curve: number = 1): object {
  /**
   * A COSE key parameter.
   * @param label - The COSE label
   * @param value - The tagged value
   * @returns The `[label, value]` pair
   */
  const parameter = (label: number, value: object): object[] => [{ t: 'int', c: label }, value];
  return {
    key: {
      kty: { t: 'assign', c: 'EC2' },
      kid: [],
      alg: { t: 'assign', c: 'ES256' },
      kops: [],
      biv: [],
      par: [parameter(-1, { t: 'int', c: { inner: [curve, ...new Array<number>(15).fill(0)] } }), parameter(-2, { t: 'bytes', c: [1, 2] }), parameter(-4, { t: 'bytes', c: Array.from(scalar) })],
    },
    cid: Array.from({ length: 20 }, (_, index) => index + 1),
    rid: 'example.com',
    uhd: [200, 201, 202],
    cnt: null,
    ext: { hmac_secret: { cred_with_uv: new Array<number>(32).fill(7), cred_without_uv: null } },
    udn: 'Jane Doe',
    un: 'jane',
  };
}

/**
 * The base64 `content` of a passkey in an export: the stored passkey in its version envelope.
 * @param stored - The stored passkey
 * @param version - The envelope version, 1 by default
 * @returns The content
 */
export function protonPasskeyContent(stored: object, version: number = 1): string {
  return bytesToBase64(Uint8Array.from(toMessagePack({ c: toMessagePack(stored), v: version })));
}
