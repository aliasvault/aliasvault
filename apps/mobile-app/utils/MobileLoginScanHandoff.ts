import type { MobileLoginQrPayload } from '@aliasvault/client/auth/MobileLoginProtocol';

/**
 * How a mobile login request reached the app: read by the in-app scanner, or carried by an `aliasvault://` link.
 */
export type MobileLoginRequestSource = 'scan' | 'link';

export type PendingMobileLoginRequest = MobileLoginQrPayload & {
  source: MobileLoginRequestSource;
}

const MAX_AGE_MS = 3 * 60 * 1000;

let pendingRequest: (PendingMobileLoginRequest & { receivedAt: number }) | null = null;

/**
 * Hands a mobile login request to the confirmation screen through memory instead of route params.
 */
export const MobileLoginScanHandoff = {
  /**
   * Store a validated request for the confirmation screen.
   */
  set(payload: MobileLoginQrPayload, source: MobileLoginRequestSource): void {
    pendingRequest = { ...payload, source, receivedAt: Date.now() };
  },

  /**
   * Take the pending request.
   */
  take(): PendingMobileLoginRequest | null {
    const request = pendingRequest;
    pendingRequest = null;
    if (!request || Date.now() - request.receivedAt > MAX_AGE_MS) {
      return null;
    }
    return { requestId: request.requestId, publicKeyHash: request.publicKeyHash, source: request.source };
  },
};
