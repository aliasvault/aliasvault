import type { WebAuthnCreateEventDetail, WebAuthnGetEventDetail } from '@/utils/passkey/webauthn.types';

type WebAuthnRequestType = 'create' | 'get';
type WebAuthnBridgeDetail = WebAuthnCreateEventDetail | WebAuthnGetEventDetail;

export type WebAuthnBridgeRequest = {
  origin?: unknown;
  publicKey?: unknown;
};

/**
 * Type guard that narrows an unknown value to a non-null object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The RP ID a WebAuthn request names, or undefined when it names none (the RP ID then defaults to the host).
 */
export function getWebAuthnRequestRpId(type: WebAuthnRequestType, request: WebAuthnBridgeRequest | undefined): unknown {
  if (!isObject(request) || !isObject(request.publicKey)) {
    return undefined;
  }
  if (type === 'create') {
    return isObject(request.publicKey.rp) ? request.publicKey.rp.id : undefined;
  }
  return request.publicKey.rpId;
}

/**
 * Clone page-provided WebAuthn event data into extension-owned plain data.
 * The page controls CustomEvent.detail, so do not validate one object and later
 * forward the original object after an await.
 */
export function cloneWebAuthnEventDetail<T extends WebAuthnBridgeDetail>(detail: unknown): T | undefined {
  if (!isObject(detail)) {
    return undefined;
  }

  try {
    return JSON.parse(JSON.stringify(detail)) as T;
  } catch {
    return undefined;
  }
}

/**
 * Validate the shape and origin of a WebAuthn request. The RP ID itself is checked in the background.
 */
export function validateWebAuthnRequest(
  type: WebAuthnRequestType,
  request: WebAuthnBridgeRequest | undefined,
  expectedOrigin: string,
): boolean {
  if (
    !isObject(request) ||
    typeof request.origin !== 'string' ||
    !isObject(request.publicKey) ||
    request.origin !== expectedOrigin
  ) {
    return false;
  }

  if (type === 'create') {
    const publicKey = request.publicKey;
    const user = publicKey.user;
    const rp = publicKey.rp;
    if (
      !isObject(user) ||
      typeof user.id !== 'string' ||
      typeof publicKey.challenge !== 'string'
    ) {
      return false;
    }

    if (rp !== undefined && !isObject(rp)) {
      return false;
    }

    const rpId = isObject(rp) ? rp.id : undefined;
    return rpId === undefined || typeof rpId === 'string';
  }

  const publicKey = request.publicKey;
  if (typeof publicKey.challenge !== 'string') {
    return false;
  }

  const rpId = publicKey.rpId;
  return rpId === undefined || typeof rpId === 'string';
}

/**
 * Validate a WebAuthn bridge request from the page before forwarding it to the background script.
 * The page context can dispatch AliasVault's custom events directly, so security decisions must
 * use the content script's current window location rather than trusting event.detail.origin.
 */
export function validateWebAuthnEventDetail(
  type: WebAuthnRequestType,
  detail: WebAuthnBridgeDetail | undefined,
  expectedOrigin: string,
): detail is WebAuthnBridgeDetail {
  return (
    typeof detail?.requestId === 'string' &&
    validateWebAuthnRequest(type, detail, expectedOrigin)
  );
}
