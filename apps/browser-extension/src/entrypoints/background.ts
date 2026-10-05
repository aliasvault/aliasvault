/**
 * Background script entry point - handles messages from the content script
 */

import '@/platform/ClientServices';

import { broadcastVaultUnlocked, handleAwaitPendingAuth, handleLoginWithPassword, handleLoginWithTwoFactor, handleUnlockWithPassword, handleUnlockWithPin } from '@/entrypoints/background/AuthHandler';
import { handleResetAutoLockTimer, handlePopupHeartbeat, handleSetAutoLockTimeout, initializeAutoLockAlarm, handleAutoLockAlarm } from '@/entrypoints/background/AutolockTimeoutHandler';
import { handleClipboardCopied, handleSetClipboardClearTimeout, handleGetClipboardCountdownState } from '@/entrypoints/background/ClipboardClearHandler';
import { setupContextMenus } from '@/entrypoints/background/ContextMenu';
import { handleGetWebAuthnSettings, handleWebAuthnCreate, handleWebAuthnGet, handlePasskeyPopupResponse, handleGetRequestData, handleGetMatchingPasskeys, handleWebAuthnGetAssertion } from '@/entrypoints/background/PasskeyHandler';
import { handleOpenPopup, handlePopupWithItem, handleOpenPopupCreateCredential, handleToggleContextMenu } from '@/entrypoints/background/PopupMessageHandler';
import { handleStoreSavePromptState, handleGetSavePromptState, handleClearSavePromptState, handleStoreLastAutofilled, handleGetLastAutofilled, handleClearLastAutofilled } from '@/entrypoints/background/SavePromptStateHandler';
import { handleGetTwoFactorPrompt, handleClearTwoFactorState } from '@/entrypoints/background/TwoFactorStateHandler';
import { handleCheckAuthStatus, handleClearPersistedFormValues, handleClearSession, handleClearVaultData, handleLockVault, handleGetFilteredItems, handleGetSearchItems, handleGetEncryptionKey, handleGetUnlockKeyDerivationParams, handleGetPersistedFormValues, handleGetVaultMigrationStatus, handlePersistFormValues, handleStoreAccountKey, handleStoreUnlockKeyDerivationParams, handleStoreEncryptedVaultChunk, handleGetSyncState, handleMigrateVaultManifest, handleFullVaultSync, handleGroupCreateVault, handleGroupInviteMember, handleGroupUpdateVault, handleGroupRevokeAccess, handleCheckLoginDuplicate, handleSaveLoginCredential, handleAddUrlToCredential, handleIsUrlLinkedToCredential, handleGetLoginSaveSettings, handleGetItemsWithTotp, handleSearchItemsWithTotp, handleGetTotpSecrets, handleGenerateTotpCode, handleSetRecentlySelected, handleRecordItemUsage } from '@/entrypoints/background/VaultMessageHandler';

import { logFailure } from '@/utils/Diagnostics';
import { LocalPreferencesService } from '@/utils/LocalPreferencesService';
import { onMessage, sendMessage } from "@/utils/messaging/ExtensionMessaging";
import type { IExtensionMessageProtocol } from "@/utils/messaging/ExtensionMessaging";
import { isRpIdAllowedForCaller } from '@/utils/passkey/RelyingPartyValidation';
import type { MatchingPasskeysResponse, WebAuthnAssertionResponse, WebAuthnPublicKeyGetPayload } from '@/utils/passkey/types';
import { getWebAuthnRequestRpId, validateWebAuthnRequest } from '@/utils/passkey/WebAuthnRequestValidation';
import type { WebAuthnBridgeRequest } from '@/utils/passkey/WebAuthnRequestValidation';

import { runStartupMigrations } from '@/migrations';

import type { ExtensionMessage, GetReturnType, MaybePromise, Message } from '@webext-core/messaging';

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

/**
 * Resolve a trusted origin and host context from the message sender, returning null when the
 * sender is not a secure (https or localhost) web origin.
 */
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

/**
 * Resolve a trusted sender context and run a per-message validation check before invoking the
 * handler. Returns `onInvalid` when the sender is not a trusted web origin or validation fails,
 * so each WebAuthn message keeps its own validation rule and fallback shape while sharing the
 * trust resolution and guard plumbing.
 */
async function withTrustedWebAuthnSender<T, U>(
  sender: WebAuthnMessageSender,
  validate: (context: TrustedWebAuthnSenderContext) => MaybePromise<boolean>,
  handle: (context: TrustedWebAuthnSenderContext) => T,
  onInvalid: U
): Promise<Awaited<T> | U> {
  const senderContext = getTrustedWebAuthnSenderContext(sender);
  if (!senderContext || !(await validate(senderContext))) {
    return onInvalid;
  }

  return await handle(senderContext);
}

/**
 * Validate a WebAuthn request and check that the sender may use the RP ID it names.
 */
