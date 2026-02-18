/**
 * Content script entry point - handles autofill UI, login detection, and WebAuthn passkey interception
 */

import '@/entrypoints/contentScript/style.css';
import { onMessage, sendMessage } from "webext-bridge/content-script";

import { injectIcon, popupDebounceTimeHasPassed, validateInputField } from '@/entrypoints/contentScript/Form';
import { isAutoShowPopupEnabled, openAutofillPopup, openTotpPopup, removeExistingPopup, createUpgradeRequiredPopup } from '@/entrypoints/contentScript/Popup';
import { showSavePrompt, isSavePromptVisible, updateSavePromptLogin, getPersistedSavePromptState, restoreSavePromptFromState } from '@/entrypoints/contentScript/SavePrompt';
import { initializeWebAuthnInterceptor } from '@/entrypoints/contentScript/WebAuthnInterceptor';

import { FormDetector } from '@/utils/formDetector/FormDetector';
import { DetectedFieldType } from '@/utils/formDetector/types/FormFields';
import { LoginDetector } from '@/utils/loginDetector';
import type { CapturedLogin } from '@/utils/loginDetector';
import { BoolResponse as messageBoolResponse } from '@/utils/types/messaging/BoolResponse';

import { t } from '@/i18n/StandaloneI18n';

import { defineContentScript, createShadowRootUi, storage } from '#imports';

/** Global login detector instance */
let loginDetector: LoginDetector | null = null;

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
    }, 'background') as { success: boolean; itemId?: string; error?: string };

    if (!response.success) {
      console.error('[AliasVault] Failed to save login:', response.error);
    }
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
function handleSavePromptDismiss(): void {
  // No action needed on dismiss
}

/**
 * Check if the login save feature is enabled.
 * @returns Whether the feature is enabled.
 */
async function isLoginSaveEnabled(): Promise<boolean> {
  try {
    const response = await sendMessage('GET_LOGIN_SAVE_SETTINGS', {}, 'background') as {
      success: boolean;
      enabled: boolean;
      autoDismissSeconds: number;
    };
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
    }, 'background') as { success: boolean; isDuplicate: boolean };
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
      const authStatus = await sendMessage('CHECK_AUTH_STATUS', {}, 'background') as {
        isLoggedIn: boolean;
        isVaultLocked: boolean;
      };
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
        // Restore the save prompt with the remaining time
        void restoreSavePromptFromState(
          container,
          persistedState,
          handleSaveLogin,
          handleNeverSaveForDomain,
          handleSavePromptDismiss
        );
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
      const authStatus = await sendMessage('CHECK_AUTH_STATUS', {}, 'background') as {
        isLoggedIn: boolean;
        isVaultLocked: boolean;
      };
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

    // Restore the save prompt with the remaining time
    await restoreSavePromptFromState(
      container,
      persistedState,
      handleSaveLogin,
      handleNeverSaveForDomain,
      handleSavePromptDismiss
    );
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
      const authStatus = await sendMessage('CHECK_AUTH_STATUS', {}, 'background') as {
        isLoggedIn: boolean;
        isVaultLocked: boolean;
      };
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

    // Check if the login already exists in the vault
    if (await isLoginDuplicate(login.domain, login.username)) {
      return;
    }

    // Get auto-dismiss settings
    let autoDismissMs = 15000;
    try {
      const settings = await sendMessage('GET_LOGIN_SAVE_SETTINGS', {}, 'background') as {
        success: boolean;
        autoDismissSeconds: number;
      };
      if (settings.success) {
        autoDismissMs = settings.autoDismissSeconds * 1000;
      }
    } catch {
      // Use default
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
         * Handle input field focus.
         */
        const handleFocusIn = async (e: FocusEvent) : Promise<void> => {
          if (ctx.isInvalid) {
            return;
          }

          // Check if element itself, html or body has av-disable attribute like av-disable="true"
          const avDisable = ((e.target as HTMLElement).getAttribute('av-disable') ?? document.body?.getAttribute('av-disable') ?? document.documentElement.getAttribute('av-disable')) === 'true';
          if (avDisable) {
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

            // Only inject icon and show popup if autofill popup is enabled
            if (await isAutoShowPopupEnabled()) {
              // Store our detected field type for subsequent clicks
              inputElement.setAttribute('data-av-field-type', detectedFieldType);

              injectIcon(inputElement, container);

              // Only show popup if debounce time has passed
              if (popupDebounceTimeHasPassed()) {
                await showPopupWithAuthCheck(inputElement, container, detectedFieldType);
              }
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
        onMessage('OPEN_AUTOFILL_POPUP', async (message: { data: { elementIdentifier: string } }) : Promise<messageBoolResponse> => {
          const { data } = message;
          const { elementIdentifier } = data;

          if (!elementIdentifier) {
            return { success: false, error: 'No element identifier provided' };
          }

          const target = document.getElementById(elementIdentifier) ?? document.getElementsByName(elementIdentifier)[0];

          await showPopupForElement(target, true);

          return { success: true };
        });

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

          const detectedFieldType = formDetector.getDetectedFieldType();

          /**
           * By default we check if the popup is not disabled (for current site) and if the field is autofill-triggerable
           * but if forceShow is true, we show the popup regardless.
           */
          const canShowPopup = forceShow || (await isAutoShowPopupEnabled() && formDetector.isAutofillTriggerableField());

          if (canShowPopup) {
            injectIcon(inputElement, container);
            await showPopupWithAuthCheck(inputElement, container, detectedFieldType ?? undefined);
          }
        }

        /**
         * Show popup with auth check.
         * @param inputElement - The input element to show the popup for.
         * @param container - The container element.
         * @param fieldType - The detected field type (optional, defaults to regular autofill).
         */
        async function showPopupWithAuthCheck(inputElement: HTMLInputElement, container: HTMLElement, fieldType?: DetectedFieldType) : Promise<void> {
          try {
            // Check auth status and pending migrations in a single call
            const { sendMessage } = await import('webext-bridge/content-script');
            const authStatus = await sendMessage('CHECK_AUTH_STATUS', {}, 'background') as {
              isLoggedIn: boolean,
              isVaultLocked: boolean,
              hasPendingMigrations: boolean,
              error?: string
            };

            if (authStatus.isVaultLocked) {
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

            // Show appropriate popup based on field type
            if (fieldType === DetectedFieldType.Totp) {
              openTotpPopup(inputElement, container);
            } else {
              openAutofillPopup(inputElement, container);
            }
          } catch (error) {
            console.error('[AliasVault] Error checking vault status:', error);
            // Fall back to normal autofill popup if check fails
            openAutofillPopup(inputElement, container);
          }
        }
      },
    });

    // Mount the UI to create the shadow root
    ui.autoMount();
  },
});