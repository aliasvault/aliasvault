import { passkeyEd25519SeedToJwk, passkeyP256ScalarToJwk, passkeyPkcs8ToJwk } from '../../../rust/RustCore';
import { isBlank } from '../../shared/StringUtils';
import { ImportException, ImportStage } from '../models/ImportException';

import type { JsonObject } from './JsonReader';
import type { JwkPair } from '../../../rust/RustCoreTypes';
import type { ImportedCredential } from '../models/ImportedCredential';
import type { ImportedPasskey } from '../models/ImportedPasskey';
import type { ImportFileResult } from '../models/ImportFileResult';

/** The WebAuthn size limits of a credential id and a user handle, and the size of an hmac-secret (PRF) secret. */
const MAX_CREDENTIAL_ID_BYTES = 1023;
const MAX_USER_HANDLE_BYTES = 64;
const PRF_SECRET_BYTES = 32;

/**
 * Converts the private key of another provider's passkey to the JWK pair the vault stores.
 */
export type PasskeyKeyConverter = {
  /** From a PKCS#8 DER private key (P-256, Ed25519 or RSA). */
  fromPkcs8(pkcs8Der: Uint8Array): Promise<JwkPair>;
  /** From a raw P-256 private scalar. */
  fromP256Scalar(scalar: Uint8Array): Promise<JwkPair>;
  /** From a raw Ed25519 private key (its 32-byte seed). */
  fromEd25519Seed(seed: Uint8Array): Promise<JwkPair>;
};

/**
 * The key converter of the Rust core, which every importer uses unless a test passes its own.
 */
export const rustPasskeyKeys: PasskeyKeyConverter = { fromPkcs8: passkeyPkcs8ToJwk, fromP256Scalar: passkeyP256ScalarToJwk, fromEd25519Seed: passkeyEd25519SeedToJwk };

/**
 * What a provider's export says about one passkey.
 */
export type PasskeyParts = {
  RpId: string | null;
  CredentialId: Uint8Array | null;
  UserHandle: Uint8Array | null;
  Keys: JwkPair;
  /** The hmac-secret (PRF) secret; anything but 32 bytes is ignored. */
  PrfSecret?: Uint8Array | null;
  /** Names in order of preference; the first one with text is used, else the relying party id. */
  DisplayNames: (string | null)[];
};

/**
 * The passkeys of one credential as raw export JSON, still to be read.
 */
export type PendingPasskeys = {
  Credential: ImportedCredential;
  /** Zero-based position of the item in the export. */
  Index: number;
  Passkeys: JsonObject[];
};

/**
 * Build an imported passkey from its parts, checking the WebAuthn size limits.
 * @param parts - The parts
 * @returns The passkey
 * @throws {ImportException} When the relying party or credential id is missing, or a size limit is exceeded.
 */
export function buildPasskey(parts: PasskeyParts): ImportedPasskey {
  const { RpId: rpId, CredentialId: credentialId, UserHandle: userHandle } = parts;
  if (isBlank(rpId) || !credentialId || credentialId.length === 0 || credentialId.length > MAX_CREDENTIAL_ID_BYTES || (userHandle?.length ?? 0) > MAX_USER_HANDLE_BYTES) {
    throw new ImportException(ImportStage.Parse, 'A passkey rpId, credentialId or userHandle is missing or has an invalid length');
  }
  return {
    RpId: rpId,
    CredentialId: credentialId,
    UserHandle: userHandle && userHandle.length > 0 ? userHandle : null,
    PublicKey: parts.Keys.publicKeyJwk,
    PrivateKey: parts.Keys.privateKeyJwk,
    PrfKey: parts.PrfSecret?.length === PRF_SECRET_BYTES ? parts.PrfSecret : null,
    DisplayName: parts.DisplayNames.find(name => !isBlank(name)) ?? rpId,
  };
}

/**
 * Read the pending passkeys into their credentials. A passkey that cannot be read is reported as a failure and its
 * item is kept.
 * @param result - The import result to complete
 * @param pending - The passkeys still to be read
 * @param readPasskey - Reads one passkey of the export
 * @returns The same result
 */
export async function addPasskeys(result: ImportFileResult, pending: PendingPasskeys[], readPasskey: (passkey: JsonObject) => Promise<ImportedPasskey>): Promise<ImportFileResult> {
  for (const { Credential, Index, Passkeys } of pending) {
    for (const raw of Passkeys) {
      try {
        const passkey = await readPasskey(raw);
        Credential.Passkeys ??= [];
        Credential.Passkeys.push(passkey);
        if (!Credential.ServiceUrls || Credential.ServiceUrls.length === 0) {
          Credential.ServiceUrls = [`https://${passkey.RpId}`];
        }
      } catch {
        // The error could hold key material, so only the item is named.
        result.FailedItems.push({ Index, ItemTitle: Credential.ServiceName, ExceptionType: 'PasskeyImportError', Message: `A passkey of this item could not be imported: see item #${Index} in the export.` });
      }
    }
  }
  return result;
}
