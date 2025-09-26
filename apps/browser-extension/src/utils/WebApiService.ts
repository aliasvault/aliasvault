import type { StatusResponse, VaultResponse } from '@/utils/dist/shared/models/webapi';

import { AppInfo } from "./AppInfo";

import type { TFunction } from 'i18next';

import { storage } from '#imports';

type RequestInit = globalThis.RequestInit;

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
        const newToken = await this.refreshAccessToken();
        if (newToken) {
          headers.set('Authorization', `Bearer ${newToken}`);
          const retryResponse = await this.rawFetch(endpoint, {
            ...requestOptions,
            headers,
          });

          if (!retryResponse.ok) {
            throw new Error('Request failed after token refresh');
          }

          return parseJson ? retryResponse.json() : retryResponse as unknown as T;
        } else {
          this.logout('Your session has expired. Please login again.');
          throw new Error('Session expired');
        }
      }

      if (!response.ok && throwOnError) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return parseJson ? response.json() : response as unknown as T;
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  /**
   * Fetch data from the API without authentication headers and without access token refresh retry.
   */
  public async rawFetch(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const baseUrl = await this.getBaseUrl();
    const url = baseUrl + endpoint;
    const headers = new Headers(options.headers ?? {});

    // Add client version header
    headers.set('X-AliasVault-Client', `${AppInfo.CLIENT_NAME}-${AppInfo.VERSION}`);

    const requestOptions: RequestInit = {
      ...options,
      headers,
    };

    try {
      const response = await fetch(url, requestOptions);
      return response;
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  /**
   * Refresh the access token.
   */
  private async refreshAccessToken(): Promise<string | null> {
    const refreshToken = await this.getRefreshToken();
    if (!refreshToken) {
      return null;
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

      if (!response.ok) {
        throw new Error('Failed to refresh token');
      }

      const tokenResponse: TokenResponse = await response.json();
      this.updateTokens(tokenResponse.token, tokenResponse.refreshToken);
      return tokenResponse.token;
    } catch {
      this.logout('Your session has expired. Please login again.');
      return null;
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
   * Calls the status endpoint to check if the auth tokens are still valid, app is supported and the vault is up to date.
   */
  public async getStatus(): Promise<StatusResponse> {
    try {
      return await this.get<StatusResponse>('Auth/status');
    } catch {
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
   * Validates the vault response and returns an error message if validation fails
   */
  public validateVaultResponse(vaultResponseJson: VaultResponse, t: TFunction): string | null {
    /**
     * Status 0 = OK, vault is ready.
     * Status 1 = Merge required, which only the web client supports.
     */
    if (vaultResponseJson.status === 1) {
      // Note: vault merge is no longer allowed by the API as of 0.20.0, updates with the same revision number are rejected. So this check can be removed later.
      return t('errors.VaultOutdated');
    }

    if (vaultResponseJson.status === 2) {
      return t('errors.VaultOutdated');
    }

    return null;
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
