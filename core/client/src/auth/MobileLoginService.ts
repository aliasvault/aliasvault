import EncryptionUtility from '../crypto/EncryptionUtility';
import { bytesToBase64 } from '../utilities/Base64';

import { MobileLoginProtocol } from './MobileLoginProtocol';

import type { WebApiService } from '../api/WebApiService';
import type { MobileLoginInitiateResponse, MobileLoginPayload, MobileLoginPollResponse } from '@aliasvault/models/webapi';

/**
 * Error codes for mobile login failures.
 */
export enum MobileLoginErrorCode {
  TIMEOUT = 'TIMEOUT',
  DECLINED = 'DECLINED',
  GENERIC = 'GENERIC',
}

/**
 * Whether a thrown value is a mobile login error code.
 */
export function isMobileLoginErrorCode(value: unknown): value is MobileLoginErrorCode {
  return typeof value === 'string' && Object.values(MobileLoginErrorCode).includes(value as MobileLoginErrorCode);
}

/**
 * The decrypted session and unlock key of an approved mobile login.
 */
export type MobileLoginResult = {
  username: string;
  token: string;
  refreshToken: string;
  unlockKey: string;
  salt: string;
  encryptionType: string;
  encryptionSettings: string;
}

/**
 * The part of the API client the mobile login requests need.
 */
export type MobileLoginApi = Pick<WebApiService, 'rawFetch'>;

/** Seconds a mobile login request stays valid in the UI (server holds it active for a few seconds longer for delayed confirms). */
export const MOBILE_LOGIN_REQUEST_LIFETIME_SECONDS = 120;

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 210000; // 3.5 minutes

/**
 * The client side of a mobile login (QR unlock): creates the request, then polls until the mobile app approves or declines it.
 */
export class MobileLoginService {
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private pollingTimeout: ReturnType<typeof setTimeout> | null = null;
  private isPollInFlight = false;
  private requestId: string | null = null;
  private pollSecret: string | null = null;
  private privateKey: CryptoKey | null = null;

  /**
   * Create the service.
   * @param api - The API client the requests go through
   */
  public constructor(private readonly api: MobileLoginApi) {}

  /**
   * Create a mobile login request.
   * @returns The text for the QR code and the verification code the user has to pick in the mobile app
   * @throws {MobileLoginErrorCode} If the request could not be created
   */
  public async initiate(): Promise<{ qrPayload: string; verificationCode: string }> {
    try {
      const { publicKeyJwk, privateKey } = await EncryptionUtility.generateRsaKeyPairNonExtractable();
      this.privateKey = privateKey;

      const response = await this.api.rawFetch('auth/mobile-login/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientPublicKey: publicKeyJwk }),
      });

      if (!response.ok) {
        throw MobileLoginErrorCode.GENERIC;
      }

      const data = await response.json() as MobileLoginInitiateResponse;
      if (!data.requestId || !data.pollSecret) {
        throw MobileLoginErrorCode.GENERIC;
      }
      this.requestId = data.requestId;
      this.pollSecret = data.pollSecret;

      // The QR code binds the request to this key pair, the verification code is derived from the same key.
      return {
        qrPayload: MobileLoginProtocol.buildQrPayload(data.requestId, await MobileLoginProtocol.computePublicKeyHash(publicKeyJwk)),
        verificationCode: await MobileLoginProtocol.computeVerificationCode(publicKeyJwk),
      };
    } catch {
      throw MobileLoginErrorCode.GENERIC;
    }
  }

  /**
   * Poll the server until the request is approved, declined or expired. Exactly one of the callbacks is called.
   */
  public startPolling(onSuccess: (result: MobileLoginResult) => void, onError: (errorCode: MobileLoginErrorCode) => void): void {
    if (!this.requestId || !this.pollSecret || !this.privateKey) {
      throw new Error('Must call initiate() before starting polling');
    }

    /**
     * One poll round.
     */
    const pollFn = async (): Promise<void> => {
      // An approved request can be collected once, so a slow poll must never overlap with the next one.
      if (this.isPollInFlight) {
        return;
      }
      this.isPollInFlight = true;

      try {
        if (!this.requestId) {
          this.stopPolling();
          return;
        }

        const response = await this.api.rawFetch('auth/mobile-login/poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: this.requestId, pollSecret: this.pollSecret }),
        });

        if (!response.ok) {
          if (response.status === 404 || response.status === 410) {
            // Request not found (404) or expired (410).
            this.cleanup();
            onError(MobileLoginErrorCode.TIMEOUT);
            return;
          }
          throw new Error(`Polling failed: ${response.status}`);
        }

        const data = await response.json() as MobileLoginPollResponse;

        if (data.status === 'declined') {
          this.cleanup();
          onError(MobileLoginErrorCode.DECLINED);
          return;
        }

        if (data.status === 'approved' && data.encryptedSymmetricKey && data.encryptedPayload && data.encryptedAccountKey) {
          // Capture the key locally.
          const privateKey = this.privateKey!;
          this.cleanup();

          // The mobile app encrypted its stored key with our public key.
          const unlockKey = bytesToBase64(await EncryptionUtility.decryptWithPrivateKeyObject(data.encryptedAccountKey, privateKey, MobileLoginProtocol.ACCOUNT_KEY_LABEL));

          // The server encrypted the session payload with a symmetric key, which is encrypted with our public key.
          const symmetricKey = bytesToBase64(await EncryptionUtility.decryptWithPrivateKeyObject(data.encryptedSymmetricKey, privateKey, MobileLoginProtocol.PAYLOAD_KEY_LABEL));
          const payload = JSON.parse(await EncryptionUtility.symmetricDecrypt(data.encryptedPayload, symmetricKey)) as MobileLoginPayload;

          onSuccess({
            username: payload.username,
            token: payload.token,
            refreshToken: payload.refreshToken,
            unlockKey,
            salt: payload.salt,
            encryptionType: payload.encryptionType,
            encryptionSettings: payload.encryptionSettings,
          });
        }
      } catch {
        this.cleanup();
        onError(MobileLoginErrorCode.GENERIC);
      } finally {
        this.isPollInFlight = false;
      }
    };

    this.pollingInterval = setInterval(pollFn, POLL_INTERVAL_MS);
    this.pollingTimeout = setTimeout(() => {
      if (this.pollingInterval) {
        this.cleanup();
        onError(MobileLoginErrorCode.TIMEOUT);
      }
    }, POLL_TIMEOUT_MS);
  }

  /**
   * Stop polling and drop the private key reference.
   */
  public stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    if (this.pollingTimeout) {
      clearTimeout(this.pollingTimeout);
      this.pollingTimeout = null;
    }
    this.privateKey = null;
  }

  /**
   * Stop polling and forget the request.
   */
  public cleanup(): void {
    this.stopPolling();
    this.requestId = null;
    this.pollSecret = null;
  }
}
