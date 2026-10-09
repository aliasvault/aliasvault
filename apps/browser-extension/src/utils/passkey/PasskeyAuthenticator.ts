import { passkeyCreate, passkeyGetAssertion, passkeyPickAlgorithm } from '@aliasvault/client/rust/WasmPasskey';

import { PasskeyHelper } from './PasskeyHelper';

import type { CreateRequest, GetRequest, StoredPasskeyRecord } from './types';
import type { PasskeyPrfResults } from '@aliasvault/client/rust/WasmPasskey';

/**
 * The WebAuthn authenticator of the browser extension. It builds the client data JSON and the responses the page
 * receives; key generation, authenticator data, the attestation object, signatures and PRF run in the Rust core
 * (core/rust/src/passkey).
 * Other platform implementations: PasskeyAuthenticator.swift (iOS), PasskeyAuthenticator.kt (Android).
 */
export class PasskeyAuthenticator {
  /**
   * Private constructor to prevent instantiation.
   */
  private constructor() {}

  /**
   * Create a new passkey (registration).
   */
  public static async createPasskey(
    credentialIdBytes: Uint8Array,
    req: CreateRequest,
    opts?: {
      uvPerformed?: boolean;
      enablePrf?: boolean;
      prfInputs?: { first: string; second?: string };
    }
  ): Promise<PasskeyCreationResult> {
    const algorithm = await PasskeyAuthenticator.pickAlgorithm(req.publicKey.pubKeyCredParams);
    const rpId = req.publicKey.rp?.id || new URL(req.origin).hostname;

    /*
     * An omitted authenticatorSelection.userVerification defaults to "preferred" per the WebAuthn spec. Keep
     * registration and assertion symmetric so a credential registered as verified also asserts as verified.
     */
    const uvReq = req.publicKey.authenticatorSelection?.userVerification ?? 'preferred';
    const uvPerformed = uvReq === 'required' || (uvReq === 'preferred' && !!opts?.uvPerformed);

    const clientDataJSON = PasskeyAuthenticator.clientDataJSON('webauthn.create', req.publicKey.challenge, req.origin);

    // "direct" and "enterprise" get packed self-attestation over the client data; "none" and "indirect" get none.
    const attestation = req.publicKey.attestation || 'none';
    const selfAttestationClientDataHash = attestation === 'none' || attestation === 'indirect' ? undefined : await PasskeyAuthenticator.sha256(clientDataJSON);

    const prfInputs = opts?.enablePrf && opts.prfInputs
      ? { first: PasskeyHelper.base64urlToBytes(opts.prfInputs.first), second: opts.prfInputs.second ? PasskeyHelper.base64urlToBytes(opts.prfInputs.second) : undefined }
      : undefined;

    const created = await passkeyCreate({
      credentialId: credentialIdBytes,
      rpId,
      algorithm,
      uvPerformed,
      enablePrf: !!opts?.enablePrf,
      prfInputs,
      selfAttestationClientDataHash
    });

    let userIdB64: string | null = null;
    if (req.publicKey.user?.id) {
      userIdB64 = typeof req.publicKey.user.id === 'string'
        ? req.publicKey.user.id
        : PasskeyHelper.arrayBufferToBase64(req.publicKey.user.id);
    }

    const credentialIdB64u = PasskeyHelper.bytesToBase64url(credentialIdBytes);
    const stored: StoredPasskeyRecord = {
      rpId,
      credentialId: credentialIdB64u,
      publicKey: JSON.parse(created.publicKeyJwk) as JsonWebKey,
      privateKey: JSON.parse(created.privateKeyJwk) as JsonWebKey,
      userId: userIdB64,
      userName: req.publicKey.user?.name,
      userDisplayName: req.publicKey.user?.displayName,
      prfSecret: created.prfSecret ? PasskeyHelper.bytesToBase64url(created.prfSecret) : undefined
    };

    const credential = {
      id: credentialIdB64u,
      rawId: credentialIdB64u,
      response: {
        clientDataJSON: PasskeyHelper.bytesToBase64url(clientDataJSON),
        attestationObject: PasskeyHelper.bytesToBase64url(created.attestationObject),
        authenticatorData: PasskeyHelper.bytesToBase64url(created.authenticatorData),
        publicKey: PasskeyHelper.bytesToBase64url(created.publicKeySpki),
        publicKeyAlgorithm: algorithm
      },
      type: 'public-key' as const
    };

    return { credential, stored, prfEnabled: !!opts?.enablePrf, prfResults: PasskeyAuthenticator.prfResults(created.prfResults) };
  }

