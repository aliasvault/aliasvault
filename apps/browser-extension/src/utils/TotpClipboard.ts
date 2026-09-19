import { LocalPreferencesService } from '@/utils/LocalPreferencesService';
import { sendMessage } from '@/utils/messaging/ExtensionMessaging';

import type { ItemRef } from '@aliasvault/client/database/ItemRef';

/**
 * Copy an item's current TOTP code to the clipboard (only when the user has the copy-on-fill
 * setting enabled, which is the default).
 *
 * @param item - The item being filled, named by its manifest and id.
 */
export async function copyTotpToClipboardIfEnabled(item: ItemRef): Promise<void> {
  try {
    if (!await LocalPreferencesService.getAutoCopyTotpOnAutofill()) {
      return;
    }

    // Generate TOTP code via background
    const response = await sendMessage('GENERATE_TOTP_CODE', { itemId: item.Id, manifestId: item.ManifestId });

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
