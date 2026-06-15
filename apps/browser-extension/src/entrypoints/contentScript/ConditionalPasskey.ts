/**
 * ConditionalPasskey
 * ------------------
 * Tracks a WebAuthn conditional mediation request (passkey autofill).
 *
 * When a page calls `navigator.credentials.get({ mediation: 'conditional' })`,
 * the request is stored here and left pending. It is completed only when the
 * user selects a passkey from the AliasVault dropdown or leaves the page.
 *
 * After selection, the background script creates the assertion and returns it
 * to the page, resolving the original `get()` call.
 */

import { sendMessage } from '@/utils/messaging/ExtensionMessaging';
import type { ConditionalPasskeyOption, PasskeyGetCredentialResponse, WebAuthnPublicKeyGetPayload } from '@/utils/passkey/types';
import type { WebAuthnGetEventDetail } from '@/utils/passkey/webauthn.types';

/**
 * The response detail dispatched back to the page to settle the pending `get()` promise.
 */
type ConditionalResponseDetail = {
  requestId: string;
  credential?: PasskeyGetCredentialResponse;
  fallback?: boolean;
  error?: string;
};

/**
 * A conditional `get()` request held open while we wait for the user to pick a passkey.
 */
type PendingConditionalRequest = {
  requestId: string;
  origin: string;
  publicKey: WebAuthnGetEventDetail['publicKey'];
  rpId: string;
  allowCredentialIds?: string[];
  passkeys: ConditionalPasskeyOption[];
  respond: (detail: ConditionalResponseDetail) => void;
};

/**
 * Window event fired when a conditional request is registered, so the content script can
 * (re)render the autofill dropdown if a login field is already focused.
 */
export const CONDITIONAL_PASSKEYS_UPDATED_EVENT = 'aliasvault:conditional-passkeys-updated';

/**
 * The single pending conditional request for this frame. There is at most one active at a
 * time; a newer request simply replaces it (the older page promise is left pending, which
 * is the spec-correct outcome for an abandoned conditional request).
 */
let pendingRequest: PendingConditionalRequest | null = null;

/**
 * Park a conditional `get()` request.
 * 
 * When passkeys are found, the event is dispatched to the page to update the autofill dropdown.
 */
export function registerConditionalPasskeyRequest(request: PendingConditionalRequest): void {
  pendingRequest = request;
  if (request.passkeys.length > 0) {
    window.dispatchEvent(new CustomEvent(CONDITIONAL_PASSKEYS_UPDATED_EVENT));
  }
}

/**
 * Re-query the background for passkeys matching the parked conditional request.
 * 
 * @returns true when passkeys were found and the parked request now has options to offer.
 */
export async function refreshConditionalPasskeyOptions(): Promise<boolean> {
  const request = pendingRequest;
  if (!request) {
    return false;
  }

  const matching = await sendMessage('GET_MATCHING_PASSKEYS', {
    rpId: request.rpId,
    allowCredentialIds: request.allowCredentialIds
  });

  if (pendingRequest !== request) {
    return false;
  }

  if (matching.success && !matching.locked && matching.passkeys.length > 0) {
    request.passkeys = matching.passkeys;
    window.dispatchEvent(new CustomEvent(CONDITIONAL_PASSKEYS_UPDATED_EVENT));
    return true;
  }

  return false;
}

/**
 * The passkeys to offer in the dropdown, or an empty array when none are pending.
 */
export function getConditionalPasskeyOptions(): ConditionalPasskeyOption[] {
  return pendingRequest?.passkeys ?? [];
}

/**
 * Whether a conditional request is currently waiting for the user to pick a passkey.
 */
export function hasPendingConditionalRequest(): boolean {
  return pendingRequest !== null;
}

/**
 * Forget the pending conditional request without responding to the page.
 */
export function clearConditionalPasskeyRequest(): void {
  pendingRequest = null;
}

/**
 * Clear a pending conditional request if it matches the given id.
 *
 * @param requestId - The id of the aborted conditional request.
 * @returns true when the matching request was cleared.
 */
export function clearConditionalPasskeyRequestIfMatches(requestId: string): boolean {
  if (pendingRequest?.requestId !== requestId) {
    return false;
  }

  const hadOptions = pendingRequest.passkeys.length > 0;
  pendingRequest = null;
  if (hadOptions) {
    window.dispatchEvent(new CustomEvent(CONDITIONAL_PASSKEYS_UPDATED_EVENT));
  }
  return true;
}

/**
 * Complete the pending conditional request with the passkey the user selected.
 * Signs in the background, resolves the page's pending `get()` promise, and clears state.
 *
 * @param passkeyId - The vault ID of the selected passkey.
 * @returns true when an assertion was produced and returned to the page.
 */
export async function completeConditionalWithPasskey(passkeyId: string): Promise<boolean> {
  const request = pendingRequest;
  if (!request) {
    return false;
  }

  // Clear up front so a slow assertion doesn't trigger twice for the same request.
  pendingRequest = null;

  try {
    const result = await sendMessage('WEBAUTHN_GET_ASSERTION', {
      passkeyId,
      origin: request.origin,
      publicKey: request.publicKey as unknown as WebAuthnPublicKeyGetPayload
    });

    if (result.success && result.credential) {
      request.respond({ requestId: request.requestId, credential: result.credential });
      return true;
    }

    // Signing failed, return an error to the page.
    request.respond({ requestId: request.requestId, error: result.error ?? 'Passkey authentication failed' });
    return false;
  } catch (error) {
    request.respond({
      requestId: request.requestId,
      error: error instanceof Error ? error.message : 'Passkey authentication failed'
    });
    return false;
  }
}
