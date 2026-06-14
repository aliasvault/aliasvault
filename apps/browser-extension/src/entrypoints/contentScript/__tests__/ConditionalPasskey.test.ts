// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { ConditionalPasskeyOption } from '@/utils/passkey/types';

// Mock the messaging layer to observe the background round-trip.
const { sendMessageMock } = vi.hoisted(() => ({ sendMessageMock: vi.fn() }));
vi.mock('@/utils/messaging/ExtensionMessaging', () => ({ sendMessage: sendMessageMock }));

import {
  CONDITIONAL_PASSKEYS_UPDATED_EVENT,
  clearConditionalPasskeyRequest,
  clearConditionalPasskeyRequestIfMatches,
  completeConditionalWithPasskey,
  getConditionalPasskeyOptions,
  hasPendingConditionalRequest,
  refreshConditionalPasskeyOptions,
  registerConditionalPasskeyRequest
} from '../ConditionalPasskey';

const OPTIONS: ConditionalPasskeyOption[] = [
  { id: 'pk-1', itemId: 'item-1', serviceName: 'Example', username: 'user@example.com', logo: null }
];

/**
 * Build a pending conditional request with a spy `respond` callback.
 *
 * @param respond - Spy used to assert the page promise is settled.
 * @param passkeys - Passkeys parked with the request (empty mirrors a locked-vault request).
 */
function buildRequest(respond = vi.fn(), passkeys: ConditionalPasskeyOption[] = OPTIONS): {
  request: Parameters<typeof registerConditionalPasskeyRequest>[0];
  respond: ReturnType<typeof vi.fn>;
} {
  return {
    request: {
      requestId: 'req-1',
      origin: 'https://example.com',
      publicKey: { challenge: 'Y2hhbGxlbmdl' },
      rpId: 'example.com',
      passkeys,
      respond
    },
    respond
  };
}

