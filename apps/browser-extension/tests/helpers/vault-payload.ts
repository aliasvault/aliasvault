/**
 * The manifest-v1 payload envelope for tests that read or write vault payloads API-side, as the Rust core
 * packs it (`core/rust/src/vault_codec/mod.rs`): gzip of `{ schemaVersion, contentHash, payload }`.
 */

import { createHash } from 'crypto';
import { gunzipSync, gzipSync } from 'zlib';

/** The payload format version the Rust core writes (`SCHEMA_VERSION`). */
const SCHEMA_VERSION = 1;

/**
 * Wraps a payload in its envelope and gzips it.
 *
 * @param payload - The manifest or data bucket object
 * @returns The packed bytes, ready to encrypt
 */
export function packPayload(payload: unknown): Uint8Array {
  const contentHash = createHash('sha256').update(canonicalJson(payload)).digest('hex');
  return gzipSync(JSON.stringify({ schemaVersion: SCHEMA_VERSION, contentHash, payload }));
}

/**
 * Gunzips packed bytes and returns the payload of their envelope.
 *
 * @param packed - The decrypted packed bytes
 * @returns The payload object
 */
export function unpackPayload<T>(packed: Uint8Array): T {
  return (JSON.parse(gunzipSync(packed).toString('utf8')) as { payload: T }).payload;
}

/**
 * The canonical JSON the content hash is taken over: object keys sorted recursively, arrays kept in order.
 *
 * @param value - The value to render
 * @returns The canonical JSON text
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
