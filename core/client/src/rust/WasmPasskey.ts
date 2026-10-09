/*
 * The Rust passkey authenticator (core/rust/src/passkey) for hosts that run the core as WebAssembly. It is kept off
 * IRustCore because only the browser extension acts as an authenticator; the mobile apps call it natively.
 */
import * as core from '../../wasm/aliasvault_core.js';

import { rustCore } from './RustCore';

/**
 * The PRF salts of a request.
 */
export type PasskeyPrfInputs = {
  first: Uint8Array;
  second?: Uint8Array;
};

/**
 * The PRF outputs for the requested salts.
 */
export type PasskeyPrfResults = {
  first: Uint8Array;
  second: Uint8Array | null;
};

/**
 * A new passkey: what the relying party receives, and the keys and PRF secret the vault stores.
 */
export type PasskeyCreation = {
  attestationObject: Uint8Array;
  authenticatorData: Uint8Array;
  publicKeyJwk: string;
  publicKeySpki: Uint8Array;
  privateKeyJwk: string;
  prfSecret: Uint8Array | null;
  prfResults: PasskeyPrfResults | null;
};

/**
 * A signed assertion for the relying party.
 */
export type PasskeyAssertion = {
  authenticatorData: Uint8Array;
  signature: Uint8Array;
  prfResults: PasskeyPrfResults | null;
};

/**
 * The first algorithm (COSE id) in the relying party's order that the authenticator supports; ES256 for an empty list.
 * @param requested - The relying party's algorithms, in its order of preference
 * @returns The chosen algorithm
 */
export async function passkeyPickAlgorithm(requested: number[]): Promise<number> {
  await rustCore().init();
  return core.passkeyPickAlgorithm(Int32Array.from(requested));
}

/**
 * Create a passkey. With `selfAttestationClientDataHash` the attestation is "packed" self-attestation, otherwise "none".
 * @param options - The credential id, relying party, algorithm and requested extensions
 * @returns The new passkey
 */
export async function passkeyCreate(options: {
  credentialId: Uint8Array;
  rpId: string;
  algorithm: number;
  uvPerformed: boolean;
  enablePrf: boolean;
  prfInputs?: PasskeyPrfInputs;
  selfAttestationClientDataHash?: Uint8Array;
}): Promise<PasskeyCreation> {
  await rustCore().init();
  const { credentialId, rpId, algorithm, uvPerformed, enablePrf, prfInputs, selfAttestationClientDataHash } = options;
  return core.passkeyCreate(credentialId, rpId, algorithm, uvPerformed, enablePrf, prfInputs?.first, prfInputs?.second, selfAttestationClientDataHash) as PasskeyCreation;
}

/**
 * Sign an assertion over `authenticatorData || clientDataHash` with a stored private key JWK.
 * @param options - The relying party, client data hash, stored key and PRF request
 * @returns The signed assertion
 */
export async function passkeyGetAssertion(options: {
  rpId: string;
  clientDataHash: Uint8Array;
  privateKeyJwk: string;
  uvPerformed: boolean;
  prfInputs?: PasskeyPrfInputs;
  prfSecret?: Uint8Array;
}): Promise<PasskeyAssertion> {
  await rustCore().init();
  const { rpId, clientDataHash, privateKeyJwk, uvPerformed, prfInputs, prfSecret } = options;
  return core.passkeyGetAssertion(rpId, clientDataHash, privateKeyJwk, uvPerformed, prfInputs?.first, prfInputs?.second, prfSecret) as PasskeyAssertion;
}
