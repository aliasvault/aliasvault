import { AppErrorCode, extractErrorCode } from '@aliasvault/client/api/errors/AppErrorCodes';
import { VaultKeyService } from '@aliasvault/client/auth/VaultKeyService';
import { EncryptionUtility } from '@aliasvault/client/crypto/EncryptionUtility';
import { getPlatform } from '@aliasvault/client/platform';
import { base64ToBytes, bytesToBase64 } from '@aliasvault/client/utilities/Base64';

import { getLocalPreference, removeLocalPreference, setLocalPreference } from '@/utils/LocalPreferences';
import { StorageKeys } from '@/utils/StorageKeys';

/** Local storage keys for the WebAuthn quick unlock. */
const KEYS = {
  enabled: 'webAuthnEnabled',
  credentialId: 'webAuthnCredentialId',
  salt: 'webAuthnSalt',
  encryptedKeys: 'webAuthnEncryptedEncryptionKey',
} as const;

/**
 * What the passkey-derived key encrypts: the session unlock key (the KEK), never the keys the chain opens.
 */
type WebAuthnSessionKeys = {
  UnlockKey: string;
};

/**
 * Thrown when the browser or authenticator has no PRF support.
 */
export class WebAuthnNotSupportedError extends Error {
  /**
   * Create the error.
   */
  public constructor() {
    super('WebAuthn PRF extension is not supported');
    this.name = 'WebAuthnNotSupportedError';
  }
}

/**
 * The PRF output of a credential assertion, or null when the authenticator returned none.
 */
const prfResult = (credential: Credential | null): ArrayBuffer | null => {
  const results = (credential as PublicKeyCredential | null)?.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } } | undefined;
  return results?.prf?.results?.first ?? null;
};

/**
 * Whether the PRF extension is present on a credential response.
 */
const hasPrf = (credential: Credential | null): boolean => {
  const results = (credential as PublicKeyCredential | null)?.getClientExtensionResults() as { prf?: unknown } | undefined;
  return results?.prf !== undefined;
};

/**
 * Ask the authenticator for the key derived from a stored credential and salt.
 */
async function getCredentialDerivedKey(credentialId: string, salt: string): Promise<string> {
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: window.location.hostname,
      userVerification: 'discouraged',
      allowCredentials: [{ id: base64ToBytes(credentialId), type: 'public-key' }],
      extensions: { prf: { eval: { first: base64ToBytes(salt) } } } as AuthenticationExtensionsClientInputs,
    },
  });
  if (!hasPrf(credential)) {
    throw new WebAuthnNotSupportedError();
  }
  const derived = prfResult(credential);
  if (!derived) {
    throw new Error('PRF_DERIVATION_FAILED');
  }
  return bytesToBase64(new Uint8Array(derived));
}

/**
 * Create a passkey and derive a key from it.
 */
async function createCredentialDerivedKey(username: string): Promise<{ credentialId: string; salt: string; derivedKey: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const created = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'AliasVault Web Unlock', id: window.location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(32)), name: username, displayName: username },
      pubKeyCredParams: [-7, -257, -37, -8, -35, -36, -259, -258, -38, -39].map(alg => ({ alg, type: 'public-key' as const })),
      authenticatorSelection: { userVerification: 'discouraged', residentKey: 'discouraged', requireResidentKey: false },
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  }) as PublicKeyCredential | null;
  if (!created) {
    throw new Error('WEBAUTHN_CREATE_ERROR');
  }
  if (!hasPrf(created)) {
    throw new WebAuthnNotSupportedError();
  }

  let derived = prfResult(created);
  if (!derived) {
    // Some authenticators (YubiKey among them) only return the PRF output on an assertion, not on creation.
    alert('Your authenticator has been successfully registered. Please use your authenticator again to complete the process.');
    const asserted = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: window.location.hostname,
        userVerification: 'discouraged',
        allowCredentials: [{ id: created.rawId, type: 'public-key' }],
        extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      },
    });
    derived = prfResult(asserted);
  }
  if (!derived) {
    throw new Error('PRF_DERIVATION_FAILED');
  }
  return { credentialId: bytesToBase64(new Uint8Array(created.rawId)), salt: bytesToBase64(salt), derivedKey: bytesToBase64(new Uint8Array(derived)) };
}

/**
 * Passkey quick unlock: the session unlock key encrypted with a key the passkey derives, kept in localStorage.
 */
export const WebAuthnService = {
  /**
   * Whether passkey unlock is set up on this browser.
   */
  isEnabled(): boolean {
    return getLocalPreference(KEYS.enabled) === 'true';
  },

  /**
   * Create a passkey and encrypt the current session unlock key with it.
   */
  async enable(username: string): Promise<void> {
    const unlockKey = await VaultKeyService.getSessionUnlockKey();
    if (!unlockKey) {
      throw new Error('Vault is locked');
    }
    const credential = await createCredentialDerivedKey(username);
    const payload: WebAuthnSessionKeys = { UnlockKey: unlockKey };
    const encrypted = await EncryptionUtility.symmetricEncrypt(JSON.stringify(payload), credential.derivedKey);
    setLocalPreference(KEYS.credentialId, credential.credentialId);
    setLocalPreference(KEYS.salt, credential.salt);
    setLocalPreference(KEYS.encryptedKeys, encrypted);
    setLocalPreference(KEYS.enabled, 'true');
  },

  /**
   * Forget the passkey and the encrypted unlock key.
   */
  disable(): void {
    setLocalPreference(KEYS.enabled, 'false');
    removeLocalPreference(KEYS.credentialId);
    removeLocalPreference(KEYS.salt);
    removeLocalPreference(KEYS.encryptedKeys);
  },

  /**
   * Decrypt the unlock key with the passkey, check it opens the key chain and put it in the session.
   */
  async unlock(): Promise<void> {
    const credentialId = getLocalPreference(KEYS.credentialId);
    const salt = getLocalPreference(KEYS.salt);
    const encrypted = getLocalPreference(KEYS.encryptedKeys);
    if (!credentialId || !salt || !encrypted) {
      throw new Error('WebAuthn encrypted encryption key is not set or WebAuthn credential ID is not set.');
    }
    const derivedKey = await getCredentialDerivedKey(credentialId, salt);
    const payload = await EncryptionUtility.symmetricDecrypt(encrypted, derivedKey);
    let keys: WebAuthnSessionKeys | null = null;
    try {
      keys = JSON.parse(payload) as WebAuthnSessionKeys;
    } catch {
      keys = null;
    }

    // Check for legacy storage (pre-0.31.0).
    // TODO: this can be removed in a future release once 0.31.0 has been released.
    const isLegacyStore = typeof keys?.UnlockKey !== 'string';
    const unlockKey = keys && !isLegacyStore ? keys.UnlockKey : payload;
    try {
      await VaultKeyService.verifyUnlockKey(unlockKey);
    } catch (error) {
      // A key the chain rejects (password changed since) is discarded, the password unlock still works.
      if (error instanceof Error && extractErrorCode(error.message) === AppErrorCode.UNLOCK_KEY_REJECTED) {
        WebAuthnService.disable();
      }
      throw error;
    }
    if (isLegacyStore) {
      const upgraded: WebAuthnSessionKeys = { UnlockKey: unlockKey };
      setLocalPreference(KEYS.encryptedKeys, await EncryptionUtility.symmetricEncrypt(JSON.stringify(upgraded), derivedKey));
    }
    await getPlatform().storage.set(StorageKeys.UNLOCK_KEY, unlockKey);
  },
};
