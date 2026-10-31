/*
 * Polyfill for crypto.randomUUID, which the shared TypeScript core (core/client) calls but
 * React Native does not provide.
 */
import 'react-native-get-random-values';

/**
 * The crypto global as it exists on mobile, before randomUUID is added.
 */
type MobileCrypto = {
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;
  randomUUID?: () => string;
};

const mobileCrypto = globalThis.crypto as unknown as MobileCrypto;

/**
 * A random (version 4) UUID.
 */
function randomUUID(): string {
  const bytes = mobileCrypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

mobileCrypto.randomUUID ??= randomUUID;
