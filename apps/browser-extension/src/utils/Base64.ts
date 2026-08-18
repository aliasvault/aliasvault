/**
 * Base64 conversion helpers for raw byte buffers to efficiently encode and decode large buffers.
 */

/**
 * Chunk size for encoding and decoding.
 */
const CHUNK_SIZE = 0x8000;

/**
 * Encode raw bytes as base64 via latin-1 character codes.
 * @param bytes - the bytes to encode
 * @returns The base64 representation of the bytes
 */
export function bytesToBase64(bytes: Uint8Array): string {
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
export function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
