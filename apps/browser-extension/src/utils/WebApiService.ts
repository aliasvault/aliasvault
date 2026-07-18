import type { StatusResponse } from '@/utils/dist/core/models/webapi';

import { logoutEventEmitter } from '@/events/LogoutEventEmitter';

import { AppInfo } from "./AppInfo";
import { ApiAuthError } from './types/errors/ApiAuthError';
import { ApiRequestError } from './types/errors/ApiRequestError';
import { NetworkError } from './types/errors/NetworkError';
import { PayloadTooLargeError } from './types/errors/PayloadTooLargeError';
import { RequestTimeoutError } from './types/errors/RequestTimeoutError';

import { storage } from '#imports';

type RequestInit = globalThis.RequestInit;

/**
 * Total request timeout for lightweight API calls (status checks, auth, etc.). Kept short so the
 * popup falls back to offline mode quickly when the server is unreachable.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

/**
 * Total request timeout for vault download/upload, which can carry a large encrypted blob.
 */
const VAULT_TRANSFER_TIMEOUT_MS = 180000;

/**
 * Type for the token response from the API.
 */
type TokenResponse = {
  token: string;
  refreshToken: string;
}

/**
 * Service class for interacting with the web API.
 */
export class WebApiService {
  /**
   * Get the base URL for the API from settings.
   */
  private async getBaseUrl(): Promise<string> {
    const apiUrl = await this.getApiUrl();
    return apiUrl.replace(/\/$/, '') + '/v1/';
  }

  /**
   * Check if the current server is self-hosted.
   */
  public async isSelfHosted(): Promise<boolean> {
    const apiUrl = await this.getApiUrl();
    return apiUrl !== AppInfo.DEFAULT_API_URL;
  }

  /**
   * Fetch data from the API with authentication headers and access token refresh retry.
   */
  public async authFetch<T>(
    endpoint: string,
    options: RequestInit = {},
    parseJson: boolean = true,
    throwOnError: boolean = true
  ): Promise<T> {
    const headers = new Headers(options.headers ?? {});

    // Add authorization header if we have an access token
    const accessToken = await this.getAccessToken();
    if (accessToken) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }

    const requestOptions: RequestInit = {
      ...options,
      headers,
    };

