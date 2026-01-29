/**
 * PasskeyAuthenticator
 * -------------------------
 * A WebAuthn "virtual authenticator" for browser extensions.
 * Implements passkey creation (registration) and authentication (assertion) following
 * the WebAuthn Level 2 specification.
 *
 * This is the reference TypeScript implementation:
 * - iOS: apps/mobile-app/ios/VaultStoreKit/Passkeys/PasskeyAuthenticator.swift
 * - Android: apps/mobile-app/android/app/src/main/java/net/aliasvault/app/vaultstore/passkey/PasskeyAuthenticator.kt
 *
 * IMPORTANT: Keep all implementations synchronized. Changes to the public interface must be
 * reflected in all ports. Method names, parameters, and behavior should remain consistent.
 *
 * Key features:
 * - ES256 (ECDSA P-256) key pair generation
 * - CBOR/COSE encoding for attestation objects
 * - Proper authenticator data with WebAuthn flags
 * - Self-attestation (packed format) or none attestation
 * - Consistent base64url handling
 * - Sign count always 0 for syncable passkeys
 * - BE/BS flags for backup-eligible and backed-up status
 */

import type { CreateRequest, GetRequest, StoredPasskeyRecord } from './types';

/**
 * PasskeyAuthenticator - Static utility class for WebAuthn operations
 */
export class PasskeyAuthenticator {
  /**
   * Private constructor to prevent instantiation.
   */
  private constructor() {}

  /** AliasVault AAGUID: a11a5faa-9f32-4b8c-8c5d-2f7d13e8c942 */
  private static readonly AAGUID = new Uint8Array([
    0xa1, 0x1a, 0x5f, 0xaa, 0x9f, 0x32, 0x4b, 0x8c,
    0x8c, 0x5d, 0x2f, 0x7d, 0x13, 0xe8, 0xc9, 0x42
  ]);

  // MARK: - Public API