describe('ConditionalPasskey bridge', () => {
  beforeEach(() => {
    clearConditionalPasskeyRequest();
    sendMessageMock.mockReset();
  });

  it('reports no pending request and no options by default', () => {
    expect(hasPendingConditionalRequest()).toBe(false);
    expect(getConditionalPasskeyOptions()).toEqual([]);
  });

  it('stores options and announces availability when a request is registered', () => {
    const listener = vi.fn();
    window.addEventListener(CONDITIONAL_PASSKEYS_UPDATED_EVENT, listener);

    const { request } = buildRequest();
    registerConditionalPasskeyRequest(request);

    expect(hasPendingConditionalRequest()).toBe(true);
    expect(getConditionalPasskeyOptions()).toEqual(OPTIONS);
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener(CONDITIONAL_PASSKEYS_UPDATED_EVENT, listener);
  });

  it('parks a request silently when no passkeys are available yet (locked vault)', () => {
    const listener = vi.fn();
    window.addEventListener(CONDITIONAL_PASSKEYS_UPDATED_EVENT, listener);

    const { request } = buildRequest(vi.fn(), []);
    registerConditionalPasskeyRequest(request);

    // Request is parked (kept pending) but nothing is announced because there are no options.
    expect(hasPendingConditionalRequest()).toBe(true);
    expect(getConditionalPasskeyOptions()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();

    window.removeEventListener(CONDITIONAL_PASSKEYS_UPDATED_EVENT, listener);
  });

  it('surfaces passkeys for a parked request when the vault is later unlocked', async () => {
    const listener = vi.fn();
    window.addEventListener(CONDITIONAL_PASSKEYS_UPDATED_EVENT, listener);

    // Parked while the vault was locked: no options, no announcement.
    const { request } = buildRequest(vi.fn(), []);
    registerConditionalPasskeyRequest(request);

    // Vault unlocked: re-query now returns matching passkeys.
    sendMessageMock.mockResolvedValue({ success: true, locked: false, passkeys: OPTIONS });

    const found = await refreshConditionalPasskeyOptions();

    expect(found).toBe(true);
    expect(sendMessageMock).toHaveBeenCalledWith('GET_MATCHING_PASSKEYS', {
      rpId: 'example.com',
      allowCredentialIds: undefined
    });
    expect(getConditionalPasskeyOptions()).toEqual(OPTIONS);
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener(CONDITIONAL_PASSKEYS_UPDATED_EVENT, listener);
  });

  it('keeps the request parked without announcing when a re-query finds nothing', async () => {
    const listener = vi.fn();
    window.addEventListener(CONDITIONAL_PASSKEYS_UPDATED_EVENT, listener);

    const { request } = buildRequest(vi.fn(), []);
    registerConditionalPasskeyRequest(request);

    sendMessageMock.mockResolvedValue({ success: true, locked: true, passkeys: [] });

    const found = await refreshConditionalPasskeyOptions();

    expect(found).toBe(false);
    expect(hasPendingConditionalRequest()).toBe(true);
    expect(getConditionalPasskeyOptions()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();

    window.removeEventListener(CONDITIONAL_PASSKEYS_UPDATED_EVENT, listener);
  });

  it('does not re-query when there is no parked request', async () => {
    const found = await refreshConditionalPasskeyOptions();

    expect(found).toBe(false);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('completes a request by signing in the background and resolving the page', async () => {
    const credential = { id: 'pk-1', rawId: 'pk-1', clientDataJSON: 'a', authenticatorData: 'b', signature: 'c', userHandle: null };
    sendMessageMock.mockResolvedValue({ success: true, credential });

    const { request, respond } = buildRequest();
    registerConditionalPasskeyRequest(request);

    const result = await completeConditionalWithPasskey('pk-1');

    expect(result).toBe(true);
    expect(sendMessageMock).toHaveBeenCalledWith('WEBAUTHN_GET_ASSERTION', {
      passkeyId: 'pk-1',
      origin: 'https://example.com',
      publicKey: { challenge: 'Y2hhbGxlbmdl' }
    });
    expect(respond).toHaveBeenCalledWith({ requestId: 'req-1', credential });
    // State is cleared after completion.
    expect(hasPendingConditionalRequest()).toBe(false);
  });

  it('responds with an error when signing fails so the page promise does not hang', async () => {
    sendMessageMock.mockResolvedValue({ success: false, error: 'boom' });

    const { request, respond } = buildRequest();
    registerConditionalPasskeyRequest(request);

    const result = await completeConditionalWithPasskey('pk-1');

    expect(result).toBe(false);
    expect(respond).toHaveBeenCalledWith({ requestId: 'req-1', error: 'boom' });
    expect(hasPendingConditionalRequest()).toBe(false);
  });

  it('does nothing when there is no pending request', async () => {
    const result = await completeConditionalWithPasskey('pk-1');

    expect(result).toBe(false);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('clears a pending request by id when it matches (page aborted the request)', () => {
    const listener = vi.fn();
    window.addEventListener(CONDITIONAL_PASSKEYS_UPDATED_EVENT, listener);

    const { request, respond } = buildRequest();
    registerConditionalPasskeyRequest(request);

    const cleared = clearConditionalPasskeyRequestIfMatches('req-1');

    expect(cleared).toBe(true);
    expect(hasPendingConditionalRequest()).toBe(false);
    expect(respond).not.toHaveBeenCalled();
    // A dropdown was showing options, so the UI is asked to re-render (and drop them).
    expect(listener).toHaveBeenCalledTimes(2); // once on register, once on clear

    window.removeEventListener(CONDITIONAL_PASSKEYS_UPDATED_EVENT, listener);
  });

  it('does not clear a pending request when the aborted id is for an older request', () => {
    const { request } = buildRequest();
    registerConditionalPasskeyRequest(request);

    const cleared = clearConditionalPasskeyRequestIfMatches('some-older-id');

    expect(cleared).toBe(false);
    expect(hasPendingConditionalRequest()).toBe(true);
  });

  it('clears a pending request without responding', () => {
    const { request, respond } = buildRequest();
    registerConditionalPasskeyRequest(request);

    clearConditionalPasskeyRequest();

    expect(hasPendingConditionalRequest()).toBe(false);
    expect(respond).not.toHaveBeenCalled();
  });
});
