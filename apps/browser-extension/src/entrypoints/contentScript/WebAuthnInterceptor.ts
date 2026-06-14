/**
 * WebAuthn Interceptor - Handles communication between page and extension
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { sendMessage } from '@/utils/messaging/ExtensionMessaging';
import type { WebAuthnCreateEventDetail, WebAuthnGetEventDetail } from '@/utils/passkey/webauthn.types';
import {
  cloneWebAuthnEventDetail,
  validateWebAuthnEventDetail
} from '@/utils/passkey/WebAuthnRequestValidation';

import { registerConditionalPasskeyRequest } from './ConditionalPasskey';

import { browser } from '#imports';

// Firefox-specific global function for cloning objects into page context
declare function cloneInto<T>(obj: T, targetScope: any): T;

let interceptorInitialized = false;

/**
 * Track last cancelled request to prevent rapid-fire popups.
 * This is used to track the last time a WebAuthn request was cancelled.
 * Some websites try to automatically re-trigger a WebAuthn request after a cancellation.
 * which results in a jarring UX for the user.
 * This cooldown prevents rapid-fire popups by waiting for a short period after a cancellation.
 */
let lastCancelledTimestamp = 0;
const CANCEL_COOLDOWN_MS = 500; // 500ms cooldown after a recent cancellation

/**
 * Check if page is ready for WebAuthn interactions.
 * Safari and other browsers can trigger WebAuthn requests during URL autocomplete
 * or page prefetch, which creates popups before the user actually navigates to the page.
 * We check if the document is visible and interactive to prevent these spurious requests.
 */
function isPageReadyForWebAuthn(): boolean {
  // If page is hidden (prefetch/background tab), block the request
  if (document.hidden || document.visibilityState === 'hidden') {
    return false;
  }

  // If document is still loading (not even interactive), block the request
  if (document.readyState === 'loading') {
    return false;
  }

  // Page is visible and at least interactive - allow the request
  return true;
}

/**
 * Check whether a frame has the same origin as every ancestor frame.
 * Cross-origin iframe WebAuthn requires browser-level Permissions Policy checks,
 * so AliasVault must fall back to native WebAuthn when any ancestor differs.
 */
export function isSameOriginWithAncestors(currentWindow: Window = window): boolean {
  let frame: Window = currentWindow;
  const expectedOrigin = currentWindow.location.origin;

  while (frame !== frame.parent) {
    try {
      if (frame.parent.location.origin !== expectedOrigin) {
        return false;
      }
      frame = frame.parent;
    } catch {
      return false;
    }
  }

  return true;
}

/**
 * Initialize the WebAuthn interceptor
 */