  /**
   * Create a new passkey (registration).
   */
  public static async createPasskey(
    credentialIdBytes: Uint8Array,
    req: CreateRequest,
    opts?: {
      uvPerformed?: boolean;
      credentialIdBytes?: number;
      enablePrf?: boolean;
      prfInputs?: { first: string; second?: string };
    }
  ): Promise<PasskeyCreationResult> {
    // 1. Validate algorithm support
    PasskeyAuthenticator.pickSupportedAlgorithm(req.publicKey.pubKeyCredParams);

    // 2. Compute RP ID hash
    const rpId = req.publicKey.rp?.id || new URL(req.origin).hostname;
    const rpIdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', PasskeyAuthenticator.te(rpId) as BufferSource));

    // 3. Generate ES256 key pair
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    const pubJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const prvJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

    // 4. Build credential ID and COSE key
    const credentialIdB64u = PasskeyAuthenticator.toB64u(credentialIdBytes);
    const coseKey = PasskeyAuthenticator.buildCoseEc2Es256(pubJwk);

    // 5. Build authenticator flags
    let flags = 0x41; // UP (bit 0) + AT (bit 6)
    const uvReq = req.publicKey.authenticatorSelection?.userVerification;
    const uvPerformed = !!opts?.uvPerformed;
    if (uvReq === 'required' || (uvReq === 'preferred' && uvPerformed)) {
      flags |= 0x04; // UV (bit 2)
    }
    flags |= 0x08; // BE (bit 3)
    flags |= 0x10; // BS (bit 4)

    // 6. Sign count (always 0 for syncable credentials)
    const signCount = new Uint8Array([0, 0, 0, 0]);

    // 7. Build attested credential data
    const credIdLenBytes = new Uint8Array([(credentialIdBytes.length >> 8) & 0xff, credentialIdBytes.length & 0xff]);
    const attestedCredData = PasskeyAuthenticator.concat(PasskeyAuthenticator.AAGUID, credIdLenBytes, credentialIdBytes, coseKey);

    // 8. Build authenticator data
    const authenticatorData = PasskeyAuthenticator.concat(rpIdHash, new Uint8Array([flags]), signCount, attestedCredData);

    // 9. Build client data JSON
    const challengeB64u = PasskeyAuthenticator.challengeToB64u(req.publicKey.challenge);
    const clientDataObj = {
      type: 'webauthn.create',
      challenge: challengeB64u,
      origin: req.origin,
      crossOrigin: false
    };
    const clientDataJSONStr = JSON.stringify(clientDataObj);
    const clientDataJSONBytes = PasskeyAuthenticator.te(clientDataJSONStr);

    // 10. Build attestation object
    const attPref = req.publicKey.attestation || 'none';
    const attObjBytes =
      attPref === 'none' || attPref === 'indirect'
        ? PasskeyAuthenticator.buildAttObjNone(authenticatorData)
        : await PasskeyAuthenticator.buildAttObjPackedSelf(authenticatorData, clientDataJSONBytes, keyPair.privateKey);

    // 11. Process user ID
    let userIdB64: string | null = null;
    if (req.publicKey.user?.id) {
      userIdB64 = typeof req.publicKey.user.id === 'string'
        ? req.publicKey.user.id
        : PasskeyAuthenticator.toB64(req.publicKey.user.id instanceof Uint8Array ? req.publicKey.user.id : new Uint8Array(req.publicKey.user.id));
    }

    // 12. Generate PRF secret if requested
    let prfSecret: string | undefined;
    let prfEnabled = false;
    let prfResults: { first: ArrayBuffer; second?: ArrayBuffer } | undefined;
    if (opts?.enablePrf) {
      const prfSecretBytes = new Uint8Array(32);
      crypto.getRandomValues(prfSecretBytes);
      prfSecret = PasskeyAuthenticator.toB64u(prfSecretBytes);
      prfEnabled = true;

      // 13. Evaluate PRF values if requested during registration
      if (opts?.prfInputs) {
        const firstSalt = PasskeyAuthenticator.fromB64u(opts.prfInputs.first);
        prfResults = {
          first: await PasskeyAuthenticator.evaluatePrf(prfSecretBytes, firstSalt)
        };

        if (opts.prfInputs.second) {
          const secondSalt = PasskeyAuthenticator.fromB64u(opts.prfInputs.second);
          prfResults.second = await PasskeyAuthenticator.evaluatePrf(prfSecretBytes, secondSalt);
        }
      }
    }

    // 14. Build stored record
    const stored: StoredPasskeyRecord = {
      rpId,
      credentialId: credentialIdB64u,
      publicKey: pubJwk,
      privateKey: prvJwk,
      userId: userIdB64,
      userName: req.publicKey.user?.name,
      userDisplayName: req.publicKey.user?.displayName,
      prfSecret
    };

    // 15. Build credential response
    const credential = {
      id: credentialIdB64u,
      rawId: credentialIdB64u,
      response: {
        clientDataJSON: PasskeyAuthenticator.toB64u(clientDataJSONBytes),
        attestationObject: PasskeyAuthenticator.toB64u(attObjBytes)
      },
      type: 'public-key' as const
    };

    return { credential, stored, prfEnabled, prfResults };
  }

