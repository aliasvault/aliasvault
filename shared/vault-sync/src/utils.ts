/**
 * Convert a base64-encoded string to Uint8Array.
 * Used to convert EncryptionUtility.symmetricEncrypt() output for IPFS upload.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert Uint8Array to base64-encoded string.
 * Reverse of base64ToUint8Array — used in Story 2.4 (load flow).
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binaryString = '';
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
}

/**
 * Compute SHA-256 hash of a string using Web Crypto API.
 * Returns raw bytes — use bytesToHex() for hex encoding.
 */
export async function sha256(data: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const buffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return new Uint8Array(buffer);
}

/**
 * Convert Uint8Array to hex-encoded string.
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to Uint8Array.
 */
export function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}
