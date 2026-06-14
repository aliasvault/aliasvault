/**
 * PasskeyAssertionService
 * -----------------------
 * Shared helper that turns a stored passkey into a WebAuthn assertion response.
 */

import type { SqliteClient } from '@/utils/SqliteClient';

import { PasskeyAuthenticator } from './PasskeyAuthenticator';
import { PasskeyHelper } from './PasskeyHelper';

import type {
  GetRequest,
  PasskeyGetCredentialResponse,
  StoredPasskeyRecord,
  WebAuthnPublicKeyGetPayload
} from './types';

/**
 * A pending `get` request, narrowed to the fields needed to build an assertion.
 */
export type PasskeyAssertionRequest = {
  origin: string;
  requestId?: string;
  publicKey: WebAuthnPublicKeyGetPayload;
};

/**
 * Normalize a PRF (hmac-secret) salt into raw bytes. Over the messaging bridge the salt
 * arrives either as a base64 string or as a Uint8Array that JSON-serialization flattened
 * into a numeric-keyed object, so we accept both shapes.
 */
function parsePrfSalt(input: unknown): Uint8Array {
  // Numeric object format: a Uint8Array serialized through JSON as {0: 68, 1: 204, ...}
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    const indices = Object.keys(input).map(Number).sort((a, b) => a - b);
    const bytes = new Uint8Array(indices.length);
    for (let i = 0; i < indices.length; i++) {
      bytes[i] = (input as unknown as Record<number, number>)[i];
    }
    return bytes;
  }

  // Base64 string format
  if (typeof input === 'string') {
    const decoded = atob(input);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) {
      bytes[i] = decoded.charCodeAt(i);
    }
    return bytes;
  }

  throw new Error('Unknown PRF input format');
}

/**
 * Read the PRF eval inputs from a request, if it asked for the PRF extension.
 */
function extractPrfInputs(
  publicKey: WebAuthnPublicKeyGetPayload
): { first: Uint8Array; second?: Uint8Array } | undefined {
  const evalInputs = publicKey.extensions?.prf?.eval;
  if (!evalInputs) {
    return undefined;
  }

  const prfInputs: { first: Uint8Array; second?: Uint8Array } = {
    first: parsePrfSalt(evalInputs.first)
  };
  if (evalInputs.second) {
    prfInputs.second = parsePrfSalt(evalInputs.second);
  }
  return prfInputs;
}

/**
 * Build a WebAuthn assertion response for a stored passkey.
 *
 * @param sqliteClient - An initialized client for the unlocked vault.
 * @param request - The pending `get` request (origin + publicKey challenge).
 * @param passkeyId - The vault ID (GUID) of the passkey the user selected.
 * @returns The assertion response ready to hand back to the relying party.
 * @throws If the passkey does not exist in the vault.
 */
export async function buildPasskeyAssertion(
  sqliteClient: SqliteClient,
  request: PasskeyAssertionRequest,
  passkeyId: string
): Promise<PasskeyGetCredentialResponse> {
  const storedPasskey = sqliteClient.passkeys.getById(passkeyId);
  if (!storedPasskey) {
    throw new Error(`Passkey not found for id ${passkeyId}`);
  }

  // Parse the stored EC key pair (stored as JWK JSON strings).
  const publicKey = JSON.parse(storedPasskey.PublicKey) as JsonWebKey;
  const privateKey = JSON.parse(storedPasskey.PrivateKey) as JsonWebKey;

  // The PRF secret (hmac-secret) is stored as raw bytes; the authenticator wants base64url.
  let prfSecret: string | undefined;
  if (storedPasskey.PrfKey) {
    prfSecret = PasskeyHelper.bytesToBase64url(storedPasskey.PrfKey);
  }

  // The user handle is stored as raw bytes; serialize to base64url for the assertion.
  let userIdBase64: string | null = null;
  if (storedPasskey.UserHandle) {
    const userHandleBytes = storedPasskey.UserHandle instanceof Uint8Array
      ? storedPasskey.UserHandle
      : new Uint8Array(storedPasskey.UserHandle);
    userIdBase64 = PasskeyHelper.bytesToBase64url(userHandleBytes);
  }

  const storedRecord: StoredPasskeyRecord = {
    rpId: storedPasskey.RpId,
    credentialId: PasskeyHelper.guidToBase64url(storedPasskey.Id),
    publicKey,
    privateKey,
    userId: userIdBase64,
    userName: storedPasskey.Username ?? undefined,
    userDisplayName: storedPasskey.ServiceName ?? undefined,
    prfSecret
  };

  const getRequest: GetRequest = {
    origin: request.origin,
    requestId: request.requestId,
    publicKey: {
      rpId: request.publicKey.rpId,
      challenge: request.publicKey.challenge,
      userVerification: request.publicKey.userVerification
    }
  };

  const assertion = await PasskeyAuthenticator.getAssertion(getRequest, storedRecord, {
    uvPerformed: true,
    includeBEBS: true,
    prfInputs: extractPrfInputs(request.publicKey)
  });

  // PRF results come back as ArrayBuffers; encode them for transport over the bridge.
  let prfResults: { first: string; second?: string } | undefined;
  if (assertion.prfResults) {
    prfResults = {
      first: PasskeyHelper.arrayBufferToBase64(assertion.prfResults.first)
    };
    if (assertion.prfResults.second) {
      prfResults.second = PasskeyHelper.arrayBufferToBase64(assertion.prfResults.second);
    }
  }

  return {
    id: assertion.id,
    rawId: assertion.rawId,
    clientDataJSON: assertion.clientDataJSON,
    authenticatorData: assertion.authenticatorData,
    signature: assertion.signature,
    userHandle: assertion.userHandle,
    prfResults
  };
}
