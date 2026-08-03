import { LocalPreferencesService } from '@/utils/LocalPreferencesService';
import { sendMessage } from '@/utils/messaging/ExtensionMessaging';

/**
 * Copy an item's current TOTP code to the clipboard (only when the user has the copy-on-fill
 * setting enabled, which is the default).
 *
 * @param itemId - The ID of the item being filled.
 */
export async function copyTotpToClipboardIfEnabled(itemId: string): Promise<void> {
  try {
    if (!await LocalPreferencesService.getAutoCopyTotpOnAutofill()) {
      return;
    }

    // Generate TOTP code via background
    const response = await sendMessage('GENERATE_TOTP_CODE', { itemId });

    if (!response.success || !response.code) {
      return;
    }

    await navigator.clipboard.writeText(response.code);

    // Notify background script that clipboard was copied to start countdown
    sendMessage('CLIPBOARD_COPIED').catch(() => {
      // Ignore errors as background script might not be ready
    });
  } catch {
    // Silently fail if the TOTP code is not available.
  }
}
