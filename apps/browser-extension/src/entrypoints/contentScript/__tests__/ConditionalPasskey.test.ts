// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { ConditionalPasskeyOption } from '@/utils/passkey/types';

// Mock the messaging layer to observe the background round-trip.
const { sendMessageMock } = vi.hoisted(() => ({ sendMessageMock: vi.fn() }));
vi.mock('@/utils/messaging/ExtensionMessaging', () => ({ sendMessage: sendMessageMock }));

import {
  CONDITIONAL_PASSKEYS_UPDATED_EVENT,
  clearConditionalPasskeyRequest,
  completeConditionalWithPasskey,
  getConditionalPasskeyOptions,
  hasPendingConditionalRequest,
  registerConditionalPasskeyRequest
} from '../ConditionalPasskey';

const OPTIONS: ConditionalPasskeyOption[] = [
  { id: 'pk-1', itemId: 'item-1', serviceName: 'Example', username: 'user@example.com', logo: null }
];

/**
 * Build a pending conditional request with a spy `respond` callback.
 */
function buildRequest(respond = vi.fn()): {
  request: Parameters<typeof registerConditionalPasskeyRequest>[0];
  respond: ReturnType<typeof vi.fn>;
} {
  return {
    request: {
      requestId: 'req-1',
      origin: 'https://example.com',
      publicKey: { challenge: 'Y2hhbGxlbmdl' },
      passkeys: OPTIONS,
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

  it('clears a pending request without responding', () => {
    const { request, respond } = buildRequest();
    registerConditionalPasskeyRequest(request);

    clearConditionalPasskeyRequest();

    expect(hasPendingConditionalRequest()).toBe(false);
    expect(respond).not.toHaveBeenCalled();
  });
});
