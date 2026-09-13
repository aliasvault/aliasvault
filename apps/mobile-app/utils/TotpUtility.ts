import { normalizeTotpAlgorithm, normalizeTotpDigits, normalizeTotpPeriod } from '@aliasvault/models/vault';

import type { TotpParameters } from '@aliasvault/client/items/TotpUtility';

import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * Generates the current TOTP code for the given secret key.
 *
 * Delegates to the platform-native TOTP generator (Swift on iOS, Kotlin on
 * Android) so the React Native layer, the iOS Autofill extension, and the
 * Android Autofill service all share one RFC 6238 implementation.
 *
 * @param secretKey - Base32-encoded TOTP secret
 * @param parameters - Stored algorithm/digits/period; each falls back to the RFC 6238 default when absent
 * @returns The current TOTP code, or empty string on error
 */
export async function generateTotpCode(secretKey: string, parameters?: TotpParameters): Promise<string> {
  try {
    const code = await NativeVaultManager.generateTotpCode(
      secretKey,
      normalizeTotpAlgorithm(parameters?.Algorithm),
      normalizeTotpDigits(parameters?.Digits),
      normalizeTotpPeriod(parameters?.Period)
    );
    return code ?? '';
  } catch (error) {
    console.error('Error generating TOTP code:', error);
    return '';
  }
}
