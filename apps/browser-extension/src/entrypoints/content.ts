/**
 * Content script entry point - handles autofill UI and WebAuthn passkey interception
 */

import '@/entrypoints/contentScript/style.css';
import { onMessage } from "webext-bridge/content-script";

import { injectIcon, popupDebounceTimeHasPassed, validateInputField } from '@/entrypoints/contentScript/Form';
import { isAutoShowPopupEnabled, openAutofillPopup, removeExistingPopup, createUpgradeRequiredPopup } from '@/entrypoints/contentScript/Popup';
import { initializeWebAuthnInterceptor } from '@/entrypoints/contentScript/WebAuthnInterceptor';

import { FormDetector } from '@/utils/formDetector/FormDetector';
import { BoolResponse as messageBoolResponse } from '@/utils/types/messaging/BoolResponse';

import { t } from '@/i18n/StandaloneI18n';

import { defineContentScript, createShadowRootUi, storage } from '#imports';

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
                await showPopupWithAuthCheck(inputElement, container);
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

          /**
           * By default we check if the popup is not disabled (for current site) and if the field is autofill-triggerable
           * but if forceShow is true, we show the popup regardless.
           */
          const canShowPopup = forceShow || (await isAutoShowPopupEnabled() && formDetector.isAutofillTriggerableField());

          if (canShowPopup) {
            injectIcon(inputElement, container);
            await showPopupWithAuthCheck(inputElement, container);
          }
        }

        /**
         * Show popup with auth check.
         */
        async function showPopupWithAuthCheck(inputElement: HTMLInputElement, container: HTMLElement) : Promise<void> {
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

            // No upgrade required, show normal autofill popup
            openAutofillPopup(inputElement, container);
          } catch (error) {
            console.error('Error checking vault status:', error);
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