async function isValidWebAuthnRequest(type: 'create' | 'get', request: WebAuthnBridgeRequest, context: TrustedWebAuthnSenderContext): Promise<boolean> {
  if (!validateWebAuthnRequest(type, request, context.origin)) {
    return false;
  }

  const rpId = getWebAuthnRequestRpId(type, request);
  return rpId === undefined || (typeof rpId === 'string' && await isRpIdAllowedForCaller(rpId, context.origin, context.host));
}

/**
 * True when the message comes from one of the extension's own pages (popup, expanded tab, passkey window),
 * false for content scripts running inside web pages. Sensitive operations must never be serviceable from a content-script context.
 */
function isTrustedExtensionSender(sender: WebAuthnMessageSender): boolean {
  const senderOrigin = typeof sender.origin === 'string' && sender.origin !== 'null' ? sender.origin : undefined;
  const senderUrl = senderOrigin ?? sender.url ?? sender.tab?.url;
  if (!senderUrl) {
    return false;
  }

  try {
    return new URL(senderUrl).origin === new URL(browser.runtime.getURL('')).origin;
  } catch {
    return false;
  }
}

/**
 * Register a handler that only the extension's own pages may call; a message from a content script is rejected.
 */
function onExtensionPageMessage<TType extends keyof IExtensionMessageProtocol>(
  type: TType,
  handler: (message: Message<IExtensionMessageProtocol, TType> & ExtensionMessage) => MaybePromise<GetReturnType<IExtensionMessageProtocol[TType]>>
): void {
  onMessage(type, (message) => {
    if (!isTrustedExtensionSender(message.sender)) {
      throw new Error(`${type} is only available to extension pages`);
    }
    return handler(message);
  });
}

/**
 * Validate a WebAuthn create request against the sender's trusted origin, then forward it to the
 * passkey create flow. Falls back when the sender is untrusted or validation fails.
 */
function handleValidatedWebAuthnCreate(data: WebAuthnBridgeRequest, sender: WebAuthnMessageSender): Promise<unknown> {
  return withTrustedWebAuthnSender(
    sender,
    (ctx) => isValidWebAuthnRequest('create', data, ctx),
    (ctx) => handleWebAuthnCreate({ ...data, origin: ctx.origin }),
    { fallback: true }
  );
}

/**
 * Validate a WebAuthn get request against the sender's trusted origin, then forward it to the
 * passkey get flow. Falls back when the sender is untrusted or validation fails.
 */
function handleValidatedWebAuthnGet(data: WebAuthnBridgeRequest, sender: WebAuthnMessageSender): Promise<unknown> {
  return withTrustedWebAuthnSender(
    sender,
    (ctx) => isValidWebAuthnRequest('get', data, ctx),
    (ctx) => handleWebAuthnGet({ ...data, origin: ctx.origin }),
    { fallback: true }
  );
}

/**
 * Validate a request for the passkeys stored at an rpId against the sender's trusted host, then
 * return the matching passkeys for the inline conditional-autofill dropdown. This only exposes
 * passkeys for an rpId the requesting page is allowed to assert for.
 */
function handleValidatedGetMatchingPasskeys(
  data: { rpId: string; allowCredentialIds?: string[] },
  sender: WebAuthnMessageSender
): Promise<MatchingPasskeysResponse> {
  return withTrustedWebAuthnSender(
    sender,
    async (ctx) => typeof data?.rpId === 'string' && await isRpIdAllowedForCaller(data.rpId, ctx.origin, ctx.host),
    () => handleGetMatchingPasskeys(data),
    { success: false, locked: false, passkeys: [] }
  );
}

/**
 * Validate an inline passkey assertion request against the sender's trusted origin, then sign.
 * The trusted origin is embedded in the signed client data.
 */
