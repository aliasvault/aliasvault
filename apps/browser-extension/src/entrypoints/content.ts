/**
 * Content script entry point - handles autofill UI, login detection, and WebAuthn passkey interception
 */

import '@/entrypoints/contentScript/style.css';
import { CONDITIONAL_PASSKEYS_UPDATED_EVENT, hasPendingConditionalRequest, refreshConditionalPasskeyOptions } from '@/entrypoints/contentScript/ConditionalPasskey';
import { fillItem, injectIcon, popupDebounceTimeHasPassed, validateInputField } from '@/entrypoints/contentScript/Form';
import { getLastAutofillInput, openAutofillPopup, openTotpPopup, removeExistingPopup, createUpgradeRequiredPopup } from '@/entrypoints/contentScript/Popup';
import { showSavePrompt, showAddUrlPrompt, isSavePromptVisible, updateSavePromptLogin, getPersistedSavePromptState, restoreSavePromptFromState, restoreAddUrlPromptFromState } from '@/entrypoints/contentScript/SavePrompt';
import { initializeWebAuthnInterceptor } from '@/entrypoints/contentScript/WebAuthnInterceptor';

import { isAvAutofillAllowed, isAvSuppressSave } from '@/utils/autofill/Autofill';
import { DEFAULT_POPUP_TYPE, isPopupType, popupTypeForFieldType, POPUP_TYPES, type PopupType } from '@/utils/autofill/PopupTypes';
import { devLog } from '@/utils/devLogger/DevLogger';
import type { Item } from '@/utils/dist/core/models/vault';
import { FormDetector } from '@/utils/formDetector/FormDetector';
import { LocalPreferencesService } from '@/utils/LocalPreferencesService';
import { LoginDetector } from '@/utils/loginDetector';
import type { CapturedLogin } from '@/utils/loginDetector';
import { onMessage, sendMessage } from '@/utils/messaging/ExtensionMessaging';

import { t } from '@/i18n/StandaloneI18n';

import { defineContentScript, createShadowRootUi, storage } from '#imports';

/** Global login detector instance */
let loginDetector: LoginDetector | null = null;

/**
 * Content-side runtime for each popup type: how to open the popup and whether
 * its feature toggle is enabled. Keyed by the shared {@link PopupType} so the
 * compiler enforces that every popup type has an opener + toggle wired up.
 *
 * Add a new entry here when adding a new popup type to {@link POPUP_TYPES}.
 */
const POPUP_RUNTIME: Record<PopupType, {
  open: (input: HTMLInputElement, container: HTMLElement) => void;
  enabled: () => Promise<boolean>;
  /** Background message used to ask whether any stored entry would fill this field type. */
  matchMessage: 'GET_FILTERED_ITEMS' | 'GET_ITEMS_WITH_TOTP';
}> = {
  credentials: {
    open: openAutofillPopup,
    /** Resolves true when the user has the credential autofill popup enabled. */
    enabled: () => LocalPreferencesService.getGlobalAutofillPopupEnabled(),
    matchMessage: 'GET_FILTERED_ITEMS',
  },
  totp: {
    open: openTotpPopup,
    /** Resolves true when the user has the TOTP autofill popup enabled. */
    enabled: () => LocalPreferencesService.getTotpAutofillEnabled(),
    matchMessage: 'GET_ITEMS_WITH_TOTP',
  },
};

/**
 * Handle save login request from the save prompt.
 * Sends the captured credentials to the background script to save to the vault.
 * @param login - The captured login credentials.
 * @param serviceName - The user-specified service name.
 */
async function handleSaveLogin(login: CapturedLogin, serviceName: string): Promise<void> {
  try {
    const response = await sendMessage('SAVE_LOGIN_CREDENTIAL', {
      serviceName,
      username: login.username,
      password: login.password,
      url: login.url,
      domain: login.domain,
      faviconUrl: login.faviconUrl,
    });

    if (!response.success) {
      console.error('[AliasVault] Failed to save login:', response.error);
    }

    // Clear the last autofilled state after save
    await sendMessage('CLEAR_LAST_AUTOFILLED');
  } catch (error) {
    console.error('[AliasVault] Error saving login:', error);
  }
}

