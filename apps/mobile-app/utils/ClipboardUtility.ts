import { Platform } from 'react-native';

import NativeVaultManager from '@/specs/NativeVaultManager';
import { LocalPreferencesService } from '@/services/LocalPreferencesService';
import { HapticsUtility } from '@/utils/HapticsUtility';

/**
 * Copy text to clipboard with automatic expiration based on platform capabilities.
 *
 * On iOS: Uses native clipboard expiration via UIPasteboard.setItems with expirationDate.
 *   When localOnly is true (default), prevents sync to Universal Clipboard/iCloud.
 *   The localOnly setting is read from user preferences (secure copy setting).
 * On Android: Uses native method that combines clipboard copy with automatic clearing:
 *   - Uses AlarmManager (works even when app is backgrounded)
 *   - Android 13+: Also marks clipboard content as sensitive
 *
 * @param text - The text to copy to clipboard
 * @param expirationSeconds - Number of seconds after which clipboard should be cleared (0 = no expiration)
 */
export async function copyToClipboardWithExpiration(
  text: string,
  expirationSeconds: number
): Promise<void> {
  // On iOS, read the local-only clipboard preference.
  // On Android, localOnly has no effect but we pass true as default.
  const localOnly = Platform.OS === 'ios'
    ? await LocalPreferencesService.getClipboardLocalOnly()
    : true;

  await NativeVaultManager.copyToClipboardWithExpiration(text, expirationSeconds, localOnly);

  HapticsUtility.impact();
}

/**
 * Copy text to clipboard without expiration.
 *
 * @param text - The text to copy to clipboard
 */
export async function copyToClipboard(text: string): Promise<void> {
  await copyToClipboardWithExpiration(text, 0);
}
