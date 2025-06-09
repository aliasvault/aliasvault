import { onMessage, sendMessage } from "webext-bridge/background";

import { setupContextMenus } from '@/entrypoints/background/ContextMenu';
import { handleOpenPopup, handlePopupWithCredential, handleToggleContextMenu } from '@/entrypoints/background/PopupMessageHandler';
import { handleCheckAuthStatus, handleClearVault, handleCreateIdentity, handleGetCredentials, handleGetDefaultEmailDomain, handleGetDefaultIdentityLanguage, handleGetDerivedKey, handleGetPasswordSettings, handleGetVault, handleStoreVault, handleSyncVault, handleUploadVault } from '@/entrypoints/background/VaultMessageHandler';

import { GLOBAL_CONTEXT_MENU_ENABLED_KEY } from '@/utils/Constants';

import { defineBackground, storage, browser } from '#imports';

export default defineBackground({
  /**
   * This is the main entry point for the background script.
   */
  async main() {
    // Listen for messages using webext-bridge
    onMessage('CHECK_AUTH_STATUS', () => handleCheckAuthStatus());
    onMessage('STORE_VAULT', ({ data }) => handleStoreVault(data));
    onMessage('UPLOAD_VAULT', ({ data }) => handleUploadVault(data));
    onMessage('SYNC_VAULT', () => handleSyncVault());
    onMessage('GET_VAULT', () => handleGetVault());
    onMessage('CLEAR_VAULT', () => handleClearVault());
    onMessage('GET_CREDENTIALS', () => handleGetCredentials());
    onMessage('CREATE_IDENTITY', ({ data }) => handleCreateIdentity(data));
    onMessage('GET_DEFAULT_EMAIL_DOMAIN', () => handleGetDefaultEmailDomain());
    onMessage('GET_DEFAULT_IDENTITY_LANGUAGE', () => handleGetDefaultIdentityLanguage());
    onMessage('GET_PASSWORD_SETTINGS', () => handleGetPasswordSettings());
    onMessage('GET_DERIVED_KEY', () => handleGetDerivedKey());
    onMessage('OPEN_POPUP', () => handleOpenPopup());
    onMessage('OPEN_POPUP_WITH_CREDENTIAL', ({ data }) => handlePopupWithCredential(data));
    onMessage('TOGGLE_CONTEXT_MENU', ({ data }) => handleToggleContextMenu(data));

    // Setup context menus
    const isContextMenuEnabled = await storage.getItem(GLOBAL_CONTEXT_MENU_ENABLED_KEY) ?? true;
    if (isContextMenuEnabled) {
      setupContextMenus();
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