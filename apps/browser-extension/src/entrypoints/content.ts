/**
 * Content script entry point - handles autofill UI, login detection, and WebAuthn passkey interception
 */

import '@/entrypoints/contentScript/style.css';
import { injectIcon, popupDebounceTimeHasPassed, validateInputField } from '@/entrypoints/contentScript/Form';
import { openAutofillPopup, openTotpPopup, removeExistingPopup, createUpgradeRequiredPopup } from '@/entrypoints/contentScript/Popup';
import { showSavePrompt, showAddUrlPrompt, isSavePromptVisible, updateSavePromptLogin, getPersistedSavePromptState, restoreSavePromptFromState, restoreAddUrlPromptFromState } from '@/entrypoints/contentScript/SavePrompt';
import { initializeWebAuthnInterceptor } from '@/entrypoints/contentScript/WebAuthnInterceptor';

import { isAvAutofillAllowed, isAvSuppressSave } from '@/utils/autofill/Autofill';
import { DEFAULT_POPUP_TYPE, isPopupType, popupTypeForFieldType, POPUP_TYPES, type PopupType } from '@/utils/autofill/PopupTypes';
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
}> = {
  credentials: {
    open: openAutofillPopup,
    /** Resolves true when the user has the credential autofill popup enabled. */
    enabled: () => LocalPreferencesService.getGlobalAutofillPopupEnabled(),
  },
  totp: {
    open: openTotpPopup,
    /** Resolves true when the user has the TOTP autofill popup enabled. */
    enabled: () => LocalPreferencesService.getTotpAutofillEnabled(),
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
            return;
          }

          /*
           * Honour av-suppress-save: skip the popup (and therefore the icon) entirely when there is
           * no stored credential that matches this URL, so we don't invite the user to "create new"
           * on pages where storing the credential isn't desired by default (e.g. AliasVault's own web login form).
           */
          if (isAvSuppressSave(e.target as Element) && !await hasMatchingCredentialForCurrentUrl()) {
            return;
          }

          const { isValid, inputElement } = validateInputField(e.target as Element);
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
              return;
            }

            // Only show popup for autofill-triggerable fields
            const detectedFieldType = formDetector.getDetectedFieldType();
            if (!detectedFieldType) {
              return;
            }

            // Check if site allows autofill (site-specific disabled sites)
            if (!await isSiteAllowed()) {
              return;
            }

            // Check if we should show autofill UI for this field type
            const popupType = popupTypeForFieldType(detectedFieldType);
            if (!await POPUP_RUNTIME[popupType].enabled()) {
              return;
            }

            // Store our detected field type for subsequent clicks
            inputElement.setAttribute('data-av-field-type', detectedFieldType);

            injectIcon(inputElement, container, detectedFieldType);

            // Only show popup if debounce time has passed
            if (popupDebounceTimeHasPassed()) {
              await showPopupWithAuthCheck(inputElement, container, popupType);
            }
          }
        };

        // Listen for input field focus in the main document
        document.addEventListener('focusin', handleFocusIn);

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

        /**
         * Check whether at least one stored credential matches the current URL.
         * Used by av-suppress-save pages to decide whether the autofill popup should appear at all.
         * Returns false when the vault is locked or when no matches exist.
         */
        async function hasMatchingCredentialForCurrentUrl(): Promise<boolean> {
          try {
            const matchingMode = await LocalPreferencesService.getAutofillMatchingMode();
            const response = await sendMessage('GET_FILTERED_ITEMS', {
              currentUrl: window.location.href,
              pageTitle: document.title,
              matchingMode,
              includeRecentlySelected: false,
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
            return;
          }

          /*
           * av-suppress-save respects forceShow (e.g. explicit OPEN_AUTOFILL_POPUP from context menu)
           * but otherwise hides the popup unless a matching credential is already stored.
           */
          if (!forceShow && isAvSuppressSave(inputElement) && !await hasMatchingCredentialForCurrentUrl()) {
            return;
          }

          const detectedFieldType = formDetector.getDetectedFieldType();
          const popupType = popupTypeForFieldType(detectedFieldType);

          /**
           * By default we check if the site allows autofill and if the field is autofill-triggerable
           * but if forceShow is true, we show the popup regardless.
           */
          const canShowPopup = forceShow || (await isSiteAllowed() && formDetector.isAutofillTriggerableField());

          if (canShowPopup) {
            // Check the per-popup-type feature toggle (credential vs TOTP, etc.)
            if (!await POPUP_RUNTIME[popupType].enabled()) {
              return;
            }

            injectIcon(inputElement, container, detectedFieldType ?? undefined);
            await showPopupWithAuthCheck(inputElement, container, popupType);
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