/**
 * Handle "never save for this domain" request from the save prompt.
 * @param domain - The domain to block from future save prompts.
 */
async function handleNeverSaveForDomain(domain: string): Promise<void> {
  // Store the blocked domain in local storage
  try {
    const blockedDomains = await storage.getItem('local:loginSaveBlockedDomains') as string[] ?? [];
    if (!blockedDomains.includes(domain)) {
      blockedDomains.push(domain);
      await storage.setItem('local:loginSaveBlockedDomains', blockedDomains);
    }
  } catch (error) {
    console.error('[AliasVault] Error saving blocked domain:', error);
  }
}

/**
 * Handle save prompt dismissal.
 */
async function handleSavePromptDismiss(): Promise<void> {
  // Clear the last autofilled state on dismiss
  await sendMessage('CLEAR_LAST_AUTOFILLED');
}

/**
 * Handle adding URL to an existing credential.
 * @param itemId - The ID of the credential to add the URL to.
 * @param url - The URL to add.
 */
async function handleAddUrlToCredential(itemId: string, url: string): Promise<void> {
  try {
    const response = await sendMessage('ADD_URL_TO_CREDENTIAL', {
      itemId,
      url,
    });

    if (!response.success) {
      console.error('[AliasVault] Failed to add URL to credential:', response.error);
    }

    // Clear the last autofilled state after successful add
    await sendMessage('CLEAR_LAST_AUTOFILLED');
  } catch (error) {
    console.error('[AliasVault] Error adding URL to credential:', error);
  }
}

/**
 * Check if the login save feature is enabled.
 * @returns Whether the feature is enabled.
 */
async function isLoginSaveEnabled(): Promise<boolean> {
  try {
    const response = await sendMessage('GET_LOGIN_SAVE_SETTINGS');
    return response.success && response.enabled;
  } catch {
    return false;
  }
}

/**
 * Check if the domain is blocked from save prompts.
 * @param domain - The domain to check.
 * @returns Whether the domain is blocked.
 */
async function isDomainBlocked(domain: string): Promise<boolean> {
  try {
    const blockedDomains = await storage.getItem('local:loginSaveBlockedDomains') as string[] ?? [];
    return blockedDomains.includes(domain);
  } catch {
    return false;
  }
}

/**
 * Check if the login already exists in the vault.
 * @param domain - The domain of the login.
 * @param username - The username of the login.
 * @returns Whether a duplicate exists.
 */
async function isLoginDuplicate(domain: string, username: string): Promise<boolean> {
  try {
    const response = await sendMessage('CHECK_LOGIN_DUPLICATE', {
      domain,
      username,
    });
    return response.success && response.isDuplicate;
  } catch {
    return false;
  }
}

/** Track if we've already restored the save prompt early */
let earlyRestoreCompleted = false;

/**
 * Check for and restore a persisted save prompt immediately on page load.
 * Creates a temporary shadow root UI if the body is available.
 * @param ctx - The content script context.
 */
