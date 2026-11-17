import { base64UrlToBytes } from '../../../../utilities/Base64';
import { isBlank } from '../../../shared/StringUtils';
import { ImportException, ImportStage } from '../../models/ImportException';
import { isJsonObject, readStringOrNull, type JsonObject } from '../../readers/JsonReader';
import { readMessagePack } from '../../readers/MessagePack';
import { buildPasskey, type PasskeyKeyConverter } from '../../readers/PasskeyImport';

import type { ImportedPasskey } from '../../models/ImportedPasskey';

/** The only version of the stored passkey this reads. */
const FORMAT_VERSION = 1;

/** COSE key parameters of an EC2 key (RFC 9053): the curve, with 1 for P-256, and the private scalar. */
const COSE_CURVE = -1;
const COSE_PRIVATE_SCALAR = -4;
const COSE_CURVE_P256 = 1;

/**
 * Read one entry of `content.passkeys`. Its base64 `content` is MessagePack `{ c: <bytes>, v: 1 }`, where `c` is
 * the MessagePack of the stored passkey with its key as a COSE key.
 * @param passkey - The passkey JSON
 * @param keys - Converts the key
 * @returns The passkey
 * @throws {ImportException} When the content is missing, of another version or holds no P-256 key.
 */
export async function readProtonPassPasskey(passkey: JsonObject, keys: PasskeyKeyConverter): Promise<ImportedPasskey> {
  const content = readStringOrNull(passkey, 'content');
  if (isBlank(content)) {
    throw new ImportException(ImportStage.Parse, 'A Proton Pass passkey needs content');
  }
  const stored = readStoredPasskey(base64UrlToBytes(content));
  const extensions = member(stored, 'ext');
  const hmacSecret = isJsonObject(extensions) ? member(extensions, 'hmac_secret') : null;
  return buildPasskey({
    RpId: text(stored, 'rid'),
    CredentialId: bytesOf(member(stored, 'cid')),
    UserHandle: bytesOf(member(stored, 'uhd')),
    Keys: await keys.fromP256Scalar(privateScalar(member(stored, 'key'))),
    PrfSecret: isJsonObject(hmacSecret) ? bytesOf(member(hmacSecret, 'cred_with_uv')) : null,
    DisplayNames: [text(stored, 'udn'), text(stored, 'un'), readStringOrNull(passkey, 'userDisplayName'), readStringOrNull(passkey, 'userName')],
  });
}

/**
 * The stored passkey inside its versioned envelope.
 * @param content - The decoded content
 * @returns The stored passkey
 */
export function readStoredPasskey(content: Uint8Array): JsonObject {
  const envelope = readMessagePack(content);
  if (!isJsonObject(envelope) || member(envelope, 'v') !== FORMAT_VERSION) {
    throw new ImportException(ImportStage.Parse, 'Unsupported Proton Pass passkey format version');
  }
  const inner = bytesOf(member(envelope, 'c'));
  const stored = inner ? readMessagePack(inner) : null;
  if (!isJsonObject(stored)) {
    throw new ImportException(ImportStage.Parse, 'The Proton Pass passkey content is incomplete');
  }
  return stored;
}

/**
 * The private scalar of a stored COSE key, which must be an EC2 key on P-256.
 * @param key - The stored key
 * @returns The scalar
 */
function privateScalar(key: unknown): Uint8Array {
  const parameters = isJsonObject(key) && Array.isArray(member(key, 'par')) ? member(key, 'par') as unknown[] : [];
  /**
   * The value of a key parameter, each stored as a `[label, value]` pair of tagged objects.
   * @param label - The COSE label
   * @returns The tagged value, or null
   */
  const parameter = (label: number): JsonObject | null => {
    for (const entry of parameters) {
      if (Array.isArray(entry) && entry.length === 2 && isJsonObject(entry[0]) && member(entry[0], 't') === 'int' && member(entry[0], 'c') === label && isJsonObject(entry[1])) {
        return entry[1];
      }
    }
    return null;
  };

  // An integer is stored as the 16 little-endian bytes of an i128.
  const curveValue = member(parameter(COSE_CURVE) ?? {}, 'c');
  const curve = isJsonObject(curveValue) ? bytesOf(member(curveValue, 'inner')) : null;
  const keyType = isJsonObject(key) ? member(key, 'kty') : null;
  const isP256 = isJsonObject(keyType) && member(keyType, 'c') === 'EC2' && curve !== null && curve[0] === COSE_CURVE_P256 && curve.subarray(1).every(byte => byte === 0);
  const scalarValue = parameter(COSE_PRIVATE_SCALAR);
  const scalar = scalarValue && member(scalarValue, 't') === 'bytes' ? bytesOf(member(scalarValue, 'c')) : null;
  if (!isP256 || !scalar) {
    throw new ImportException(ImportStage.Parse, 'The Proton Pass passkey key is not a P-256 private key');
  }
  return scalar;
}

/**
 * A member of a stored object, by its exact name.
 * @param obj - The object
 * @param name - The member name
 * @returns The value, or undefined
 */
function member(obj: JsonObject, name: string): unknown {
  return Object.hasOwn(obj, name) ? obj[name] : undefined;
}

/**
 * A string member of a stored object.
 * @param obj - The object
 * @param name - The member name
 * @returns The string, or null
 */
function text(obj: JsonObject, name: string): string | null {
  const value = member(obj, name);
  return typeof value === 'string' ? value : null;
}

/**
 * A byte array, which the format stores as an array of integers.
 * @param value - The stored value
 * @returns The bytes, or null when the value is not a byte array
 */
function bytesOf(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value;
  }
  return Array.isArray(value) && value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255) ? Uint8Array.from(value as number[]) : null;
}
