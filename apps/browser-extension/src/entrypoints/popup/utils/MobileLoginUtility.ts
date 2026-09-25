import { Buffer } from 'buffer';

import { MobileLoginProtocol } from '@aliasvault/client/auth/MobileLoginProtocol';
import EncryptionUtility from '@aliasvault/client/crypto/EncryptionUtility';
import { serverPredatesV2Api } from '@aliasvault/client/sync/LegacyStorageModelMigration';

import { MobileLoginErrorCode } from '@/entrypoints/popup/types/MobileLoginErrorCode';

import type { MobileLoginResult } from '@/utils/types/messaging/MobileLoginResult';

import type { WebApiService } from '@aliasvault/client/api/WebApiService';
import type { MobileLoginInitiateResponse, MobileLoginPayload, MobileLoginPollResponse } from '@aliasvault/models/webapi';

/**
 * Utility class for mobile login operations
 */
export class MobileLoginUtility {
  private webApi: WebApiService;
  private pollingInterval: NodeJS.Timeout | null = null;
  private pollingTimeout: NodeJS.Timeout | null = null;
  private isPollInFlight = false;
  private requestId: string | null = null;
  private pollSecret: string | null = null;
  private privateKey: CryptoKey | null = null;

  /**
   * Constructor for the MobileLoginUtility class.
   *
   * @param {WebApiService} webApi - The WebApiService instance.
   */
  public constructor(webApi: WebApiService) {
    this.webApi = webApi;
  }

  /**
   * Initiates a mobile login request.
   * @returns The text for the QR code and the verification code the user has to type into the mobile app
   * @throws {MobileLoginErrorCode} If initiation fails
   */
  public async initiate(): Promise<{ qrPayload: string; verificationCode: string }> {
    try {
      const { publicKeyJwk, privateKey } = await EncryptionUtility.generateRsaKeyPairNonExtractable();
      this.privateKey = privateKey;

      // Send public key to server (no auth required)
      const response = await this.webApi.rawFetch('auth/mobile-login/initiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientPublicKey: publicKeyJwk,
        }),
      });

      /*
       * A 404 on this initiating call means the v2 API is missing altogether. Only this call may read a 404 that
       * way: the poll below answers 404 for an expired request, which is a normal outcome.
       */
      if (response.status === 404 && await serverPredatesV2Api(this.webApi)) {
        throw MobileLoginErrorCode.SERVER_OUTDATED;
      }

      if (!response.ok) {
        throw MobileLoginErrorCode.GENERIC;
      }

      const data = await response.json() as MobileLoginInitiateResponse;
      if (!data.requestId || !data.pollSecret) {
        // A server without the poll secret still runs the old handshake, which this client no longer takes part in.
        throw MobileLoginErrorCode.SERVER_OUTDATED;
      }
      this.requestId = data.requestId;
      this.pollSecret = data.pollSecret;

      // The QR code binds the request to this key pair, the verification code is derived from the same key.
      return {
        qrPayload: MobileLoginProtocol.buildQrPayload(data.requestId, await MobileLoginProtocol.computePublicKeyHash(publicKeyJwk)),
        verificationCode: await MobileLoginProtocol.computeVerificationCode(publicKeyJwk),
      };
    } catch (error) {
      if (typeof error === 'string' && Object.values(MobileLoginErrorCode).includes(error as MobileLoginErrorCode)) {
        throw error;
      }
      throw MobileLoginErrorCode.GENERIC;
    }
  }

  /**
   * Starts polling the server for mobile login response
   */
  public async startPolling(
    onSuccess: (result: MobileLoginResult) => void,
    onError: (errorCode: MobileLoginErrorCode) => void
  ): Promise<void> {
    if (!this.requestId || !this.pollSecret || !this.privateKey) {
      throw new Error('Must call initiate() before starting polling');
    }

    /**
     * Polls the server for mobile login response
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

        const response = await this.webApi.rawFetch('auth/mobile-login/poll', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requestId: this.requestId,
            pollSecret: this.pollSecret,
          }),
        });

        if (!response.ok) {
          if (response.status === 404) {
            // Request expired or not found
            this.cleanup();
            onError(MobileLoginErrorCode.TIMEOUT);
            return;
          }
          throw new Error(`Polling failed: ${response.status}`);
        }

        const data = await response.json() as MobileLoginPollResponse;

        if (data.status === 'Declined') {
          this.cleanup();
          onError(MobileLoginErrorCode.DECLINED);
          return;
        }

        if (data.status === 'Approved' && data.encryptedSymmetricKey && data.encryptedPayload && data.encryptedUnlockKey) {
          // Capture key locally; cleanup() nulls the field.
          const privateKey = this.privateKey!;
          this.cleanup();

          // The mobile app encrypted the unlock key with our public key
          const unlockKeyBytes = await EncryptionUtility.decryptWithPrivateKeyObject(data.encryptedUnlockKey, privateKey);
          const unlockKey = Buffer.from(unlockKeyBytes).toString('base64');

          // The server encrypted the session payload with a symmetric key, which is encrypted with our public key
          const symmetricKeyBytes = await EncryptionUtility.decryptWithPrivateKeyObject(data.encryptedSymmetricKey, privateKey);
          const symmetricKey = Buffer.from(symmetricKeyBytes).toString('base64');
          const payload = JSON.parse(await EncryptionUtility.symmetricDecrypt(data.encryptedPayload, symmetricKey)) as MobileLoginPayload;

          onSuccess({
            username: payload.username,
            token: payload.token,
            refreshToken: payload.refreshToken,
            unlockKey: unlockKey,
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

    // Poll every 3 seconds
    this.pollingInterval = setInterval(pollFn, 3000);

    // Stop polling after 3.5 minutes (adds 1.5 minute buffer to default 2 minute timer for edge cases)
    this.pollingTimeout = setTimeout(() => {
      if (this.pollingInterval) {
        this.cleanup();
        onError(MobileLoginErrorCode.TIMEOUT);
      }
    }, 210000);
  }

  /**
   * Stops polling the server and drops the private key reference.
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
   * Cleans up resources
   */
  public cleanup(): void {
    this.stopPolling();
    this.requestId = null;
    this.pollSecret = null;
  }
}