function handleValidatedWebAuthnGetAssertion(
  data: { passkeyId: string; manifestId: string; origin: string; publicKey: WebAuthnPublicKeyGetPayload },
  sender: WebAuthnMessageSender
): Promise<WebAuthnAssertionResponse> {
  return withTrustedWebAuthnSender(
    sender,
    async (ctx) => typeof data?.passkeyId === 'string' && typeof data?.manifestId === 'string' && await isValidWebAuthnRequest('get', data, ctx),
    (ctx) => handleWebAuthnGetAssertion({ ...data, origin: ctx.origin }),
    { success: false, error: 'Invalid request' }
  );
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
        logFailure('Error handling show-autofill-popup command', error);
      }
    });

    /*
     * Listen for messages via @webext-core/messaging.
     */
    onMessage('CHECK_AUTH_STATUS', () => handleCheckAuthStatus());

    onExtensionPageMessage('GET_ENCRYPTION_KEY', () => handleGetEncryptionKey());
    onExtensionPageMessage('GET_UNLOCK_KEY_DERIVATION_PARAMS', () => handleGetUnlockKeyDerivationParams());
    onMessage('GET_FILTERED_ITEMS', ({ data }) => handleGetFilteredItems(data));
    onMessage('GET_SEARCH_ITEMS', ({ data }) => handleGetSearchItems(data));

    onExtensionPageMessage('STORE_ACCOUNT_KEY', async ({ data }) => {
      const result = await handleStoreAccountKey(data);
      /*
       * Storing the Account Key means the vault just became unlocked; let content scripts
       * re-query any conditional passkey requests they parked while the vault was locked.
       */
      if (result.success) {
        void broadcastVaultUnlocked();
      }
      return result;
    });
    onExtensionPageMessage('STORE_UNLOCK_KEY_DERIVATION_PARAMS', ({ data }) => handleStoreUnlockKeyDerivationParams(data));

    // Login and unlock run in the background so they complete when the popup closes mid-flow.
    onExtensionPageMessage('AUTH_LOGIN', ({ data }) => handleLoginWithPassword(data));
    onExtensionPageMessage('AUTH_LOGIN_TWO_FACTOR', ({ data }) => handleLoginWithTwoFactor(data));
    onExtensionPageMessage('AUTH_UNLOCK_PASSWORD', ({ data }) => handleUnlockWithPassword(data));
    onExtensionPageMessage('AUTH_UNLOCK_PIN', ({ data }) => handleUnlockWithPin(data));
    onExtensionPageMessage('AUTH_AWAIT_PENDING', () => handleAwaitPendingAuth());

    onExtensionPageMessage('STORE_ENCRYPTED_VAULT', ({ data }) => handleStoreEncryptedVaultChunk(data));
    onExtensionPageMessage('GET_SYNC_STATE', () => handleGetSyncState());

    onExtensionPageMessage('FULL_VAULT_SYNC', ({ data }) => handleFullVaultSync(data));
    onExtensionPageMessage('START_VAULT_SYNC', () => {
      void handleFullVaultSync().catch(error => logFailure('Background vault sync failed', error));
      return { success: true };
    });
    onExtensionPageMessage('GET_VAULT_MIGRATION_STATUS', () => handleGetVaultMigrationStatus());
    onExtensionPageMessage('MIGRATE_VAULT_MANIFEST', () => handleMigrateVaultManifest());
    onExtensionPageMessage('GROUP_CREATE_VAULT', ({ data }) => handleGroupCreateVault(data));
    onExtensionPageMessage('GROUP_UPDATE_VAULT', ({ data }) => handleGroupUpdateVault(data));
    onExtensionPageMessage('GROUP_INVITE_MEMBER', ({ data }) => handleGroupInviteMember(data));
    onExtensionPageMessage('GROUP_REVOKE_ACCESS', ({ data }) => handleGroupRevokeAccess(data));
    onExtensionPageMessage('LOCK_VAULT', () => handleLockVault());
    onExtensionPageMessage('CLEAR_SESSION', () => handleClearSession());
    onExtensionPageMessage('CLEAR_VAULT_DATA', () => handleClearVaultData());

    onMessage('OPEN_POPUP', () => handleOpenPopup());
    onMessage('OPEN_POPUP_WITH_ITEM', ({ data }) => handlePopupWithItem(data));
    onMessage('OPEN_POPUP_CREATE_CREDENTIAL', ({ data, sender }) => handleOpenPopupCreateCredential(data, sender));
    onExtensionPageMessage('TOGGLE_CONTEXT_MENU', ({ data }) => handleToggleContextMenu(data));

    onExtensionPageMessage('PERSIST_FORM_VALUES', ({ data }) => handlePersistFormValues(data));
    onExtensionPageMessage('GET_PERSISTED_FORM_VALUES', () => handleGetPersistedFormValues());
    onExtensionPageMessage('CLEAR_PERSISTED_FORM_VALUES', () => handleClearPersistedFormValues());

    // Remember login save messages
    onMessage('CHECK_LOGIN_DUPLICATE', ({ data }) => handleCheckLoginDuplicate(data));
    onMessage('SAVE_LOGIN_CREDENTIAL', ({ data }) => handleSaveLoginCredential(data));
    onMessage('ADD_URL_TO_CREDENTIAL', ({ data }) => handleAddUrlToCredential(data));
    onMessage('IS_URL_LINKED_TO_CREDENTIAL', ({ data }) => handleIsUrlLinkedToCredential(data));
    onMessage('GET_LOGIN_SAVE_SETTINGS', () => handleGetLoginSaveSettings());

    // TOTP autofill messages
    onMessage('GET_ITEMS_WITH_TOTP', ({ data }) => handleGetItemsWithTotp(data));
    onMessage('SEARCH_ITEMS_WITH_TOTP', ({ data }) => handleSearchItemsWithTotp(data));
    onMessage('GET_TOTP_SECRETS', ({ data }) => handleGetTotpSecrets(data));
    onMessage('GENERATE_TOTP_CODE', ({ data }) => handleGenerateTotpCode(data));

    // Record item usage (last used + counts) into the Stats data bucket
    onMessage('RECORD_ITEM_USAGE', ({ data }) => handleRecordItemUsage(data));

    // Track recently selected items for autofill prioritization
    onMessage('SET_RECENTLY_SELECTED', ({ data }) => handleSetRecentlySelected(data));

    // Remember login save state (for surviving page navigation)
    onMessage('STORE_SAVE_PROMPT_STATE', ({ data, sender }) => handleStoreSavePromptState({ tabId: sender.tab!.id!, state: data }));
    onMessage('GET_SAVE_PROMPT_STATE', ({ data, sender }) => handleGetSavePromptState({ tabId: sender.tab!.id!, ...data }));
    onMessage('CLEAR_SAVE_PROMPT_STATE', ({ sender }) => handleClearSavePromptState({ tabId: sender.tab!.id! }));

    // Track last autofilled credential (for "Add URL to existing credential" prompt)
    onMessage('STORE_LAST_AUTOFILLED', ({ data, sender }) => handleStoreLastAutofilled({ tabId: sender.tab!.id!, credential: data }));
    onMessage('GET_LAST_AUTOFILLED', ({ data, sender }) => handleGetLastAutofilled({ tabId: sender.tab!.id!, ...data }));
    onMessage('CLEAR_LAST_AUTOFILLED', ({ sender }) => handleClearLastAutofilled({ tabId: sender.tab!.id! }));

    // Two-factor authentication state persistence
    onExtensionPageMessage('GET_TWO_FACTOR_STATE', () => handleGetTwoFactorPrompt());
    onExtensionPageMessage('CLEAR_TWO_FACTOR_STATE', () => handleClearTwoFactorState());

    // Clipboard management messages
    onMessage('CLIPBOARD_COPIED', () => handleClipboardCopied());
    onExtensionPageMessage('SET_CLIPBOARD_CLEAR_TIMEOUT', ({ data }) => handleSetClipboardClearTimeout(data));
    onExtensionPageMessage('GET_CLIPBOARD_COUNTDOWN_STATE', () => handleGetClipboardCountdownState());

    // Auto-lock management messages
    onMessage('RESET_AUTO_LOCK_TIMER', () => handleResetAutoLockTimer());
    onExtensionPageMessage('SET_AUTO_LOCK_TIMEOUT', ({ data }) => handleSetAutoLockTimeout(data));
    onExtensionPageMessage('POPUP_HEARTBEAT', () => handlePopupHeartbeat());

    // Passkey/WebAuthn settings
    onMessage('GET_WEBAUTHN_SETTINGS', ({ data }) => handleGetWebAuthnSettings(data));

    // WebAuthn ceremony bridge (navigator.credentials.create/get interception)
    onMessage('WEBAUTHN_CREATE', ({ data, sender }) => handleValidatedWebAuthnCreate(data, sender));
    onMessage('WEBAUTHN_GET', ({ data, sender }) => handleValidatedWebAuthnGet(data, sender));
    onMessage('WEBAUTHN_GET_ASSERTION', ({ data, sender }) => handleValidatedWebAuthnGetAssertion(data, sender));

    // Inline conditional passkey autofill
    onMessage('GET_MATCHING_PASSKEYS', ({ data, sender }) => handleValidatedGetMatchingPasskeys(data, sender));

    // Passkey popup request/response flow
    onExtensionPageMessage('GET_REQUEST_DATA', ({ data }) => handleGetRequestData(data));
    onExtensionPageMessage('PASSKEY_POPUP_RESPONSE', ({ data }) => handlePasskeyPopupResponse(data));

    /*
     * Async setup (context menus, alarm restoration) runs in a fire-and-forget
     * IIFE so main() returns synchronously. Listener registrations above are
     * already synchronous and complete before this runs.
     */
    (async () : Promise<void> => {
      try {
        /*
         * Run one-time startup migrations.
         */
        await runStartupMigrations();
      } catch (error) {
        logFailure('Error running startup migrations', error);
      }

      try {
        const isContextMenuEnabled = await LocalPreferencesService.getGlobalContextMenuEnabled();
        if (isContextMenuEnabled) {
          await setupContextMenus();
        }
      } catch (error) {
        logFailure('Error setting up context menus', error);
      }

      try {
        /*
         * Initialize auto-lock alarm system.
         * This ensures the alarm is restored if the service worker was terminated.
         * Note: The alarm listener is registered at top-level scope (see above).
         */
        await initializeAutoLockAlarm();
      } catch (error) {
        logFailure('Error initializing auto-lock alarm', error);
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