  /**
   * Create an assertion (authentication).
   * Returns assertion data ready for the browser extension to return to the RP.
   */
  public static async getAssertion(
    req: GetRequest,
    storedRecord: StoredPasskeyRecord,
    opts?: { uvPerformed?: boolean; prfInputs?: { first: ArrayBuffer | Uint8Array; second?: ArrayBuffer | Uint8Array } }
  ): Promise<PasskeyAssertionResult> {
    const rec = storedRecord;
    const rpId = req.publicKey.rpId || new URL(req.origin).hostname;

    /*
     * An omitted userVerification defaults to "preferred" per the WebAuthn spec (not "discouraged"), and this
     * authenticator always performs UV, so set the UV flag for required/preferred. RPs that registered with UV
     * "required" reject UV=0 assertions.
     */
    const uvReq = req.publicKey.userVerification ?? 'preferred';
    const uvPerformed = uvReq === 'required' || (uvReq === 'preferred' && !!opts?.uvPerformed);

    const clientDataJSON = PasskeyAuthenticator.clientDataJSON('webauthn.get', req.publicKey.challenge, req.origin);
    const prfInputs = opts?.prfInputs && rec.prfSecret
      ? { first: PasskeyAuthenticator.bytes(opts.prfInputs.first), second: opts.prfInputs.second ? PasskeyAuthenticator.bytes(opts.prfInputs.second) : undefined }
      : undefined;

    const assertion = await passkeyGetAssertion({
      rpId,
      clientDataHash: await PasskeyAuthenticator.sha256(clientDataJSON),
      privateKeyJwk: JSON.stringify(rec.privateKey),
      uvPerformed,
      prfInputs,
      prfSecret: rec.prfSecret ? PasskeyHelper.base64urlToBytes(rec.prfSecret) : undefined
    });

    return {
      id: rec.credentialId,
      rawId: rec.credentialId,
      clientDataJSON: PasskeyHelper.bytesToBase64url(clientDataJSON),
      authenticatorData: PasskeyHelper.bytesToBase64url(assertion.authenticatorData),
      signature: PasskeyHelper.bytesToBase64url(assertion.signature),
      userHandle: rec.userId ? rec.userId.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : null,
      prfResults: PasskeyAuthenticator.prfResults(assertion.prfResults)
    };
  }

  /**
   * The credential algorithm for the RP's pubKeyCredParams, in the RP's order; ES256 when it lists none.
   * @param params - Public key credential parameters
   * @returns COSE algorithm identifier (-7 for ES256, -257 for RS256)
   */
  private static async pickAlgorithm(params?: Array<{ type: 'public-key'; alg: number }>): Promise<number> {
    if (!params || params.length === 0) {
      return passkeyPickAlgorithm([]);
    }
    const publicKeyAlgorithms = params.filter(p => p.type === 'public-key').map(p => p.alg);
    if (publicKeyAlgorithms.length === 0) {
      throw new Error('No supported algorithm (ES256, RS256) in pubKeyCredParams');
    }
    return passkeyPickAlgorithm(publicKeyAlgorithms);
  }

  /**
   * The client data JSON bytes of a ceremony.
   * @param type - The ceremony type
   * @param challenge - The RP's challenge
   * @param origin - The calling origin
   * @returns The UTF-8 JSON bytes
   */
  private static clientDataJSON(type: 'webauthn.create' | 'webauthn.get', challenge: ArrayBuffer | Uint8Array | string, origin: string): Uint8Array {
    return new TextEncoder().encode(JSON.stringify({ type, challenge: PasskeyAuthenticator.challengeToB64u(challenge), origin, crossOrigin: false }));
  }

  /**
   * PRF results from the Rust core in the shape the callers expect.
   * @param results - The PRF outputs, or null
   * @returns The outputs as ArrayBuffers
   */
  private static prfResults(results: PasskeyPrfResults | null): { first: ArrayBuffer; second?: ArrayBuffer } | undefined {
    if (!results) {
      return undefined;
    }
    return { first: results.first.slice().buffer, second: results.second ? results.second.slice().buffer : undefined };
  }

  /**
   * SHA-256 of bytes.
   * @param bytes - The bytes to hash
   * @returns The digest
   */
  private static async sha256(bytes: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  }

  /**
   * Bytes of an ArrayBuffer or Uint8Array.
   * @param value - The buffer
   * @returns The bytes
   */
  private static bytes(value: ArrayBuffer | Uint8Array): Uint8Array {
    return value instanceof Uint8Array ? value : new Uint8Array(value);
  }

  /**
   * Normalize challenge to base64url string.
   * @param challenge - Challenge from WebAuthn request
   * @returns Base64url encoded challenge
   */
  private static challengeToB64u(challenge: ArrayBuffer | Uint8Array | string): string {
    if (typeof challenge === 'string') {
      return challenge.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    return PasskeyHelper.bytesToBase64url(PasskeyAuthenticator.bytes(challenge));
  }
}

/**
 * Result of passkey creation containing credential and storage data.
 */
export type PasskeyCreationResult = {
  /** The credential object returned to the RP. */
  credential: {
    id: string;
    rawId: string;
    response: {
      clientDataJSON: string;
      attestationObject: string;
      /** The authenticator data inside the attestation object (base64url). */
      authenticatorData: string;
      /** The public key as DER SubjectPublicKeyInfo (base64url). */
      publicKey: string;
      /** The COSE algorithm of the key. */
      publicKeyAlgorithm: number;
    };
    type: 'public-key';
  };
  /** The stored passkey record for vault storage. */
  stored: StoredPasskeyRecord;
  /** Whether PRF extension is enabled. */
  prfEnabled?: boolean;
  /** PRF evaluation results if requested. */
  prfResults?: { first: ArrayBuffer; second?: ArrayBuffer };
};

/**
 * Result of passkey assertion containing authentication data.
 */
export type PasskeyAssertionResult = {
  /** The credential identifier. */
  id: string;
  /** The raw credential identifier (base64url). */
  rawId: string;
  /** Client data JSON (base64url). */
  clientDataJSON: string;
  /** Authenticator data (base64url). */
  authenticatorData: string;
  /** Signature (base64url): DER-encoded for ES256, raw PKCS#1 v1.5 for RS256. */
  signature: string;
  /** User handle (base64url). */
  userHandle: string | null;
  /** PRF evaluation results if requested. */
  prfResults?: { first: ArrayBuffer; second?: ArrayBuffer };
};
