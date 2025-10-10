import AsyncStorage from '@react-native-async-storage/async-storage';

import { AppInfo } from '@/utils/AppInfo';
import type { StatusResponse, VaultResponse, AuthLogModel, RefreshToken } from '@/utils/dist/shared/models/webapi';

import i18n from '@/i18n';

import { LocalAuthError } from './types/errors/LocalAuthError';
import { logoutEventEmitter } from '@/events/LogoutEventEmitter';
import NativeVaultManager from '@/specs/NativeVaultManager';

type RequestInit = globalThis.RequestInit;

/**
 * Type for the token response from the API.
 */
type TokenResponse = {
  token: string;
  refreshToken: string;
}

/**
 * Type for the native WebAPI response.
 */
type NativeWebApiResponse = {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

/**
 * Service class for interacting with the web API.
 * This class now acts as a proxy to the native layer, where all WebAPI calls are executed.
 */
export class WebApiService {
  /**
   * Constructor for the WebApiService class.
   */
  public constructor() {
    // Initialize API URL and tokens from AsyncStorage if they exist
    this.syncLegacyConfigToNative();
  }

  /**
   * Get the base URL for the API from settings.
   */
  public async getBaseUrl(): Promise<string> {
    const apiUrl = await this.getApiUrl();
    return apiUrl.replace(/\/$/, '') + '/v1/';
  }

  /**
   * Check if the API URL is for a self-hosted instance.
   */
  public async isSelfHosted(): Promise<boolean> {
    const apiUrl = await this.getApiUrl();

    // If the currently configured API URL is not the default, it's a self-hosted instance.
    return apiUrl !== AppInfo.DEFAULT_API_URL;
  }

  /**
   * Fetch data from the API with authentication headers and access token refresh retry.
   * This method now proxies to the native layer which handles auth and token refresh.
   */
  public async authFetch<T>(
    endpoint: string,
    options: RequestInit = {},
    parseJson: boolean = true,
    throwOnError: boolean = true
  ): Promise<T> {
    try {
      const method = options.method || 'GET';
      const headers: Record<string, string> = {};

      // Extract headers from options
      if (options.headers) {
        if (options.headers instanceof Headers) {
          options.headers.forEach((value, key) => {
            headers[key] = value;
          });
        } else if (Array.isArray(options.headers)) {
          options.headers.forEach(([key, value]) => {
            headers[key] = value;
          });
        } else {
          Object.assign(headers, options.headers);
        }
      }

      // Execute request through native layer with auth
      const responseJson = await NativeVaultManager.executeWebApiRequest(
        method,
        endpoint,
        options.body as string | null ?? null,
        JSON.stringify(headers),
        true // requiresAuth
      );

      const response: NativeWebApiResponse = JSON.parse(responseJson);

      // Handle 401 specially to trigger session expired
      if (response.statusCode === 401) {
        logoutEventEmitter.emit('auth.errors.sessionExpired');
        throw new Error(i18n.t('auth.errors.sessionExpired'));
      }

      if (response.statusCode >= 400 && throwOnError) {
        throw new Error(i18n.t('auth.errors.httpError', { status: response.statusCode }));
      }

      // Parse response body if requested
      if (parseJson && response.body) {
        return JSON.parse(response.body) as T;
      }

      // Return raw response as object with status for non-JSON responses
      return { status: response.statusCode, ...response } as unknown as T;
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  /**
   * Fetch data from the API without authentication headers and without access token refresh retry.
   * This method now proxies to the native layer.
   */
  public async rawFetch(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<Response> {
    try {
      const method = options.method || 'GET';
      const headers: Record<string, string> = {};

      // Extract headers from options
      if (options.headers) {
        if (options.headers instanceof Headers) {
          options.headers.forEach((value, key) => {
            headers[key] = value;
          });
        } else if (Array.isArray(options.headers)) {
          options.headers.forEach(([key, value]) => {
            headers[key] = value;
          });
        } else {
          Object.assign(headers, options.headers);
        }
      }

      // Execute request through native layer without auth
      const responseJson = await NativeVaultManager.executeWebApiRequest(
        method,
        endpoint,
        options.body as string | null ?? null,
        JSON.stringify(headers),
        false // requiresAuth = false
      );

      const nativeResponse: NativeWebApiResponse = JSON.parse(responseJson);

      // Convert native response to Response object
      const responseInit: ResponseInit = {
        status: nativeResponse.statusCode,
        statusText: nativeResponse.statusCode >= 200 && nativeResponse.statusCode < 300 ? 'OK' : 'Error',
        headers: nativeResponse.headers,
      };

      return new Response(nativeResponse.body, responseInit);
    } catch (error) {
      console.error('API request failed:', error);

      // Detect SSL certificate errors
      if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase();

        // Common SSL/TLS error patterns on iOS and Android
        if (errorMessage.includes('ssl') ||
            errorMessage.includes('tls') ||
            errorMessage.includes('cert') ||
            errorMessage.includes('trust') ||
            errorMessage.includes('self-signed') ||
            errorMessage.includes('ca') ||
            errorMessage.includes('network request failed')) {

          // Check if this is a self-hosted instance
          const isSelfHosted = await this.isSelfHosted();

          if (isSelfHosted) {
            // For self-hosted instances, throw error with translation key
            throw new LocalAuthError(i18n.t('auth.errors.networkErrorSelfHosted'));
          } else {
            // For the default API URL, throw error with translation key
            throw new LocalAuthError(i18n.t('auth.errors.networkError'));
          }
        }
      }

      // Re-throw the original error if it's not SSL-related
      throw error;
    }
  }

  /**
   * Issue GET request to the API.
   */
  public async get<T>(endpoint: string): Promise<T> {
    return this.authFetch<T>(endpoint, { method: 'GET' });
  }

  /**
   * Issue GET request to the API expecting a file download and return it as raw bytes.
   */
  public async downloadBlob(endpoint: string): Promise<Uint8Array> {
    try {
      const response = await this.authFetch<Response>(endpoint, {
        method: 'GET',
        headers: {
          'Accept': 'application/octet-stream',
        }
      }, false);

      // Get the response as an ArrayBuffer
      const arrayBuffer = await response.arrayBuffer();
      return new Uint8Array(arrayBuffer);
    } catch (error) {
      console.error('Error downloading blob:', error);
      throw error;
    }
  }

  /**
   * Issue POST request to the API.
   */
  public async post<TRequest, TResponse>(
    endpoint: string,
    data: TRequest,
    parseJson: boolean = true
  ): Promise<TResponse> {
    return this.authFetch<TResponse>(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    }, parseJson);
  }

  /**
   * Issue PUT request to the API.
   */
  public async put<TRequest, TResponse>(endpoint: string, data: TRequest): Promise<TResponse> {
    return this.authFetch<TResponse>(endpoint, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
  }

  /**
   * Issue DELETE request to the API.
   */
  public async delete<T>(endpoint: string): Promise<T> {
    return this.authFetch<T>(endpoint, { method: 'DELETE' }, false);
  }

  /**
   * Revoke tokens via WebApi called when logging out.
   * This is now fully handled by the native layer to ensure token consistency.
   */
  public async revokeTokens(): Promise<void> {
    try {
      // Delegate to native layer which handles token revocation and cleanup
      await NativeVaultManager.revokeTokens();
    } catch (err) {
      console.error('WebApi revoke tokens error:', err);
    }
  }

  /**
   * Calls the status endpoint to check if the auth tokens are still valid, app is supported and the vault is up to date.
   */
  public async getStatus(): Promise<StatusResponse> {
    try {
      return await this.get<StatusResponse>('Auth/status');
    } catch (error) {
      if (error instanceof Error && error.message.includes('expired')) {
        /**
         * If session expired, logout the user immediately as otherwise this would
         * trigger a server offline banner.
         */
        logoutEventEmitter.emit('auth.errors.sessionExpired');
        throw error;
      }

      /**
       * If the status endpoint is not available, return a default status response which will trigger
       * a logout and error message.
       */
      return {
        clientVersionSupported: true,
        serverVersion: '0.0.0',
        vaultRevision: 0,
        srpSalt: ''
      };
    }
  }

  /**
   * Get the active sessions (logged in devices) for the current user from the server.
   */
  public async getActiveSessions(): Promise<RefreshToken[]> {
    return this.get<RefreshToken[]>('Security/sessions');
  }

  /**
   * Revoke a session (logged in device) for the current user on the server.
   */
  public async revokeSession(sessionId: string): Promise<void> {
    return this.delete<void>('Security/sessions/' + sessionId);
  }

  /**
   * Get the auth logs for the current user from the server.
   */
  public async getAuthLogs(): Promise<AuthLogModel[]> {
    return this.get<AuthLogModel[]>('Security/authlogs');
  }

  /**
   * Validates the vault response and returns an error message if validation fails
   */
  public validateVaultResponse(vaultResponseJson: VaultResponse): string | null {
    /**
     * Status 0 = OK, vault is ready.
     * Status 1 = Merge required, which only the web client supports.
     * Status 2 = Outdated, which means the local vault is outdated and the client should fetch the latest vault from the server before saving can continue.
     */
    if (vaultResponseJson.status === 1) {
      // Note: vault merge is no longer allowed by the API as of 0.20.0, updates with the same revision number are rejected. So this check can be removed later.
      return i18n.t('vault.errors.vaultOutdated');
    }

    if (vaultResponseJson.status === 2) {
      return i18n.t('vault.errors.vaultOutdated');
    }

    return null;
  }

  /**
   * Get the currently configured API URL from native storage.
   */
  private async getApiUrl(): Promise<string> {
    try {
      const apiUrl = await NativeVaultManager.getApiUrl();
      return apiUrl || AppInfo.DEFAULT_API_URL;
    } catch (error) {
      console.error('Failed to get API URL from native layer:', error);
      // Fallback to AsyncStorage
      const result = await AsyncStorage.getItem('apiUrl') as string;
      if (result && result.length > 0) {
        return result;
      }
      return AppInfo.DEFAULT_API_URL;
    }
  }

  /**
   * Sync configuration from AsyncStorage to native layer on initialization.
   *
   * This is primarily for backward compatibility / migration purposes:
   * - Existing users who upgraded from a version without native WebAPI will have tokens in AsyncStorage
   * - This ensures those tokens are migrated to the native layer on first launch after upgrade
   * - For new installations, all tokens/config go directly to native layer, so this becomes a no-op
   *
   * TODO: This can be removed in a future version (e.g., after some time that 0.24.0 is released)
   * and once most if not all active users have migrated.
   */
    private async syncLegacyConfigToNative(): Promise<void> {
      try {
        // Sync API URL from AsyncStorage to native (migration only)
        const apiUrl = await AsyncStorage.getItem('apiUrl');
        if (apiUrl) {
          await NativeVaultManager.setApiUrl(apiUrl);
        }

        // Sync tokens from AsyncStorage to native (migration only)
        const accessToken = await AsyncStorage.getItem('accessToken');
        const refreshToken = await AsyncStorage.getItem('refreshToken');
        if (accessToken && refreshToken) {
          await NativeVaultManager.setAuthTokens(accessToken, refreshToken);
        }
      } catch (error) {
        console.error('Failed to sync config to native layer:', error);
      }
    }
}
