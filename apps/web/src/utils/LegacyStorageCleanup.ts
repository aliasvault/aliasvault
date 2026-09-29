import { LANGUAGE_CODES } from '@/i18n/config';
import { getLocalPreference, removeLocalPreference, setLocalPreference } from '@/utils/LocalPreferences';
import { LocalPreferenceKeys } from '@/utils/StorageKeys';

/**
 * localStorage keys only the previous (Blazor) web client wrote: its tokens, its cached key chain, debug keys and
 * its own language key. This app keeps its session in IndexedDB, so none of them is read any more.
 */
const LEGACY_ONLY_KEYS = [
  'token',
  'refreshToken',
  'encryptedAccountKey',
  'encryptedVek',
  'accountPublicKey',
  'encryptedAccountPrivateKey',
  'encryptionKeyDerivationParams',
  'debugSessionKeys',
  'encryptionTestString',
  'webAuthnCredentialDerivedKey',
  'blazorCulture',
];

/**
 * The value of a key the previous client stored JSON-encoded ('"nl"'), or null when it is not a JSON string.
 */
function jsonStringValue(raw: string | null): string | null {
  if (raw === null || !raw.startsWith('"')) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Remove what the previous web client left in localStorage on this origin, keeping the language it had chosen.
 * Safe to run on every start.
 * TODO: this file and calllers can be removed some time after 0.31.0 has been released, together with public/service-worker.js.
 */
export function cleanUpLegacyStorage(): void {
  /*
   * The previous client updated blazorCulture on every language change but its JSON-encoded AppLanguage only before
   * login, so blazorCulture is the more recent of the two.
   */
  const storedLanguage = getLocalPreference(LocalPreferenceKeys.APP_LANGUAGE);
  const legacyLanguage = getLocalPreference('blazorCulture') ?? jsonStringValue(storedLanguage);
  if (legacyLanguage !== null && LANGUAGE_CODES.includes(legacyLanguage)) {
    setLocalPreference(LocalPreferenceKeys.APP_LANGUAGE, legacyLanguage);
  } else if (jsonStringValue(storedLanguage) !== null) {
    removeLocalPreference(LocalPreferenceKeys.APP_LANGUAGE);
  }

  // The previous client stored the return URL JSON-encoded too, which this app would navigate to as a path.
  if (jsonStringValue(getLocalPreference(LocalPreferenceKeys.RETURN_URL)) !== null) {
    removeLocalPreference(LocalPreferenceKeys.RETURN_URL);
  }

  LEGACY_ONLY_KEYS.forEach(removeLocalPreference);
}