    try {
      const response = await this.rawFetch(endpoint, requestOptions);

      if (response.status === 401) {
        const refreshResult = await this.refreshAccessToken();

        if (refreshResult.token) {
          // Token refresh succeeded - retry the request
          headers.set('Authorization', `Bearer ${refreshResult.token}`);
          const retryResponse = await this.rawFetch(endpoint, {
            ...requestOptions,
            headers,
          });

          if (!retryResponse.ok) {
            // Only auth failures after a successful token refresh mean the session is invalid.
            if (retryResponse.status === 401 || retryResponse.status === 403) {
              throw new ApiAuthError('Request failed after token refresh');
            }
            if (retryResponse.status === 413) {
              throw new PayloadTooLargeError(`Request rejected with HTTP 413: payload exceeds server limit`);
            }
            throw new ApiRequestError(retryResponse.status, await this.extractApiErrorCode(retryResponse));
          }

          return parseJson ? retryResponse.json() : retryResponse as unknown as T;
        } else if (refreshResult.isAuthError) {
          // Token refresh failed due to auth error (401/403) - session is truly expired
          logoutEventEmitter.emit('common.errors.sessionExpired');
          throw new ApiAuthError('Session expired');
        } else {
          // Token refresh failed due to network/server error - throw NetworkError for offline handling
          throw new NetworkError('Token refresh failed due to network error');
        }
      }

      if (response.status === 413 && throwOnError) {
        throw new PayloadTooLargeError(`Request rejected with HTTP 413: payload exceeds server limit`);
      }

      if (!response.ok && throwOnError) {
        throw new ApiRequestError(response.status, await this.extractApiErrorCode(response));
      }

      return parseJson ? response.json() : response as unknown as T;
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  /**
   * Extract the structured API error code (e.g. "VAULT_NOT_UP_TO_DATE") from an error response body.
   */
  private async extractApiErrorCode(response: Response): Promise<string | null> {
    try {
      const body = await response.clone().json() as { code?: unknown; title?: unknown };
      for (const value of [body.code, body.title]) {
        // Server error codes are uppercase enum names
        if (typeof value === 'string' && /^[A-Z0-9_]{2,64}$/.test(value)) {
          return value;
        }
      }
    } catch {
      // Body is empty or not JSON (e.g. proxy error page).
    }
    return null;
  }

  /**
   * Fetch data from the API without authentication headers and without access token refresh retry.
   * Throws RequestTimeoutError when the request exceeds its timeout, and NetworkError for other
   * network-related failures (offline, DNS, etc.)
   */
  public async rawFetch(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const baseUrl = await this.getBaseUrl();
    const url = baseUrl + endpoint;
    const headers = new Headers(options.headers ?? {});

    // Add client version header (using API_VERSION for server compatibility)
    headers.set('X-AliasVault-Client', `${AppInfo.CLIENT_NAME}-${AppInfo.API_VERSION}`);

    const requestOptions: RequestInit = {
      ...options,
      headers,
      signal: this.buildTimeoutSignal(endpoint, headers, options.signal),
    };

    try {
      const response = await fetch(url, requestOptions);
      return response;
    } catch (error) {
      console.error('API request failed:', error);
      /*
       * The timeout signal aborts with a DOMException; no caller passes its own abort signal,
       * so any abort here means the request exceeded its timeout.
       */
      if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new RequestTimeoutError(`Request timed out: ${endpoint}`, error);
      }
      // Convert fetch errors to NetworkError for proper error handling
      throw new NetworkError(
        error instanceof Error ? error.message : 'Network request failed',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Build an AbortSignal that bounds how long a request can run, combined with any caller-supplied
   * signal.
   */
  private buildTimeoutSignal(endpoint: string, headers: Headers, callerSignal?: AbortSignal | null): AbortSignal {
    const path = endpoint.split('?')[0].replace(/^\/+|\/+$/g, '').toLowerCase();
    const isLargeTransfer = path === 'vault' ||
      (headers.get('Accept') ?? '').toLowerCase().includes('application/octet-stream');
    const timeoutSignal = AbortSignal.timeout(
      isLargeTransfer ? VAULT_TRANSFER_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS
    );
    return callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
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
   * This revokes all tokens for the current device.
   */
  public async revokeTokens(): Promise<void> {
    // Revoke tokens via WebApi.
    try {
      const refreshToken = await this.getRefreshToken();
      if (refreshToken) {
        await this.post('Auth/revoke', {
          token: await this.getAccessToken(),
          refreshToken: refreshToken,
        }, false);
      }
    } catch (err) {
      console.error('WebApi revoke tokens error:', err);
    }
  }

  /**
   * Revoke only the current specific token via WebApi.
   * Unlike revokeTokens(), this does NOT revoke other sessions for the same device.
   * Used for mobile unlock flow where we want to replace the current session without
   * affecting other browser sessions.
   */
  public async revokeCurrentTokens(): Promise<void> {
    try {
      const refreshToken = await this.getRefreshToken();
      if (refreshToken) {
        await this.post('Auth/revoke-token', {
          token: await this.getAccessToken(),
          refreshToken: refreshToken,
        }, false);
      }
    } catch (err) {
      console.error('WebApi revoke current token error:', err);
    }
  }

  /**
   * Calls the status endpoint to check if the auth tokens are still valid, app is supported and the vault is up to date.
   * Returns offline indicator (serverVersion: '0.0.0') for network failures and server errors (5xx, 404, etc.).
   * Auth errors (ApiAuthError) are re-thrown to be handled appropriately (e.g., trigger logout).
   */
  public async getStatus(): Promise<StatusResponse> {
    try {
      const status = await this.get<StatusResponse>('Auth/status');
      // Persist the server version so it can be shown on the settings page, also while offline.
      if (status.serverVersion && status.serverVersion !== '0.0.0') {
        await storage.setItem('local:serverVersion', status.serverVersion);
      }
      return status;
    } catch (error) {
      /**
       * Only re-throw ApiAuthError (session expired, auth failures).
       * All other errors (NetworkError, HTTP 5xx, 404, etc.) indicate the server
       * is unreachable or misconfigured, so return offline indicator.
       */
      if (error instanceof ApiAuthError) {
        throw error;
      }
      return {
        clientVersionSupported: true,
        serverVersion: '0.0.0',
        vaultRevision: 0,
        srpSalt: ''
      };
    }
  }

  /**
   * Validates the status response and returns an error message (as translation key) if validation fails.
   */
  public validateStatusResponse(statusResponse: StatusResponse): string | null {
    if (!statusResponse.clientVersionSupported) {
      return 'clientVersionNotSupported';
    }

    if (!AppInfo.isServerVersionSupported(statusResponse.serverVersion)) {
      return 'serverVersionNotSupported';
    }

    return null;
  }

  /**
   * Result of a token refresh attempt.
   * - token: New access token if refresh succeeded
   * - isAuthError: True if refresh failed due to auth error (401/403), meaning session is truly expired
   *                False if refresh failed due to network/server error, meaning we should enter offline mode
   */
  private async refreshAccessToken(): Promise<{ token: string | null; isAuthError: boolean }> {
    const refreshToken = await this.getRefreshToken();
    if (!refreshToken) {
      // No refresh token means session is truly expired
      return { token: null, isAuthError: true };
    }

    try {
      const response = await this.rawFetch('Auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ignore-Failure': 'true',
        },
        body: JSON.stringify({
          token: await this.getAccessToken(),
          refreshToken: refreshToken,
        }),
      });

      if (response.ok) {
        const tokenResponse: TokenResponse = await response.json();
        this.updateTokens(tokenResponse.token, tokenResponse.refreshToken);
        return { token: tokenResponse.token, isAuthError: false };
      }

      // Auth errors (401/403) mean session is truly expired
      if (response.status === 401 || response.status === 403) {
        return { token: null, isAuthError: true };
      }

      // Server errors (5xx) or other non-auth errors, treat as offline/transient
      console.warn(`Token refresh failed with status ${response.status}, treating as offline`);
      return { token: null, isAuthError: false };
    } catch (error) {
      // Network errors (server unreachable, timeout, DNS, etc.), treat as offline
      if (error instanceof NetworkError) {
        console.warn('Token refresh failed due to network error, treating as offline');
        return { token: null, isAuthError: false };
      }

      // Unexpected errors, treat as auth error so logout is triggered
      console.error('Unexpected error during token refresh:', error);
      return { token: null, isAuthError: true };
    }
  }

  /**
   * Get the current access token from storage.
   */
  private async getAccessToken(): Promise<string | null> {
    const token = await storage.getItem('local:accessToken') as string;
    return token ?? null;
  }

  /**
   * Get the current refresh token from storage.
   */
  private async getRefreshToken(): Promise<string | null> {
    const token = await storage.getItem('local:refreshToken') as string;
    return token ?? null;
  }

  /**
   * Update both access and refresh tokens in storage.
   */
  private async updateTokens(accessToken: string, refreshToken: string): Promise<void> {
    await storage.setItem('local:accessToken', accessToken);
    await storage.setItem('local:refreshToken', refreshToken);
  }

  /**
   * Get the API URL from settings.
   */
  private async getApiUrl(): Promise<string> {
    const result = await storage.getItem('local:apiUrl') as string;
    if (!result || result.length === 0) {
      return AppInfo.DEFAULT_API_URL;
    }

    return result;
  }
}
