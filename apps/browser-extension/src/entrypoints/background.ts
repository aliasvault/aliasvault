/**
 * Background script entry point - handles messages from the content script
 */

import { handleResetAutoLockTimer, handlePopupHeartbeat, handleSetAutoLockTimeout, initializeAutoLockAlarm, handleAutoLockAlarm } from '@/entrypoints/background/AutolockTimeoutHandler';
import { handleClipboardCopied, handleCancelClipboardClear, handleGetClipboardClearTimeout, handleSetClipboardClearTimeout, handleGetClipboardCountdownState } from '@/entrypoints/background/ClipboardClearHandler';
import { setupContextMenus } from '@/entrypoints/background/ContextMenu';
import { handleGetWebAuthnSettings, handleWebAuthnCreate, handleWebAuthnGet, handlePasskeyPopupResponse, handleGetRequestData } from '@/entrypoints/background/PasskeyHandler';
import { handleOpenPopup, handlePopupWithItem, handleOpenPopupCreateCredential, handleToggleContextMenu } from '@/entrypoints/background/PopupMessageHandler';
import { handleStoreSavePromptState, handleGetSavePromptState, handleClearSavePromptState, handleStoreLastAutofilled, handleGetLastAutofilled, handleClearLastAutofilled } from '@/entrypoints/background/SavePromptStateHandler';
import { handleStoreTwoFactorState, handleGetTwoFactorState, handleClearTwoFactorState } from '@/entrypoints/background/TwoFactorStateHandler';
import { handleCheckAuthStatus, handleClearPersistedFormValues, handleClearSession, handleClearVaultData, handleLockVault, handleCreateItem, handleGetFilteredItems, handleGetSearchItems, handleGetDefaultEmailDomain, handleGetDefaultIdentitySettings, handleGetEncryptionKey, handleGetEncryptionKeyDerivationParams, handleGetPasswordSettings, handleGetPersistedFormValues, handleGetVault, handlePersistFormValues, handleStoreEncryptionKey, handleStoreEncryptionKeyDerivationParams, handleStoreVaultMetadata, handleSyncVault, handleUploadVault, handleGetEncryptedVault, handleStoreEncryptedVault, handleGetSyncState, handleMarkVaultClean, handleGetServerRevision, handleCheckSyncStatus, handleFullVaultSync, handleCheckLoginDuplicate, handleSaveLoginCredential, handleAddUrlToCredential, handleIsUrlLinkedToCredential, handleGetLoginSaveSettings, handleSetLoginSaveEnabled, handleGetItemsWithTotp, handleSearchItemsWithTotp, handleGetTotpSecrets, handleGenerateTotpCode, handleSetRecentlySelected, handleGetRecentlySelected } from '@/entrypoints/background/VaultMessageHandler';

import { LocalPreferencesService } from '@/utils/LocalPreferencesService';
import { onMessage, sendMessage } from "@/utils/messaging/ExtensionMessaging";
import { validateWebAuthnRequest } from '@/utils/passkey/WebAuthnRequestValidation';

import { defineBackground, browser } from '#imports';

type WebAuthnMessageSender = {
  origin?: string;
  url?: string;
  tab?: {
    url?: string;
  };
};

type TrustedWebAuthnSenderContext = {
  origin: string;
  host: string;
};

function getTrustedWebAuthnSenderContext(sender: WebAuthnMessageSender): TrustedWebAuthnSenderContext | null {
  const senderOrigin = typeof sender.origin === 'string' && sender.origin !== 'null'
    ? sender.origin
    : undefined;
  const senderUrl = senderOrigin ?? sender.url ?? sender.tab?.url;

  if (!senderUrl) {
    return null;
  }

  try {
    const url = new URL(senderUrl);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) {
      return null;
    }

    return {
      origin: url.origin,
      host: url.hostname,
    };
  } catch {
    return null;
  }
}

function handleValidatedWebAuthnCreate(data: any, sender: WebAuthnMessageSender): Promise<any> | { fallback: true } {
  const senderContext = getTrustedWebAuthnSenderContext(sender);
  if (!senderContext || !validateWebAuthnRequest('create', data, senderContext.origin, senderContext.host)) {
    return { fallback: true };
  }

  return handleWebAuthnCreate({
    ...data,
    origin: senderContext.origin,
  });
}

function handleValidatedWebAuthnGet(data: any, sender: WebAuthnMessageSender): Promise<any> | { fallback: true } {
  const senderContext = getTrustedWebAuthnSenderContext(sender);
  if (!senderContext || !validateWebAuthnRequest('get', data, senderContext.origin, senderContext.host)) {
    return { fallback: true };
  }

  return handleWebAuthnGet({
    ...data,
    origin: senderContext.origin,
  });
}

/*
 * Register alarm listener at top-level scope.
 * [..] Move the event listener registration to the top level of your script.
 * This ensures that Chrome will be able to immediately find and invoke your action's click handler,
 * even if your extension hasn't finished executing its startup logic. [..]
 * See: https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers
 */
