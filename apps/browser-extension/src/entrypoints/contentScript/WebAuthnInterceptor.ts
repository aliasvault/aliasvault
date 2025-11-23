/**
 * WebAuthn Interceptor - Handles communication between page and extension
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { sendMessage } from 'webext-bridge/content-script';

import type { WebAuthnSettingsResponse } from '@/utils/passkey/types';

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
 * Track when the page finished loading to detect automatic vs user-initiated requests.
 * Some websites (like Nintendo, Amazon) automatically trigger passkey requests on page load.
 * We should filter these if no matching credentials exist.
 */
let pageLoadTime = 0;
const AUTO_REQUEST_THRESHOLD_MS = 1000; // Requests within 1 second of page load are considered "automatic"

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
 * Initialize the WebAuthn interceptor
 */
export async function initializeWebAuthnInterceptor(_ctx: any): Promise<void> {
  if (interceptorInitialized) {
    return;
  }

  // Track page load time for detecting automatic requests
  pageLoadTime = Date.now();

  // Listen for WebAuthn create events from the page
  window.addEventListener('aliasvault:webauthn:create', async (event: any) => {
    const { requestId, publicKey, origin } = event.detail;

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
      }, 'background');

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
    const { requestId, publicKey, origin } = event.detail;

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
      // Block requests if page isn't ready (prevents prefetch/autocomplete popups)
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

      // Detect if this is an automatic request (within 2 seconds of page load)
      const isAutomaticRequest = (Date.now() - pageLoadTime) < AUTO_REQUEST_THRESHOLD_MS;

      // Send to background script to handle
      const result = await sendMessage('WEBAUTHN_GET', {
        publicKey,
        origin,
        isAutomaticRequest
      }, 'background');

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
      hostname: window.location.hostname
    }, 'background') as unknown as WebAuthnSettingsResponse;
    return response.enabled ?? false;
  } catch {
    return false;
  }
}