async function checkAndRestoreSavePromptEarly(ctx: Parameters<typeof createShadowRootUi>[0]): Promise<void> {
  try {
    // First check if there's even state to restore (fast check)
    const persistedState = await getPersistedSavePromptState();
    if (!persistedState) {
      return;
    }

    // Wait for body to be available (poll quickly)
    let attempts = 0;
    while (!document.body && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 10));
      attempts++;
    }

    if (!document.body || ctx.isInvalid) {
      return;
    }

    // Check if the feature is still enabled
    if (!await isLoginSaveEnabled()) {
      return;
    }

    // Check if vault is still unlocked
    try {
      const authStatus = await sendMessage('CHECK_AUTH_STATUS');
      if (!authStatus.isLoggedIn || authStatus.isVaultLocked) {
        return;
      }
    } catch {
      return;
    }

    // Check if the domain is now blocked
    if (await isDomainBlocked(persistedState.domain)) {
      return;
    }

    // Create a shadow root UI specifically for the save prompt
    const ui = await createShadowRootUi(ctx, {
      name: 'aliasvault-save-prompt',
      position: 'inline',
      anchor: 'body',
      mode: await storage.getItem('local:e2eTestMode') === true ? 'open' : 'closed',
      /**
       * Mount handler for early save prompt restore.
       */
      onMount(container) {
        /**
         * Stop keyboard event propagation to prevent host page shortcuts from triggering
         * when typing in save prompt input fields.
         */
        const handleKeyboardEvent = (e: KeyboardEvent): void => {
          const target = e.target as HTMLElement;
          if (target && container.contains(target)) {
            e.stopPropagation();
          }
        };

        container.addEventListener('keydown', handleKeyboardEvent, true);
        container.addEventListener('keyup', handleKeyboardEvent, true);
        container.addEventListener('keypress', handleKeyboardEvent, true);

        // Restore the appropriate prompt type based on persisted state
        if (persistedState.promptType === 'add-url') {
          void restoreAddUrlPromptFromState(
            container,
            persistedState,
            handleAddUrlToCredential,
            handleSavePromptDismiss
          );
        } else {
          // Default to 'save' prompt
          void restoreSavePromptFromState(
            container,
            persistedState,
            handleSaveLogin,
            handleNeverSaveForDomain,
            handleSavePromptDismiss
          );
        }
        earlyRestoreCompleted = true;
      },
    });

    ui.mount();
  } catch (error) {
    console.error('[AliasVault] Error in early save prompt restore:', error);
  }
}

/**
 * Check for and restore a persisted save prompt from a previous page navigation.
 * This handles traditional form submissions that cause page redirects.
 * @param container - The shadow DOM container to append the prompt to.
 */
async function checkAndRestorePersistedSavePrompt(container: HTMLElement): Promise<void> {
  // Skip if we already restored early
  if (earlyRestoreCompleted) {
    return;
  }
  try {
    const persistedState = await getPersistedSavePromptState();

    if (!persistedState) {
      return;
    }

    // Check if the feature is still enabled
    if (!await isLoginSaveEnabled()) {
      return;
    }

    // Check if vault is still unlocked
    try {
      const authStatus = await sendMessage('CHECK_AUTH_STATUS');
      if (!authStatus.isLoggedIn || authStatus.isVaultLocked) {
        return;
      }
    } catch {
      return;
    }

    // Check if the domain is now blocked
    if (await isDomainBlocked(persistedState.domain)) {
      return;
    }

    // Restore the appropriate prompt type based on persisted state
    if (persistedState.promptType === 'add-url') {
      await restoreAddUrlPromptFromState(
        container,
        persistedState,
        handleAddUrlToCredential,
        handleSavePromptDismiss
      );
    } else {
      // Default to 'save' prompt
      await restoreSavePromptFromState(
        container,
        persistedState,
        handleSaveLogin,
        handleNeverSaveForDomain,
        handleSavePromptDismiss
      );
    }
  } catch (error) {
    console.error('[AliasVault] Error restoring persisted save prompt:', error);
  }
}

/**
 * Initialize the login detector to capture form submissions.
 * When a login is detected that's not in the vault, we can offer to save it.
 */