browser.alarms.onAlarm.addListener(handleAutoLockAlarm);

export default defineBackground({
  /**
   * This is the main entry point for the background script.
   *
   * IMPORTANT: This function MUST remain synchronous (no async/await directly in
   * the body). MV3 service workers can be terminated when idle and woken up by
   * events; only listeners registered synchronously during script evaluation are
   * guaranteed to be ready when the next event fires. Any asynchronous setup must
   * run as a fire-and-forget IIFE so this function returns synchronously.
   */
  main() {
    /*
     * Register any synchronous event listeners first, before any await, 
     * so they're attached synchronously on service-worker wake-up.
     */
    browser.commands.onCommand.addListener(async (command) => {
      if (command !== "show-autofill-popup") {
        return;
      }
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
          return;
        }

        const results = await browser.scripting.executeScript({
          target: { tabId: tab.id },
          func: getActiveElementIdentifier,
        });
        const elementIdentifier = results[0]?.result;
        if (elementIdentifier) {
          sendMessage('OPEN_AUTOFILL_POPUP', { elementIdentifier }, tab.id);
        }
      } catch (error) {
        console.error('Error handling show-autofill-popup command:', error);
      }
    });

    // Listen for messages via @webext-core/messaging
    onMessage('CHECK_AUTH_STATUS', () => handleCheckAuthStatus());

    onMessage('GET_ENCRYPTION_KEY', () => handleGetEncryptionKey());
    onMessage('GET_ENCRYPTION_KEY_DERIVATION_PARAMS', () => handleGetEncryptionKeyDerivationParams());
    onMessage('GET_VAULT', () => handleGetVault());
    onMessage('GET_FILTERED_ITEMS', ({ data }) => handleGetFilteredItems(data));
    onMessage('GET_SEARCH_ITEMS', ({ data }) => handleGetSearchItems(data));

    onMessage('GET_DEFAULT_EMAIL_DOMAIN', () => handleGetDefaultEmailDomain());
    onMessage('GET_DEFAULT_IDENTITY_SETTINGS', () => handleGetDefaultIdentitySettings());
    onMessage('GET_PASSWORD_SETTINGS', () => handleGetPasswordSettings());

    onMessage('STORE_VAULT_METADATA', ({ data }) => handleStoreVaultMetadata(data));
    onMessage('STORE_ENCRYPTION_KEY', ({ data }) => handleStoreEncryptionKey(data));
    onMessage('STORE_ENCRYPTION_KEY_DERIVATION_PARAMS', ({ data }) => handleStoreEncryptionKeyDerivationParams(data));

    onMessage('GET_ENCRYPTED_VAULT', () => handleGetEncryptedVault());
    onMessage('STORE_ENCRYPTED_VAULT', ({ data }) => handleStoreEncryptedVault(data));
    onMessage('GET_SYNC_STATE', () => handleGetSyncState());
    onMessage('MARK_VAULT_CLEAN', ({ data }) => handleMarkVaultClean(data));
    onMessage('GET_SERVER_REVISION', () => handleGetServerRevision());

    onMessage('CREATE_ITEM', ({ data }) => handleCreateItem(data));
    onMessage('UPLOAD_VAULT', () => handleUploadVault());
    onMessage('SYNC_VAULT', () => handleSyncVault());
    onMessage('CHECK_SYNC_STATUS', () => handleCheckSyncStatus());
    onMessage('FULL_VAULT_SYNC', () => handleFullVaultSync());
    onMessage('LOCK_VAULT', () => handleLockVault());
    onMessage('CLEAR_SESSION', () => handleClearSession());
    onMessage('CLEAR_VAULT_DATA', () => handleClearVaultData());

    onMessage('OPEN_POPUP', () => handleOpenPopup());
    onMessage('OPEN_POPUP_WITH_ITEM', ({ data }) => handlePopupWithItem(data));
    onMessage('OPEN_POPUP_CREATE_CREDENTIAL', ({ data }) => handleOpenPopupCreateCredential(data));
    onMessage('TOGGLE_CONTEXT_MENU', ({ data }) => handleToggleContextMenu(data));

    onMessage('PERSIST_FORM_VALUES', ({ data }) => handlePersistFormValues(data));
    onMessage('GET_PERSISTED_FORM_VALUES', () => handleGetPersistedFormValues());
    onMessage('CLEAR_PERSISTED_FORM_VALUES', () => handleClearPersistedFormValues());

    // Remember login save messages
    onMessage('CHECK_LOGIN_DUPLICATE', ({ data }) => handleCheckLoginDuplicate(data));
    onMessage('SAVE_LOGIN_CREDENTIAL', ({ data }) => handleSaveLoginCredential(data));
    onMessage('ADD_URL_TO_CREDENTIAL', ({ data }) => handleAddUrlToCredential(data));
    onMessage('IS_URL_LINKED_TO_CREDENTIAL', ({ data }) => handleIsUrlLinkedToCredential(data));
    onMessage('GET_LOGIN_SAVE_SETTINGS', () => handleGetLoginSaveSettings());
    onMessage('SET_LOGIN_SAVE_ENABLED', ({ data }) => handleSetLoginSaveEnabled(data));

    // TOTP autofill messages
    onMessage('GET_ITEMS_WITH_TOTP', ({ data }) => handleGetItemsWithTotp(data));
    onMessage('SEARCH_ITEMS_WITH_TOTP', ({ data }) => handleSearchItemsWithTotp(data));
    onMessage('GET_TOTP_SECRETS', ({ data }) => handleGetTotpSecrets(data));
    onMessage('GENERATE_TOTP_CODE', ({ data }) => handleGenerateTotpCode(data));

    // Track recently selected items for autofill prioritization
    onMessage('SET_RECENTLY_SELECTED', ({ data }) => handleSetRecentlySelected(data));
    onMessage('GET_RECENTLY_SELECTED', ({ data }) => handleGetRecentlySelected(data));

    // Remember login save state (for surviving page navigation)
    onMessage('STORE_SAVE_PROMPT_STATE', ({ data, sender }) => handleStoreSavePromptState({ tabId: sender.tab!.id!, state: data }));
    onMessage('GET_SAVE_PROMPT_STATE', ({ sender }) => handleGetSavePromptState({ tabId: sender.tab!.id! }));
    onMessage('CLEAR_SAVE_PROMPT_STATE', ({ sender }) => handleClearSavePromptState({ tabId: sender.tab!.id! }));

    // Track last autofilled credential (for "Add URL to existing credential" prompt)
    onMessage('STORE_LAST_AUTOFILLED', ({ data, sender }) => handleStoreLastAutofilled({ tabId: sender.tab!.id!, credential: data }));
    onMessage('GET_LAST_AUTOFILLED', ({ data, sender }) => handleGetLastAutofilled({ tabId: sender.tab!.id!, ...data }));
    onMessage('CLEAR_LAST_AUTOFILLED', ({ sender }) => handleClearLastAutofilled({ tabId: sender.tab!.id! }));

    // Two-factor authentication state persistence
    onMessage('STORE_TWO_FACTOR_STATE', ({ data }) => handleStoreTwoFactorState(data));
    onMessage('GET_TWO_FACTOR_STATE', () => handleGetTwoFactorState());
    onMessage('CLEAR_TWO_FACTOR_STATE', () => handleClearTwoFactorState());

    // Clipboard management messages
    onMessage('CLIPBOARD_COPIED', () => handleClipboardCopied());
    onMessage('CANCEL_CLIPBOARD_CLEAR', () => handleCancelClipboardClear());
    onMessage('GET_CLIPBOARD_CLEAR_TIMEOUT', () => handleGetClipboardClearTimeout());
    onMessage('SET_CLIPBOARD_CLEAR_TIMEOUT', ({ data }) => handleSetClipboardClearTimeout(data));
    onMessage('GET_CLIPBOARD_COUNTDOWN_STATE', () => handleGetClipboardCountdownState());

    // Auto-lock management messages
    onMessage('RESET_AUTO_LOCK_TIMER', () => handleResetAutoLockTimer());
    onMessage('SET_AUTO_LOCK_TIMEOUT', ({ data }) => handleSetAutoLockTimeout(data));
    onMessage('POPUP_HEARTBEAT', () => handlePopupHeartbeat());

    // Handle clipboard copied from context menu
    onMessage('CLIPBOARD_COPIED_FROM_CONTEXT', () => handleClipboardCopied());

    // Passkey/WebAuthn management messages
    onMessage('GET_WEBAUTHN_SETTINGS', ({ data }) => handleGetWebAuthnSettings(data));
    onMessage('WEBAUTHN_CREATE', ({ data, sender }) => handleValidatedWebAuthnCreate(data, sender));
    onMessage('WEBAUTHN_GET', ({ data, sender }) => handleValidatedWebAuthnGet(data, sender));
    onMessage('PASSKEY_POPUP_RESPONSE', ({ data }) => handlePasskeyPopupResponse(data));
    onMessage('GET_REQUEST_DATA', ({ data }) => handleGetRequestData(data));

    /*
     * Async setup (context menus, alarm restoration) runs in a fire-and-forget
     * IIFE so main() returns synchronously. Listener registrations above are
     * already synchronous and complete before this runs.
     */
    (async () : Promise<void> => {
      try {
        const isContextMenuEnabled = await LocalPreferencesService.getGlobalContextMenuEnabled();
        if (isContextMenuEnabled) {
          await setupContextMenus();
        }
      } catch (error) {
        console.error('Error setting up context menus:', error);
      }

      try {
        /*
         * Initialize auto-lock alarm system.
         * This ensures the alarm is restored if the service worker was terminated.
         * Note: The alarm listener is registered at top-level scope (see above).
         */
        await initializeAutoLockAlarm();
      } catch (error) {
        console.error('Error initializing auto-lock alarm:', error);
      }
    })();
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
