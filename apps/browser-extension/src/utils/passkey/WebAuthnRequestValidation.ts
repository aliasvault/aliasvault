import type { WebAuthnCreateEventDetail, WebAuthnGetEventDetail } from '@/utils/passkey/webauthn.types';

type WebAuthnRequestType = 'create' | 'get';
type WebAuthnBridgeDetail = WebAuthnCreateEventDetail | WebAuthnGetEventDetail;

type WebAuthnBridgeRequest = {
  origin?: unknown;
  publicKey?: unknown;
};

/**
 * Normalize a host or RP ID for WebAuthn comparison.
 */
function normalizeWebAuthnHost(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/\.$/, '');
  if (!normalized || normalized.includes('/') || normalized.includes(':')) {
    return null;
  }

  return normalized;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Check whether an RP ID is valid for the current origin host.
 * WebAuthn allows the RP ID to be the current host or a parent domain.
 * This prevents a page from asking AliasVault to sign for another RP.
 */
export function isRpIdAllowedForHost(rpId: string | undefined, host: string): boolean {
  const normalizedHost = normalizeWebAuthnHost(host);
  const normalizedRpId = normalizeWebAuthnHost(rpId);

  if (!normalizedHost || !normalizedRpId) {
    return false;
  }

  return normalizedHost === normalizedRpId || normalizedHost.endsWith(`.${normalizedRpId}`);
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
 * Validate a WebAuthn request before forwarding it to the passkey signing flow.
 */
export function validateWebAuthnRequest(
  type: WebAuthnRequestType,
  request: WebAuthnBridgeRequest | undefined,
  expectedOrigin: string,
  currentHost: string,
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
    return rpId === undefined || (typeof rpId === 'string' && isRpIdAllowedForHost(rpId, currentHost));
  }

  const publicKey = request.publicKey;
  if (typeof publicKey.challenge !== 'string') {
    return false;
  }

  const rpId = publicKey.rpId;
  return rpId === undefined || (typeof rpId === 'string' && isRpIdAllowedForHost(rpId, currentHost));
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
  currentHost: string,
): detail is WebAuthnBridgeDetail {
  return (
    typeof detail?.requestId === 'string' &&
    validateWebAuthnRequest(type, detail, expectedOrigin, currentHost)
  );
}