function initializeLoginDetector(container: HTMLElement): void {
  // Clean up any existing detector
  if (loginDetector) {
    loginDetector.destroy();
  }

  loginDetector = new LoginDetector(document);
  loginDetector.initialize();

  loginDetector.onLoginCapture(async (login: CapturedLogin) => {
    // Check if the feature is enabled
    if (!await isLoginSaveEnabled()) {
      return;
    }

    // Check if vault is locked
    try {
      const authStatus = await sendMessage('CHECK_AUTH_STATUS');
      if (!authStatus.isLoggedIn || authStatus.isVaultLocked) {
        return;
      }
    } catch {
      return;
    }

    // Check if a save prompt is already visible - if so, update it with new credentials
    if (isSavePromptVisible()) {
      updateSavePromptLogin(login);
      return;
    }

    // Check if the domain is blocked
    if (await isDomainBlocked(login.domain)) {
      return;
    }

    // Check if the login already exists in the vault (exact URL + username match)
    if (await isLoginDuplicate(login.domain, login.username)) {
      return;
    }

    // Get auto-dismiss settings
    let autoDismissMs = 15000;
    try {
      const settings = await sendMessage('GET_LOGIN_SAVE_SETTINGS');
      if (settings.success) {
        autoDismissMs = settings.autoDismissSeconds * 1000;
      }
    } catch {
      // Use default
    }

    /*
     * Check if user recently autofilled from an existing credential.
     * If so, offer to add the current URL to that credential instead of creating a new one.
     */
    try {
      const lastAutofilledResponse = await sendMessage('GET_LAST_AUTOFILLED', {
        domain: login.domain,
        username: login.username,
      });

      if (lastAutofilledResponse.success && lastAutofilledResponse.credential) {
        /*
         * Skip the prompt when the submitted URL is already linked.
         */
        const linkCheck = await sendMessage('IS_URL_LINKED_TO_CREDENTIAL', {
          itemId: lastAutofilledResponse.credential.itemId,
          url: login.url,
        });

        if (!linkCheck.linked) {
          // Current URL is not linked to the existing credential, show the prompt.
          showAddUrlPrompt(container, {
            login,
            existingCredential: lastAutofilledResponse.credential,
            onAddUrl: handleAddUrlToCredential,
            onDismiss: handleSavePromptDismiss,
            autoDismissMs,
          });
          return;
        }
      }
    } catch {
      // If check fails, fall back to normal save prompt
    }

    // Show save prompt to offer saving the credentials
    showSavePrompt(container, {
      login,
      onSave: handleSaveLogin,
      onNeverSave: handleNeverSaveForDomain,
      onDismiss: handleSavePromptDismiss,
      autoDismissMs,
    });
  });
}

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',
  allFrames: true,
  matchAboutBlank: true,
  runAt: 'document_start',

  /**
   * Main entry point for the content script.
   */
  async main(ctx) {
    if (ctx.isInvalid) {
      return;
    }

    // Initialize WebAuthn interceptor for passkey support
    await initializeWebAuthnInterceptor(ctx);

    /*
     * Check for persisted save prompt state immediately (before the 750ms delay).
     * This ensures the save prompt reappears quickly after page navigation.
     */
    void checkAndRestoreSavePromptEarly(ctx);

    // Wait for 750ms to give the host page time to load and to increase the chance that the body is available and ready.
    await new Promise(resolve => setTimeout(resolve, 750));

    // Create a shadow root UI for isolation (use 'open' mode in E2E tests for testability)
    const ui = await createShadowRootUi(ctx, {
      name: 'aliasvault-ui',
      position: 'inline',
      anchor: 'body',
      mode: await storage.getItem('local:e2eTestMode') === true ? 'open' : 'closed',
      /**
       * Handle mount.
       */
      onMount(container) {
        /**
         * Stop keyboard event propagation to prevent host page shortcuts from triggering
         * when typing in extension popups (e.g., Discourse "u" shortcut for "go back").
         */
        const handleKeyboardEvent = (e: KeyboardEvent): void => {
          // Only stop propagation if the event originated from within our shadow DOM
          const target = e.target as HTMLElement;
          if (target && container.contains(target)) {
            e.stopPropagation();
          }
        };

        // Capture keyboard events at the container level to prevent bubbling to host page
        container.addEventListener('keydown', handleKeyboardEvent, true);
        container.addEventListener('keyup', handleKeyboardEvent, true);
        container.addEventListener('keypress', handleKeyboardEvent, true);

        /**
         * Handle input field focus.
         */
        const handleFocusIn = async (e: FocusEvent) : Promise<void> => {
          if (ctx.isInvalid) {
            return;
          }

          /*
           * Honour av-disable / av-enable opt-in markers. The nearest ancestor wins, so a host page
           * can globally disable autofill via av-disable="true" on <body> while still opting specific
           * subtrees back in with av-enable="true".
           */
          if (!isAvAutofillAllowed(e.target as Element)) {
            devLog('[Autofill] focusin skipped: av-disable marker active for', e.target);
            return;
          }

          const { isValid, inputElement } = validateInputField(e.target as Element);
          if (!isValid) {
            devLog('[Autofill] focusin skipped: not a fillable input field', e.target);
          }
          if (isValid && inputElement) {
            /**
             * Immediately store the original autocomplete value and disable native autocomplete.
             * This must happen as early as possible to prevent native browser autofill from showing.
             */
            const originalAutocomplete = inputElement.getAttribute('autocomplete');
            if (originalAutocomplete && !inputElement.hasAttribute('data-av-autocomplete')) {
              inputElement.setAttribute('data-av-autocomplete', originalAutocomplete);
            }
            inputElement.setAttribute('autocomplete', 'off');

            const formDetector = new FormDetector(document, inputElement);
            if (!formDetector.containsLoginForm()) {
              devLog('[Autofill] focusin skipped: no login form detected around', inputElement);
              return;
            }

            // Only show popup for autofill-triggerable fields
            const detectedFieldType = formDetector.getDetectedFieldType();
            if (!detectedFieldType) {
              devLog('[Autofill] focusin skipped: field did not classify as an autofill-triggerable type', inputElement);
              return;
            }

            // Check if site allows autofill (site-specific disabled sites)
            if (!await isSiteAllowed()) {
              devLog('[Autofill] focusin skipped: autofill is disabled for this site');
              return;
            }

            // Check if we should show autofill UI for this field type
            const popupType = popupTypeForFieldType(detectedFieldType);
            if (!await POPUP_RUNTIME[popupType].enabled()) {
              devLog(`[Autofill] focusin skipped: ${popupType} popup is disabled in settings`);
              return;
            }

            /*
             * Honour av-suppress-save: skip the popup (and the icon) when there is no stored entry
             * that would actually fill this specific field — credentials for the credentials popup,
             * TOTP-enabled credentials for the TOTP popup — so we don't invite the user to
             * "create new" on pages where storing isn't desired by default (e.g. AliasVault's own
             * login / unlock / Enable 2FA forms).
             */
            if (isAvSuppressSave(inputElement) && !await hasMatchForCurrentUrl(popupType)) {
              devLog('[Autofill] focusin skipped: av-suppress-save active and no matching vault items');
              return;
            }

            // Store our detected field type for subsequent clicks
            inputElement.setAttribute('data-av-field-type', detectedFieldType);

            injectIcon(inputElement, container, detectedFieldType);

            // Only show popup if debounce time has passed
            if (popupDebounceTimeHasPassed()) {
              devLog(`[Autofill] Showing ${popupType} popup for ${detectedFieldType} field`, inputElement);
              await showPopupWithAuthCheck(inputElement, container, popupType);
            } else {
              devLog('[Autofill] Popup suppressed by debounce window (icon still shown)');
            }
          }
        };

        // Listen for input field focus in the main document
        document.addEventListener('focusin', handleFocusIn);

        /*
         * A conditional passkey request can arrive after the page initially loaded (e.g. an
         * autofocused login field). When passkeys become available, re-open the popup for
         * the focused field so they appear immediately.
         */
        window.addEventListener(CONDITIONAL_PASSKEYS_UPDATED_EVENT, () => {
          if (ctx.isInvalid) {
            return;
          }
          const activeElement = document.activeElement;
          if (activeElement) {
            void showPopupForElement(activeElement);
          }
        });

        // When the tab becomes visible, re-query any pending conditional passkey requests
        document.addEventListener('visibilitychange', () => {
          if (ctx.isInvalid || document.hidden || !hasPendingConditionalRequest()) {
            return;
          }
          void refreshConditionalPasskeyOptions();
        });

        // Check if currently something is focused, if so, apply check for that element
        const currentFocusedElement = document.activeElement;
        if (currentFocusedElement) {
          showPopupForElement(currentFocusedElement);
        }

        // Listen for popstate events (back/forward navigation)
        window.addEventListener('popstate', () => {
          if (ctx.isInvalid) {
            return;
          }

          removeExistingPopup(container);
        });

        // Initialize login detector to capture form submissions
        initializeLoginDetector(container);

        // Check for persisted save prompt state from previous page navigation
        void checkAndRestorePersistedSavePrompt(container);

        // Listen for messages from the background script
        onMessage('OPEN_AUTOFILL_POPUP', async ({ data }) => {
          const { elementIdentifier, popupType } = data;

          if (!elementIdentifier) {
            return { success: false, error: 'No element identifier provided' };
          }

          const target = document.getElementById(elementIdentifier) ?? document.getElementsByName(elementIdentifier)[0];

          if (isPopupType(popupType)) {
            const { isValid, inputElement } = validateInputField(target);
            if (!isValid || !inputElement) {
              return { success: false, error: 'Invalid input element' };
            }
            injectIcon(inputElement, container, POPUP_TYPES[popupType].fieldType);
            await showPopupWithAuthCheck(inputElement, container, popupType, true);
            return { success: true };
          }

          await showPopupForElement(target, true);

          return { success: true };
        });

        /*
         * A credential was created in the full popup window (opened from this page's "create new
         * item" flow). Autofill it back into the page form, mirroring the inline quick-create UX.
         */
        onMessage('AUTOFILL_CREATED_ITEM', async ({ data }) => {
          const { item, elementIdentifier } = data;

          if (!item) {
            return { success: false, error: 'No item provided' };
          }

          /*
           * Resolve the target input: prefer the explicit element identifier, then fall back to
           * the input the autofill popup was most recently shown for on this page.
           */
          let resolvedInput: HTMLInputElement | null = null;
          if (elementIdentifier) {
            const target = document.getElementById(elementIdentifier) ?? document.getElementsByName(elementIdentifier)[0] ?? null;
            const { isValid, inputElement } = validateInputField(target);
            if (isValid && inputElement) {
              resolvedInput = inputElement;
            }
          }
          if (!resolvedInput) {
            resolvedInput = getLastAutofillInput();
          }

          if (!resolvedInput) {
            return { success: false, error: 'No target input found' };
          }

          // Close any open inline popup before filling.
          removeExistingPopup(container);

          await fillItem(item as Item, resolvedInput);

          return { success: true };
        });

        // When the vault is unlocked, re-query any pending conditional passkey requests
        onMessage('VAULT_UNLOCKED', async () => {
          if (ctx.isInvalid || !hasPendingConditionalRequest()) {
            return;
          }
          await refreshConditionalPasskeyOptions();
        });

        /**
         * Check whether at least one stored entry would actually fill the current field for the
         * given popup type. Credentials popup looks at any URL-matched credential; TOTP popup
         * additionally requires the credential to have a stored TOTP secret. Returns false when
         * the vault is locked or when no matches exist — that's what av-suppress-save pages use
         * to decide whether the popup should appear at all.
         */
        async function hasMatchForCurrentUrl(popupType: PopupType): Promise<boolean> {
          try {
            const matchingMode = await LocalPreferencesService.getAutofillMatchingMode();
            const response = await sendMessage(POPUP_RUNTIME[popupType].matchMessage, {
              currentUrl: window.location.href,
              pageTitle: document.title,
              matchingMode,
            });
            return response.success && (response.items?.length ?? 0) > 0;
          } catch {
            return false;
          }
        }

        /**
         * Check if autofill is disabled for the current site (site-specific settings only).
         * @returns True if site allows autofill, false if site has disabled it
         */
        async function isSiteAllowed(): Promise<boolean> {
          const disabledSites = await LocalPreferencesService.getDisabledSites();
          const temporaryDisabledSites = await LocalPreferencesService.getTemporaryDisabledSites();
          const currentHostname = window.location.hostname;

          if (disabledSites.includes(currentHostname)) {
            return false;
          }

          const temporaryDisabledUntil = temporaryDisabledSites[currentHostname];
          if (temporaryDisabledUntil && Date.now() < temporaryDisabledUntil) {
            return false;
          }

          return true;
        }

        /**
         * Show popup for element.
         */
        async function showPopupForElement(element: Element, forceShow: boolean = false) : Promise<void> {
          const { isValid, inputElement } = validateInputField(element);

          if (!isValid || !inputElement) {
            return;
          }

          const formDetector = new FormDetector(document, inputElement);
          if (!formDetector.containsLoginForm()) {
            devLog('[Autofill] showPopupForElement skipped: no login form detected around', inputElement);
            return;
          }

          const detectedFieldType = formDetector.getDetectedFieldType();
          const popupType = popupTypeForFieldType(detectedFieldType);

          /*
           * av-suppress-save respects forceShow (e.g. explicit OPEN_AUTOFILL_POPUP from context menu)
           * but otherwise hides the popup unless a stored entry actually matches this field type
           * (credential for the credentials popup, credential-with-TOTP for the TOTP popup).
           */
          if (!forceShow && isAvSuppressSave(inputElement) && !await hasMatchForCurrentUrl(popupType)) {
            return;
          }

          /**
           * By default we check if the site allows autofill and if the field is autofill-triggerable
           * but if forceShow is true, we show the popup regardless.
           */
          const canShowPopup = forceShow || (await isSiteAllowed() && formDetector.isAutofillTriggerableField());

          if (!canShowPopup) {
            devLog('[Autofill] showPopupForElement skipped: site disabled or field not autofill-triggerable', inputElement);
          }

          if (canShowPopup) {
            /*
             * Check the per-popup-type feature toggle (credential vs TOTP, etc.), unless the
             * popup was explicitly requested (keyboard shortcut / context menu = force show).
             */
            if (!forceShow && !await POPUP_RUNTIME[popupType].enabled()) {
              return;
            }

            injectIcon(inputElement, container, detectedFieldType ?? undefined);
            await showPopupWithAuthCheck(inputElement, container, popupType, forceShow);
          }
        }

        /**
         * Show popup with auth check.
         * @param inputElement - The input element to show the popup for.
         * @param container - The container element.
         * @param popupType - Which popup to open (defaults to credentials).
         * @param forceShow - When true, bypass the popup's feature toggle (e.g. for explicit context menu actions).
         */
        async function showPopupWithAuthCheck(inputElement: HTMLInputElement, container: HTMLElement, popupType: PopupType = DEFAULT_POPUP_TYPE, forceShow: boolean = false) : Promise<void> {
          try {
            // Check auth status and pending migrations in a single call
            const authStatus = await sendMessage('CHECK_AUTH_STATUS');

            if (authStatus.isVaultLocked) {
              // Check if the user has dismissed the vault locked popup
              const dismissUntil = await LocalPreferencesService.getVaultLockedDismissUntil();
              if (dismissUntil && Date.now() < dismissUntil) {
                // User has dismissed the popup, don't show it again
                return;
              }

              // Vault is locked, show vault locked popup
              const { createVaultLockedPopup } = await import('@/entrypoints/contentScript/Popup');
              createVaultLockedPopup(inputElement, container);
              return;
            }

            if (authStatus.hasPendingMigrations) {
              // Show upgrade required popup
              await createUpgradeRequiredPopup(inputElement, container, await t('content.vaultUpgradeRequired'));
              return;
            }

            if (authStatus.error) {
              // Show upgrade required popup for version-related errors
              await createUpgradeRequiredPopup(inputElement, container, authStatus.error);
              return;
            }

            /*
             * Dispatch via the popup runtime registry. Feature toggle is re-checked
             * here for defensive consistency; explicit context menu actions bypass it via forceShow.
             */
            const runtime = POPUP_RUNTIME[popupType];
            if (forceShow || await runtime.enabled()) {
              runtime.open(inputElement, container);
            }
            // If disabled, don't show any popup (user can rely on clipboard auto-copy for TOTP)
          } catch (error) {
            console.error('[AliasVault] Error checking vault status:', error);
            // Fall back to normal autofill popup if check fails
            POPUP_RUNTIME[DEFAULT_POPUP_TYPE].open(inputElement, container);
          }
        }
      },
    });

    // Mount the UI to create the shadow root
    ui.autoMount();
  },
});