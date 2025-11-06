/**
 * Background script entry point - handles messages from the content script
 */

import { onMessage, sendMessage } from "webext-bridge/background";

import { handleResetAutoLockTimer, handlePopupHeartbeat, handleSetAutoLockTimeout } from '@/entrypoints/background/AutolockTimeoutHandler';
import { handleClipboardCopied, handleCancelClipboardClear, handleGetClipboardClearTimeout, handleSetClipboardClearTimeout, handleGetClipboardCountdownState } from '@/entrypoints/background/ClipboardClearHandler';
import { setupContextMenus } from '@/entrypoints/background/ContextMenu';
import { handleGetWebAuthnSettings, handleWebAuthnCreate, handleWebAuthnGet, handlePasskeyPopupResponse, handleGetRequestData } from '@/entrypoints/background/PasskeyHandler';
import { handleOpenPopup, handlePopupWithCredential, handleOpenPopupCreateCredential, handleToggleContextMenu } from '@/entrypoints/background/PopupMessageHandler';
import { handleCheckAuthStatus, handleClearPersistedFormValues, handleClearVault, handleCreateIdentity, handleGetCredentials, handleGetDefaultEmailDomain, handleGetDefaultIdentitySettings, handleGetEncryptionKey, handleGetEncryptionKeyDerivationParams, handleGetPasswordSettings, handleGetPersistedFormValues, handleGetVault, handleLockVault, handlePersistFormValues, handleStoreEncryptionKey, handleStoreEncryptionKeyDerivationParams, handleStoreVault, handleSyncVault, handleUploadVault } from '@/entrypoints/background/VaultMessageHandler';

import { GLOBAL_CONTEXT_MENU_ENABLED_KEY } from '@/utils/Constants';
import { EncryptionKeyDerivationParams } from "@/utils/dist/shared/models/metadata";

import { defineBackground, storage, browser } from '#imports';

export default defineBackground({
  /**
   * This is the main entry point for the background script.
   */
  async main() {
    // Listen for messages using webext-bridge
    onMessage('CHECK_AUTH_STATUS', () => handleCheckAuthStatus());

    onMessage('GET_ENCRYPTION_KEY', () => handleGetEncryptionKey());
    onMessage('GET_ENCRYPTION_KEY_DERIVATION_PARAMS', () => handleGetEncryptionKeyDerivationParams());
    onMessage('GET_VAULT', () => handleGetVault());
    onMessage('GET_CREDENTIALS', () => handleGetCredentials());

    onMessage('GET_DEFAULT_EMAIL_DOMAIN', () => handleGetDefaultEmailDomain());
    onMessage('GET_DEFAULT_IDENTITY_SETTINGS', () => handleGetDefaultIdentitySettings());
    onMessage('GET_PASSWORD_SETTINGS', () => handleGetPasswordSettings());

    onMessage('STORE_VAULT', ({ data }) => handleStoreVault(data));
    onMessage('STORE_ENCRYPTION_KEY', ({ data }) => handleStoreEncryptionKey(data as string));
    onMessage('STORE_ENCRYPTION_KEY_DERIVATION_PARAMS', ({ data }) => handleStoreEncryptionKeyDerivationParams(data as EncryptionKeyDerivationParams));

    onMessage('CREATE_IDENTITY', ({ data }) => handleCreateIdentity(data));
    onMessage('UPLOAD_VAULT', ({ data }) => handleUploadVault(data));
    onMessage('SYNC_VAULT', () => handleSyncVault());

    onMessage('LOCK_VAULT', () => handleLockVault());
    onMessage('CLEAR_VAULT', () => handleClearVault());

    onMessage('OPEN_POPUP', () => handleOpenPopup());
    onMessage('OPEN_POPUP_WITH_CREDENTIAL', ({ data }) => handlePopupWithCredential(data));
    onMessage('OPEN_POPUP_CREATE_CREDENTIAL', ({ data }) => handleOpenPopupCreateCredential(data));
    onMessage('TOGGLE_CONTEXT_MENU', ({ data }) => handleToggleContextMenu(data));

    onMessage('PERSIST_FORM_VALUES', ({ data }) => handlePersistFormValues(data));
    onMessage('GET_PERSISTED_FORM_VALUES', () => handleGetPersistedFormValues());
    onMessage('CLEAR_PERSISTED_FORM_VALUES', () => handleClearPersistedFormValues());

    // Clipboard management messages
    onMessage('CLIPBOARD_COPIED', () => handleClipboardCopied());
    onMessage('CANCEL_CLIPBOARD_CLEAR', () => handleCancelClipboardClear());
    onMessage('GET_CLIPBOARD_CLEAR_TIMEOUT', () => handleGetClipboardClearTimeout());
    onMessage('SET_CLIPBOARD_CLEAR_TIMEOUT', ({ data }) => handleSetClipboardClearTimeout(data as number));
    onMessage('GET_CLIPBOARD_COUNTDOWN_STATE', () => handleGetClipboardCountdownState());

    // Auto-lock management messages
    onMessage('RESET_AUTO_LOCK_TIMER', () => handleResetAutoLockTimer());
    onMessage('SET_AUTO_LOCK_TIMEOUT', ({ data }) => handleSetAutoLockTimeout(data as number));
    onMessage('POPUP_HEARTBEAT', () => handlePopupHeartbeat());

    // Handle clipboard copied from context menu
    onMessage('CLIPBOARD_COPIED_FROM_CONTEXT', () => handleClipboardCopied());

    // Passkey/WebAuthn management messages
    onMessage('GET_WEBAUTHN_SETTINGS', ({ data }) => handleGetWebAuthnSettings(data));
    onMessage('WEBAUTHN_CREATE', ({ data }) => handleWebAuthnCreate(data));
    onMessage('WEBAUTHN_GET', ({ data }) => handleWebAuthnGet(data));
    onMessage('PASSKEY_POPUP_RESPONSE', ({ data }) => handlePasskeyPopupResponse(data));
    onMessage('GET_REQUEST_DATA', ({ data }) => handleGetRequestData(data));

    // Setup context menus
    const isContextMenuEnabled = await storage.getItem(GLOBAL_CONTEXT_MENU_ENABLED_KEY) ?? true;
    if (isContextMenuEnabled) {
      await setupContextMenus();
    }

    // Listen for custom commands
    try {
      browser.commands.onCommand.addListener(async (command) => {
        if (command === "show-autofill-popup") {
          // Get the currently active tab
          const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id) {
            return;
          }

          // Execute script in the active tab
          await browser.scripting.executeScript({
            target: { tabId: tab.id },
            func: getActiveElementIdentifier,
          }).then((results) => {
            const elementIdentifier = results[0]?.result;
            if (elementIdentifier) {
              sendMessage('OPEN_AUTOFILL_POPUP', { elementIdentifier }, `content-script@${tab.id}`);
            }
          }).catch(console.error);
        }
      });
    } catch (error) {
      console.error('Error setting up command listener:', error);
    }
  }
});

/**
 * Activate AliasVault for the active input element.
 */
function getActiveElementIdentifier() : string {
  const target = document.activeElement;
  if (target instanceof HTMLInputElement) {
    return target.id || target.name || '';
  }
  return '';
}
