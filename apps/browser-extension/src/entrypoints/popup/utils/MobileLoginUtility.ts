import { Buffer } from 'buffer';

import { MobileLoginErrorCode } from '@/entrypoints/popup/types/MobileLoginErrorCode';

import type { LoginResponse, MobileLoginInitiateResponse, MobileLoginPollResponse } from '@/utils/dist/core/models/webapi';
import EncryptionUtility from '@/utils/EncryptionUtility';
import type { MobileLoginResult } from '@/utils/types/messaging/MobileLoginResult';
import type { WebApiService } from '@/utils/WebApiService';

/**
 * Utility class for mobile login operations
 */
export class MobileLoginUtility {
  private webApi: WebApiService;
  private pollingInterval: NodeJS.Timeout | null = null;
  private requestId: string | null = null;
  private privateKey: string | null = null;
  private publicKeyHash: string | null = null;

  /**
   * Constructor for the MobileLoginUtility class.
   *
   * @param {WebApiService} webApi - The WebApiService instance.
   */
  public constructor(webApi: WebApiService) {
    this.webApi = webApi;
  }

  /**
   * Computes a SHA-256 hash of the public key and returns the first 16 characters.
   */
  private async computePublicKeyHash(publicKey: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(publicKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    // Return first 16 characters for a compact but secure fingerprint
    return hashHex.substring(0, 16);
  }

  /**
   * Initiates a mobile login request and returns the QR code data
   * @returns Object containing requestId and publicKeyHash for QR code generation
   * @throws {MobileLoginErrorCode} If initiation fails
   */
  public async initiate(): Promise<{ requestId: string; publicKeyHash: string }> {
    try {
      // Generate RSA key pair
      const keyPair = await EncryptionUtility.generateRsaKeyPair();
      this.privateKey = keyPair.privateKey;

      // Compute hash of public key for QR code binding
      this.publicKeyHash = await this.computePublicKeyHash(keyPair.publicKey);

      // Send public key to server (no auth required)
      const response = await this.webApi.rawFetch('auth/mobile-login/initiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientPublicKey: keyPair.publicKey,
        }),
      });

      if (!response.ok) {
        throw MobileLoginErrorCode.GENERIC;
      }

      const data = await response.json() as MobileLoginInitiateResponse;
      this.requestId = data.requestId;

      // Return QR code data (request ID and public key hash)
      return {
        requestId: this.requestId,
        publicKeyHash: this.publicKeyHash,
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
    if (!this.requestId || !this.privateKey) {
      throw new Error('Must call initiate() before starting polling');
    }

    /**
     * Polls the server for mobile login response
     */
    const pollFn = async (): Promise<void> => {
      try {
        if (!this.requestId) {
          this.stopPolling();
          return;
        }

        const response = await this.webApi.rawFetch(
          `auth/mobile-login/poll/${this.requestId}`,
          {
            method: 'GET',
          }
        );

        if (!response.ok) {
          if (response.status === 404) {
            // Request expired or not found
            this.stopPolling();
            this.privateKey = null;
            this.requestId = null;
            onError(MobileLoginErrorCode.TIMEOUT);
            return;
          }
          throw new Error(`Polling failed: ${response.status}`);
        }

        const data = await response.json() as MobileLoginPollResponse;

        if (data.fulfilled && data.encryptedSymmetricKey) {
          // Stop polling
          this.stopPolling();

          // Decrypt the encrypted decryption key with RSA private key
          const decryptionKeyBytes = await EncryptionUtility.decryptWithPrivateKey(data.encryptedDecryptionKey!, this.privateKey!);
          const decryptionKey = Buffer.from(decryptionKeyBytes).toString('base64');

          // Decrypt the other encrypted fields with the symmetric key
          const symmetricKeyBytes = await EncryptionUtility.decryptWithPrivateKey(data.encryptedSymmetricKey, this.privateKey!);
          const symmetricKey = Buffer.from(symmetricKeyBytes).toString('base64');

          const token = await EncryptionUtility.symmetricDecrypt(data.encryptedToken!, symmetricKey);
          const refreshToken = await EncryptionUtility.symmetricDecrypt(data.encryptedRefreshToken!, symmetricKey);
          const username = await EncryptionUtility.symmetricDecrypt(data.encryptedUsername!, symmetricKey);

          // Clear sensitive data
          this.privateKey = null;
          this.requestId = null;

          // Call /login endpoint with username to get salt and encryption settings
          const loginResponse = await this.webApi.rawFetch('auth/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              username,
            }),
          });

          if (!loginResponse.ok) {
            onError(MobileLoginErrorCode.GENERIC);
            return;
          }

          const loginData = await loginResponse.json() as LoginResponse;

          // Create result object using the MobileLoginResult type
          const result: MobileLoginResult = {
            username: username,
            token: token,
            refreshToken: refreshToken,
            decryptionKey: decryptionKey,
            salt: loginData.salt,
            encryptionType: loginData.encryptionType,
            encryptionSettings: loginData.encryptionSettings,
          };

          // Call success callback with result object
          onSuccess(result);

        }
      } catch {
        this.stopPolling();
        this.privateKey = null;
        this.requestId = null;
        onError(MobileLoginErrorCode.GENERIC);
      }
    };

    // Poll every 3 seconds
    this.pollingInterval = setInterval(pollFn, 3000);

    // Stop polling after 3.5 minutes (adds 1.5 minute buffer to default 2 minute timer for edge cases)
    setTimeout(() => {
      if (this.pollingInterval) {
        this.stopPolling();
        this.privateKey = null;
        this.requestId = null;
        onError(MobileLoginErrorCode.TIMEOUT);
      }
    }, 210000);
  }

  /**
   * Stops polling the server
   */
  public stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Cleans up resources
   */
  public cleanup(): void {
    this.stopPolling();
    this.privateKey = null;
    this.requestId = null;
    this.publicKeyHash = null;
  }
}