  /**
   * Create an assertion (authentication).
   * Returns assertion data ready for the browser extension to return to the RP.
   */
  public static async getAssertion(
    req: GetRequest,
    storedRecord: StoredPasskeyRecord,
    opts?: { uvPerformed?: boolean; includeBEBS?: boolean; prfInputs?: { first: ArrayBuffer | Uint8Array; second?: ArrayBuffer | Uint8Array } }
  ): Promise<PasskeyAssertionResult> {
    const rec = storedRecord;

    // 1. Compute RP ID hash
    const rpId = req.publicKey.rpId || new URL(req.origin).hostname;
    const rpIdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', PasskeyAuthenticator.te(rpId) as BufferSource));

    // 2. Build authenticator flags
    let flags = 0x01; // UP (bit 0)
    const uvReq = req.publicKey.userVerification;
    const uvPerformed = !!opts?.uvPerformed;
    if (uvReq === 'required' || (uvReq === 'preferred' && uvPerformed)) {
      flags |= 0x04; // UV (bit 2)
    }
    if (opts?.includeBEBS ?? true) {
      flags |= 0x08; // BE (bit 3)
      flags |= 0x10; // BS (bit 4)
    }

    // 3. Sign count (always 0 for syncable credentials)
    const signCount = new Uint8Array([0, 0, 0, 0]);

    // 4. Build authenticator data
    const authenticatorData = PasskeyAuthenticator.concat(rpIdHash, new Uint8Array([flags]), signCount);

    // 5. Build client data JSON
    const challengeB64u = PasskeyAuthenticator.challengeToB64u(req.publicKey.challenge);
    const clientDataObj = {
      type: 'webauthn.get',
      challenge: challengeB64u,
      origin: req.origin,
      crossOrigin: false
    };
    const clientDataJSONStr = JSON.stringify(clientDataObj);
    const clientDataJSONBytes = PasskeyAuthenticator.te(clientDataJSONStr);

    // 6. Build data to sign: authenticatorData || clientDataHash
    const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSONBytes as BufferSource));
    const toSign = PasskeyAuthenticator.concat(authenticatorData, clientDataHash);

    // 7. Import private key and sign
    const privateKey = await crypto.subtle.importKey(
      'jwk',
      rec.privateKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    );
    const rawSig = new Uint8Array(
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, toSign as BufferSource)
    );

    // 8. Convert raw signature to DER format
    const derSig = PasskeyAuthenticator.ecdsaRawToDer(rawSig);

    // 9. Process user handle
    let userHandleB64u: string | null = null;
    if (rec.userId) {
      userHandleB64u = rec.userId.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    // 10. Evaluate PRF if requested
    let prfResults: { first: ArrayBuffer; second?: ArrayBuffer } | undefined;
    if (opts?.prfInputs && rec.prfSecret) {
      const prfSecretBytes = PasskeyAuthenticator.fromB64u(rec.prfSecret);

      const firstResult = await PasskeyAuthenticator.evaluatePrf(prfSecretBytes, opts.prfInputs.first);
      prfResults = { first: firstResult };

      if (opts.prfInputs.second) {
        const secondResult = await PasskeyAuthenticator.evaluatePrf(prfSecretBytes, opts.prfInputs.second);
        prfResults.second = secondResult;
      }
    }

    return {
      id: rec.credentialId,
      rawId: rec.credentialId,
      clientDataJSON: PasskeyAuthenticator.toB64u(clientDataJSONBytes),
      authenticatorData: PasskeyAuthenticator.toB64u(authenticatorData),
      signature: PasskeyAuthenticator.toB64u(derSig),
      userHandle: userHandleB64u,
      prfResults
    };
  }

  // MARK: - PRF Extension

  /**
   * Evaluate PRF (hmac-secret extension).
   * Implements: HMAC-SHA256(prfSecret, SHA-256("WebAuthn PRF\x00" || salt)).
   */
  private static async evaluatePrf(prfSecretBytes: Uint8Array, salt: ArrayBuffer | Uint8Array): Promise<ArrayBuffer> {
    const saltBytes = salt instanceof Uint8Array ? salt : new Uint8Array(salt);

    const prefix = PasskeyAuthenticator.te('WebAuthn PRF\x00');
    const domainSeparatedSalt = PasskeyAuthenticator.concat(prefix, saltBytes);
    const hashedSalt = await crypto.subtle.digest('SHA-256', domainSeparatedSalt as BufferSource);

    const hmacKey = await crypto.subtle.importKey(
      'raw',
      prfSecretBytes as BufferSource,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const prfOutput = await crypto.subtle.sign('HMAC', hmacKey, hashedSalt);

    return prfOutput;
  }

  // MARK: - CBOR Encoding

  /**
   * Ensure ES256 (-7) is available.
   * @param params - Public key credential parameters
   * @returns Algorithm identifier (-7 for ES256)
   */
  private static pickSupportedAlgorithm(params?: Array<{ type: 'public-key'; alg: number }>): number {
    if (!params || params.length === 0) {
      return -7;
    }
    const hasEs256 = params.some(p => p.type === 'public-key' && p.alg === -7);
    if (!hasEs256) {
      throw new Error('No supported algorithm (ES256) in pubKeyCredParams');
    }
    return -7;
  }

  /**
   * Build COSE EC2 public key for ES256.
   * CBOR map: {1: 2, 3: -7, -1: 1, -2: x, -3: y}.
   */
  private static buildCoseEc2Es256(jwk: JsonWebKey): Uint8Array {
    const x = PasskeyAuthenticator.pad32(PasskeyAuthenticator.fromB64u(jwk.x!));
    const y = PasskeyAuthenticator.pad32(PasskeyAuthenticator.fromB64u(jwk.y!));

    return new Uint8Array([
      0xa5,
      0x01, 0x02,               // 1: 2 (kty: EC2)
      0x03, 0x26,               // 3: -7 (alg: ES256)
      0x20, 0x01,               // -1: 1 (crv: P-256)
      0x21, 0x58, 0x20, ...x,   // -2: bytes(32) for x
      0x22, 0x58, 0x20, ...y    // -3: bytes(32) for y
    ]);
  }

  /**
   * Build attestation object with "none" format.
   * CBOR map: {fmt: "none", attStmt: {}, authData: <bytes>}.
   */
  private static buildAttObjNone(authenticatorData: Uint8Array): Uint8Array {
    const fmtKey = PasskeyAuthenticator.cborText('fmt');
    const fmtVal = PasskeyAuthenticator.cborText('none');
    const attStmtKey = PasskeyAuthenticator.cborText('attStmt');
    const attStmtVal = new Uint8Array([0xa0]);
    const authDataKey = PasskeyAuthenticator.cborText('authData');
    const authDataVal = PasskeyAuthenticator.cborBstr(authenticatorData);

    return PasskeyAuthenticator.concat(
      new Uint8Array([0xa3]),
      fmtKey, fmtVal,
      attStmtKey, attStmtVal,
      authDataKey, authDataVal
    );
  }

  /**
   * Build "packed" self-attestation object (no x5c).
   */
  private static async buildAttObjPackedSelf(
    authenticatorData: Uint8Array,
    clientDataJSON: Uint8Array,
    privateKey: CryptoKey
  ): Promise<Uint8Array> {
    const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON as BufferSource));
    const toSign = PasskeyAuthenticator.concat(authenticatorData, clientDataHash);
    const rawSig = new Uint8Array(
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, toSign as BufferSource)
    );
    const derSig = PasskeyAuthenticator.ecdsaRawToDer(rawSig);

    const attStmtMap = PasskeyAuthenticator.concat(
      PasskeyAuthenticator.cborText('alg'), new Uint8Array([0x26]),
      PasskeyAuthenticator.cborText('sig'), PasskeyAuthenticator.cborBstr(derSig)
    );
    const attStmt = PasskeyAuthenticator.concat(new Uint8Array([0xa2]), attStmtMap);

    const fmtKey = PasskeyAuthenticator.cborText('fmt');
    const fmtVal = PasskeyAuthenticator.cborText('packed');
    const attStmtKey = PasskeyAuthenticator.cborText('attStmt');
    const authDataKey = PasskeyAuthenticator.cborText('authData');
    const authDataVal = PasskeyAuthenticator.cborBstr(authenticatorData);

    return PasskeyAuthenticator.concat(
      new Uint8Array([0xa3]),
      fmtKey, fmtVal,
      attStmtKey, attStmt,
      authDataKey, authDataVal
    );
  }

  /**
   * Encode a string as CBOR text.
   */
  private static cborText(s: string): Uint8Array {
    const bytes = PasskeyAuthenticator.te(s);
    if (bytes.length <= 23) {
      return new Uint8Array([0x60 | bytes.length, ...bytes]);
    }
    if (bytes.length <= 0xff) {
      return new Uint8Array([0x78, bytes.length, ...bytes]);
    }
    return new Uint8Array([0x79, (bytes.length >> 8) & 0xff, bytes.length & 0xff, ...bytes]);
  }

  /**
   * Encode bytes as CBOR byte string.
   */
  private static cborBstr(b: Uint8Array): Uint8Array {
    if (b.length <= 23) {
      return new Uint8Array([0x40 | b.length, ...b]);
    }
    if (b.length <= 0xff) {
      return new Uint8Array([0x58, b.length, ...b]);
    }
    return new Uint8Array([0x59, (b.length >> 8) & 0xff, b.length & 0xff, ...b]);
  }

  // MARK: - Signature Conversion

  /**
   * Convert raw ECDSA signature (r|s, 64 bytes) to DER SEQUENCE.
   */
  private static ecdsaRawToDer(raw: Uint8Array): Uint8Array {
    if (raw.length !== 64) {
      throw new Error('Unexpected ECDSA signature length');
    }
    const r = raw.slice(0, 32);
    const s = raw.slice(32, 64);
    const rDer = PasskeyAuthenticator.derInt(r);
    const sDer = PasskeyAuthenticator.derInt(s);
    return new Uint8Array([0x30, rDer.length + sDer.length, ...rDer, ...sDer]);
  }

  /**
   * Encode a positive big integer as DER INTEGER.
   */
  private static derInt(src: Uint8Array): Uint8Array {
    let i = 0;
    while (i < src.length - 1 && src[i] === 0x00) {
      i++;
    }
    let v = src.slice(i);
    if ((v[0] & 0x80) !== 0) {
      const padded = new Uint8Array(v.length + 1);
      padded[0] = 0x00;
      padded.set(v, 1);
      v = padded;
    }
    return new Uint8Array([0x02, v.length, ...v]);
  }

  // MARK: - Base64 Encoding

  /**
   * UTF-8 encode string to bytes.
   * @param s - String to encode
   * @returns Encoded bytes
   */
  private static te(s: string): Uint8Array {
    const encoder = new TextEncoder();
    return encoder.encode(s);
  }

  /**
   * Base64 encode bytes.
   * @param bytes - Bytes to encode
   * @returns Base64 string
   */
  private static toB64(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) {
      bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin);
  }

  /**
   * Base64url encode bytes.
   * @param bytes - Bytes to encode
   * @returns Base64url string
   */
  private static toB64u(bytes: Uint8Array): string {
    return PasskeyAuthenticator.toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  /**
   * Base64url decode to bytes.
   * @param b64u - Base64url string
   * @returns Decoded bytes
   */
  private static fromB64u(b64u: string): Uint8Array {
    const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 2 ? '==' : b64.length % 4 === 3 ? '=' : '';
    const s = atob(b64 + pad);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
      out[i] = s.charCodeAt(i);
    }
    return out;
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
    const bytes = challenge instanceof Uint8Array ? challenge : new Uint8Array(challenge);
    return PasskeyAuthenticator.toB64u(bytes);
  }

  /**
   * Left-pad to 32 bytes for P-256 coordinates.
   * @param b - Bytes to pad
   * @returns Padded bytes
   */
  private static pad32(b: Uint8Array): Uint8Array {
    if (b.length === 32) {
      return b;
    }
    const out = new Uint8Array(32);
    out.set(b, 32 - b.length);
    return out;
  }

  /**
   * Concatenate typed arrays.
   * @param chunks - Arrays to concatenate
   * @returns Concatenated array
   */
  private static concat(...chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
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
  /** Signature in DER format (base64url). */
  signature: string;
  /** User handle (base64url). */
  userHandle: string | null;
  /** PRF evaluation results if requested. */
  prfResults?: { first: ArrayBuffer; second?: ArrayBuffer };
};
