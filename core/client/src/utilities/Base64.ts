/**
 * Base64 conversion helpers for raw byte buffers to efficiently encode and decode large buffers.
 */

/**
 * Chunk size for encoding and decoding.
 */
const CHUNK_SIZE = 0x8000;

/**
 * The built-in base64 methods on Uint8Array (Chrome/Edge 140+, Firefox 133+, Safari 18.2+), typed here since not every
 * host's TS lib has them yet. They run in native code, about 50x faster on a large vault than the latin-1 fallback.
 */
type NativeBase64Bytes = Uint8Array & { toBase64?: () => string };
const NativeUint8Array = Uint8Array as typeof Uint8Array & { fromBase64?: (base64: string) => Uint8Array<ArrayBuffer> };
const hasNativeEncode = typeof (Uint8Array.prototype as NativeBase64Bytes).toBase64 === 'function';
const hasNativeDecode = typeof NativeUint8Array.fromBase64 === 'function';

/**
 * Encode raw bytes as base64, natively where the runtime supports it and via latin-1 character codes otherwise.
 * @param bytes - the bytes to encode
 * @returns The base64 representation of the bytes
 */
export function bytesToBase64(bytes: Uint8Array): string {
  if (hasNativeEncode) {
    return (bytes as NativeBase64Bytes).toBase64!();
  }
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE)));
  }
  return btoa(parts.join(''));
}

/**
 * Decode a base64 string back into raw bytes. Counterpart of {@link bytesToBase64}.
 * @param base64 - the base64-encoded bytes
 * @returns The decoded bytes
 */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  if (hasNativeDecode) {
    return NativeUint8Array.fromBase64!(base64);
  }
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encode raw bytes as unpadded base64url (RFC 4648 section 5).
 * @param bytes - the bytes to encode
 * @returns The base64url representation of the bytes, without `=` padding
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode base64url back into raw bytes. Also accepts standard base64, padded or not.
 * @param base64url - the base64url- or base64-encoded bytes
 * @returns The decoded bytes
 */
export function base64UrlToBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
}