export async function initializeWebAuthnInterceptor(_ctx: any): Promise<void> {
  if (interceptorInitialized) {
    return;
  }

  // Listen for WebAuthn create events from the page
  window.addEventListener('aliasvault:webauthn:create', async (event: any) => {
    const detail = cloneWebAuthnEventDetail<WebAuthnCreateEventDetail>(event.detail);
    const requestId = typeof detail?.requestId === 'string' ? detail.requestId : undefined;

    /**
     * Helper to dispatch event with Firefox compatibility
     * Firefox has strict cross-context security, so we serialize to JSON and back
     */
    const dispatchResponse = (detail: any): void => {
      let eventDetail: any;

      /*
       * For Firefox, we need to ensure the detail is accessible in the page context
       * cloneInto is a global function in Firefox content scripts
       */
      if (typeof cloneInto !== 'undefined') {
        // Firefox: serialize and clone into page context
        const serialized = JSON.parse(JSON.stringify(detail));
        eventDetail = cloneInto(serialized, (window as any).wrappedJSObject || window);
      } else {
        // Chrome/Edge: direct assignment works
        eventDetail = detail;
      }

      window.dispatchEvent(new CustomEvent('aliasvault:webauthn:create:response', {
        detail: eventDetail
      }));
    };

    try {
      if (!isSameOriginWithAncestors()) {
        dispatchResponse({
          requestId,
          fallback: true
        });
        return;
      }

      if (!validateWebAuthnEventDetail('create', detail, window.location.origin, window.location.hostname)) {
        dispatchResponse({
          requestId,
          fallback: true
        });
        return;
      }

      const { publicKey, origin } = detail;

      /**
       * Note: We don't block create (registration) requests based on page readiness.
       * Registration is always user-initiated (button click), so it's never spurious.
       */

      // Check if we're in cooldown period after a recent cancellation
      const now = Date.now();
      if (lastCancelledTimestamp > 0 && (now - lastCancelledTimestamp) < CANCEL_COOLDOWN_MS) {
        // Silently fall back to native implementation during cooldown
        dispatchResponse({
          requestId,
          fallback: true
        });
        return;
      }

      // Check if passkey provider is enabled
      const enabled = await isWebAuthnInterceptionEnabled();
      if (!enabled) {
        // If disabled, signal fallback to native browser implementation
        dispatchResponse({
          requestId,
          fallback: true
        });
        return;
      }

      // Send to background script to handle
      const result = await sendMessage('WEBAUTHN_CREATE', {
        publicKey,
        origin
      });

      // Track if user cancelled to enable cooldown
      if (result && typeof result === 'object' && (result as any).cancelled) {
        lastCancelledTimestamp = Date.now();
      }

      // Send response back to page
      dispatchResponse({
        requestId,
        ...(typeof result === 'object' && result !== null ? result : {})
      });
    } catch (error: any) {
      dispatchResponse({
        requestId,
        error: error.message
      });
    }
  });

  // Listen for WebAuthn get events from the page
  window.addEventListener('aliasvault:webauthn:get', async (event: any) => {
    const detail = cloneWebAuthnEventDetail<WebAuthnGetEventDetail>(event.detail);
    const requestId = typeof detail?.requestId === 'string' ? detail.requestId : undefined;

    /**
     * Helper to dispatch event with Firefox compatibility
     * Firefox has strict cross-context security, so we serialize to JSON and back
     */
    const dispatchResponse = (detail: any): void => {
      let eventDetail: any;

      /*
       * For Firefox, we need to ensure the detail is accessible in the page context
       * cloneInto is a global function in Firefox content scripts
       */
      if (typeof cloneInto !== 'undefined') {
        // Firefox: serialize and clone into page context
        const serialized = JSON.parse(JSON.stringify(detail));
        eventDetail = cloneInto(serialized, (window as any).wrappedJSObject || window);
      } else {
        // Chrome/Edge: direct assignment works
        eventDetail = detail;
      }

      window.dispatchEvent(new CustomEvent('aliasvault:webauthn:get:response', {
        detail: eventDetail
      }));
    };

    try {
      if (!isSameOriginWithAncestors()) {
        dispatchResponse({
          requestId,
          fallback: true
        });
        return;
      }

      if (!validateWebAuthnEventDetail('get', detail, window.location.origin, window.location.hostname)) {
        dispatchResponse({
          requestId,
          fallback: true
        });
        return;
      }

      const { publicKey, origin } = detail;

      // Check if passkey provider is enabled
      const enabled = await isWebAuthnInterceptionEnabled();
      if (!enabled) {
        // If disabled, signal fallback to native browser implementation
        dispatchResponse({
          requestId,
          fallback: true
        });
        return;
      }

      /*
       * Conditional mediation is passive passkey autofill. Rather than opening a modal, ask
       * the background for matching passkeys and, if we have any, offer them in the autofill
       * dropdown.
       */
      if (detail.mediation === 'conditional') {
        // Don't query the vault for hidden/prefetch tabs, leave the request pending.
        if (document.hidden || document.visibilityState === 'hidden') {
          return;
        }

        const rpId = publicKey.rpId || new URL(origin).hostname;
        const allowCredentialIds = publicKey.allowCredentials?.map((cred) => cred.id);

        const matching = await sendMessage('GET_MATCHING_PASSKEYS', { rpId, allowCredentialIds });
        if (matching.success && !matching.locked && matching.passkeys.length > 0) {
          registerConditionalPasskeyRequest({
            requestId: requestId as string,
            origin,
            publicKey,
            passkeys: matching.passkeys,
            respond: dispatchResponse
          });
        }

        /*
         * No match / locked / error: leave the request pending without falling back. The
         * dropdown resolves a registered request on passkey selection; an unregistered one
         * stays pending until the user acts or navigates away.
         */
        return;
      }

      // Block modal requests if page isn't ready (prevents prefetch/autocomplete popups)
      if (!isPageReadyForWebAuthn()) {
        dispatchResponse({
          requestId,
          fallback: true
        });
        return;
      }

      // Check if we're in cooldown period after a recent cancellation
      const now = Date.now();
      if (lastCancelledTimestamp > 0 && (now - lastCancelledTimestamp) < CANCEL_COOLDOWN_MS) {
        // Silently fall back to native implementation during cooldown
        dispatchResponse({
          requestId,
          fallback: true
        });
        return;
      }

      // Send to background script to handle (opens the passkey modal popup)
      const result = await sendMessage('WEBAUTHN_GET', {
        publicKey,
        origin
      });

      // Track if user cancelled to enable cooldown
      if (result && typeof result === 'object' && (result as any).cancelled) {
        lastCancelledTimestamp = Date.now();
      }

      // Send response back to page
      dispatchResponse({
        requestId,
        ...(typeof result === 'object' && result !== null ? result : {})
      });
    } catch (error: any) {
      dispatchResponse({
        requestId,
        error: error.message
      });
    }
  });

  // Inject the page script
  const script = document.createElement('script');
  script.src = browser.runtime.getURL('/webauthn.js');
  script.async = true;
  (document.head || document.documentElement).appendChild(script);
  /**
   * onload
   */
  script.onload = () : void => {
    script.remove();
  };
  /**
   * onerror
   */
  script.onerror = () : void => {
    // Ignore
  };

  interceptorInitialized = true;
}

/**
 * Check if WebAuthn interception is enabled for the current site
 */
export async function isWebAuthnInterceptionEnabled(): Promise<boolean> {
  try {
    const response = await sendMessage('GET_WEBAUTHN_SETTINGS', {
      url: window.location.href
    });
    return response.enabled ?? false;
  } catch {
    return false;
  }
}
