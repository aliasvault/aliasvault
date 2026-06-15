/**
 * PasskeyHandler - Handles passkey popup management in background
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { createVaultSqliteClient, handleGetEncryptionKey } from '@/entrypoints/background/VaultMessageHandler';

import { LocalPreferencesService } from '@/utils/LocalPreferencesService';
import { buildPasskeyAssertion } from '@/utils/passkey/PasskeyAssertionService';
import { PasskeyHelper } from '@/utils/passkey/PasskeyHelper';
import type {
  PasskeyPopupResponse,
  WebAuthnCreateRequest,
  WebAuthnGetRequest,
  PendingPasskeyRequest,
  PendingPasskeyCreateRequest,
  PendingPasskeyGetRequest,
  WebAuthnSettingsResponse,
  WebAuthnCreationPayload,
  WebAuthnPublicKeyGetPayload,
  ConditionalPasskeyOption,
  MatchingPasskeysResponse,
  WebAuthnAssertionResponse
} from '@/utils/passkey/types';
import { extractDomain } from '@/utils/RustCore';

import { browser } from '#imports';

// Pending popup requests
const pendingRequests = new Map<string, {
  resolve: (value: any) => void;
  reject: (error: any) => void;
  /**
   * Store window ID in order to close the popup window from background script later.
   */
  windowId?: number;
}>();

// Store request data temporarily (to avoid URL length limits)
const pendingRequestData = new Map<string, PendingPasskeyRequest>();

/**
 * Handle WebAuthn settings request
 */
export async function handleGetWebAuthnSettings(data: any): Promise<WebAuthnSettingsResponse> {
  // Check if passkey provider is enabled in settings (default to true if not set)
  const globalEnabled = await LocalPreferencesService.getPasskeyProviderEnabled();
  if (!globalEnabled) {
    return { enabled: false };
  }

  // If URL is provided, check if it's disabled for that site
  const { url } = data || {};
  if (url) {
    // Extract domain for matching
    const domain = await extractDomain(url);

    // Check disabled sites
    const disabledSites = await LocalPreferencesService.getPasskeyDisabledSites();
    if (disabledSites.includes(domain)) {
      return { enabled: false };
    }
  }

  return { enabled: true };
}

/**
 * Handle WebAuthn create (registration) request
 */
export async function handleWebAuthnCreate(data: any): Promise<any> {
  const { publicKey, origin } = data as WebAuthnCreateRequest;
  const requestId = Math.random().toString(36).substr(2, 9);

  // Store request data temporarily (to avoid URL length limits)
  const requestData: PendingPasskeyCreateRequest = {
    type: 'create',
    requestId,
    origin,
    publicKey: publicKey as WebAuthnCreationPayload
  };
  pendingRequestData.set(requestId, requestData);

  // Create popup using main popup with hash navigation - only pass requestId
  const popupUrl = browser.runtime.getURL('/popup.html') + '#/passkeys/create?' + new URLSearchParams({
    requestId
  }).toString();

  try {
    const popup = await browser.windows.create({
      url: popupUrl,
      type: 'popup',
      width: 450,
      height: 600,
      focused: true
    });

    // Wait for response from popup
    return new Promise((resolve, reject) => {
      pendingRequests.set(requestId, { resolve, reject, windowId: popup.id });

      // Clean up if popup is closed without response
      const checkClosed = setInterval(async () => {
        try {
          if (popup.id) {
            const _window = await browser.windows.get(popup.id);
            // Window still exists, continue waiting
          }
        } catch {
          // Window no longer exists
          clearInterval(checkClosed);
          if (pendingRequests.has(requestId)) {
            pendingRequests.delete(requestId);
            pendingRequestData.delete(requestId);
            resolve({ cancelled: true });
          }
        }
      }, 1000);
    });
  } catch {
    return { error: 'Failed to create popup window' };
  }
}

/**
 * Handle WebAuthn get (authentication) request
 * Note: Passkey retrieval is now handled in the popup via SqliteClient
 */
export async function handleWebAuthnGet(data: any): Promise<any> {
  const { publicKey, origin } = data as WebAuthnGetRequest;
  const requestId = Math.random().toString(36).substr(2, 9);

  // Store request data temporarily (to avoid URL length limits)
  const requestData: PendingPasskeyGetRequest = {
    type: 'get',
    requestId,
    origin,
    publicKey: publicKey as WebAuthnPublicKeyGetPayload,
    passkeys: [] // Will be populated by the popup from vault
  };
  pendingRequestData.set(requestId, requestData);

  // Create popup using main popup with hash navigation - only pass requestId
  const popupUrl = browser.runtime.getURL('/popup.html') + '#/passkeys/authenticate?' + new URLSearchParams({
    requestId
  }).toString();

  try {
    const popup = await browser.windows.create({
      url: popupUrl,
      type: 'popup',
      width: 450,
      height: 600,
      focused: true
    });

    // Wait for response from popup
    return new Promise((resolve, reject) => {
      pendingRequests.set(requestId, { resolve, reject, windowId: popup.id });

      // Clean up if popup is closed without response
      const checkClosed = setInterval(async () => {
        try {
          if (popup.id) {
            const _window = await browser.windows.get(popup.id);
            // Window still exists, continue waiting
          }
        } catch {
          // Window no longer exists
          clearInterval(checkClosed);
          if (pendingRequests.has(requestId)) {
            pendingRequests.delete(requestId);
            pendingRequestData.delete(requestId);
            resolve({ cancelled: true });
          }
        }
      }, 1000);
    });
  } catch {
    return { error: 'Failed to create popup window' };
  }
}

/**
 * Get the passkeys stored for a relying party, for the inline conditional-autofill dropdown.
 */
export async function handleGetMatchingPasskeys(
  data: { rpId: string; allowCredentialIds?: string[] }
): Promise<MatchingPasskeysResponse> {
  const { rpId, allowCredentialIds } = data;

  // If the vault is locked we cannot read passkeys; tell the caller so it can fall back.
  const encryptionKey = await handleGetEncryptionKey();
  if (!encryptionKey) {
    return { success: true, locked: true, passkeys: [] };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    let passkeys = sqliteClient.passkeys.getByRpId(rpId);

    // If the RP restricts to specific credentials, keep only those we actually hold.
    if (allowCredentialIds && allowCredentialIds.length > 0) {
      const allowedGuids = new Set(
        allowCredentialIds
          .map((id) => {
            try {
              return PasskeyHelper.base64urlToGuid(id);
            } catch {
              return null;
            }
          })
          .filter((id): id is string => id !== null)
      );
      passkeys = passkeys.filter((pk) => allowedGuids.has(pk.Id));
    }

    const options: ConditionalPasskeyOption[] = passkeys.map((pk) => {
      const item = sqliteClient.items.getById(pk.ItemId);
      return {
        id: pk.Id,
        itemId: pk.ItemId,
        serviceName: pk.ServiceName ?? pk.DisplayName,
        username: pk.Username ?? '',
        logo: item?.Logo ? Array.from(item.Logo) : null
      };
    });

    return { success: true, locked: false, passkeys: options };
  } catch (error) {
    console.error('Error getting matching passkeys:', error);
    return { success: false, locked: false, passkeys: [] };
  }
}

/**
 * Build a WebAuthn assertion for a passkey the user picked in the inline dropdown.
 */
export async function handleWebAuthnGetAssertion(
  data: { passkeyId: string; origin: string; publicKey: WebAuthnPublicKeyGetPayload }
): Promise<WebAuthnAssertionResponse> {
  const { passkeyId, origin, publicKey } = data;

  try {
    const sqliteClient = await createVaultSqliteClient();
    const credential = await buildPasskeyAssertion(sqliteClient, { origin, publicKey }, passkeyId);
    return { success: true, credential };
  } catch (error) {
    console.error('Error building passkey assertion:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Handle response from passkey popup
 */
export async function handlePasskeyPopupResponse(data: any): Promise<{ success: boolean }> {
  const { requestId, credential, fallback, cancelled } = data as PasskeyPopupResponse;
  const request = pendingRequests.get(requestId);

  if (!request) {
    return { success: false };
  }

  /**
   * Close the popup window from background script to ensure it always works.
   * Calling window.close() from the popup does not work in all browsers.
   */
  if (request.windowId) {
    try {
      await browser.windows.remove(request.windowId);
    } catch (error) {
      // Window might already be closed, ignore error
      console.debug('Failed to close popup window:', error);
    }
  }

  // Clean up both maps
  pendingRequests.delete(requestId);
  pendingRequestData.delete(requestId);

  if (cancelled) {
    request.resolve({ cancelled: true });
  } else if (fallback) {
    request.resolve({ fallback: true });
  } else if (credential) {
    request.resolve({ credential });
  } else {
    request.resolve({ cancelled: true });
  }

  return { success: true };
}

/**
 * Get request data by request ID
 */
export async function handleGetRequestData(data: any): Promise<PendingPasskeyRequest | null> {
  const { requestId } = data as { requestId: string };
  const requestData = pendingRequestData.get(requestId);
  return requestData || null;
}

