/**
 * Direct API calls used by the E2E suite outside the browser.
 */

import { WebApiService } from '@aliasvault/client/api/WebApiService';
import { SrpAuthService } from '@aliasvault/client/auth/SrpAuthService';
import { SrpLoginService } from '@aliasvault/client/auth/SrpLoginService';

import './client-platform';

/**
 * Fixed test password, so a developer can log in to a test account by hand during a paused run.
 */
export const TEST_PASSWORD = 'TestPass_e2e_dev!';

/**
 * A random, unused test username.
 */
export function generateTestUsername(): string {
  const randomPart = Math.random().toString(36).substring(2, 12);
  return `test_${randomPart}@example.tld`;
}

/**
 * An account registered via the API, with the session and key a test needs to reach its vault directly.
 */
export type TestUser = {
  username: string;
  password: string;
  token: string;
  vaultEncryptionKey: string;
};

/**
 * Register an account via the API, skipping the setup wizard. The first login writes its empty vault.
 */
export async function createTestUser(apiUrl: string): Promise<TestUser> {
  const username = generateTestUsername();
  const baseUrl = WebApiService.versionedBaseUrl(apiUrl);
  const api = {
    /**
     * Send an auth request straight to the API.
     */
    rawFetch: (endpoint: string, options?: RequestInit): Promise<Response> => fetch(`${baseUrl}${endpoint}`, options),
  };
  const { token, keys } = await new SrpLoginService(api).register(username, TEST_PASSWORD);
  return { username, password: TEST_PASSWORD, token: token.token, vaultEncryptionKey: keys.vaultEncryptionKey };
}

/**
 * Register an account whose server key chain is damaged: the password opens the account key, but the vault
 * encryption key stored under it does not decrypt.
 */
export async function createTestUserWithDamagedKeyChain(apiUrl: string): Promise<{ username: string; password: string }> {
  const username = generateTestUsername();
  const prepared = await SrpAuthService.prepareRegistration(username, TEST_PASSWORD);
  const encryptedVek = Buffer.from(prepared.request.encryptedVek, 'base64');
  encryptedVek[encryptedVek.length - 1] ^= 0xff;
  const request = { ...prepared.request, encryptedVek: encryptedVek.toString('base64') };

  const response = await fetch(`${WebApiService.versionedBaseUrl(apiUrl)}Auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(`Register failed with status ${response.status}: ${await response.text()}`);
  }
  return { username, password: TEST_PASSWORD };
}

/**
 * Whether the API answers; the status endpoint returns 401 without a session, which still means it is up.
 */
export async function isApiAvailable(apiUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${apiUrl}/v2/Status`);
    return response.status === 401 || response.ok;
  } catch {
    return false;
  }
}

/**
 * Set a server setting via the DEBUG-only test controller.
 */
export async function setServerSetting(apiUrl: string, key: string, value: string): Promise<void> {
  const url = `${apiUrl}/v2/Test/server-settings`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });

  if (!response.ok) {
    throw new Error(`Failed to set server setting "${key}" via ${url} (status ${response.status}). The test controller only exists in DEBUG builds running with ASPNETCORE_ENVIRONMENT=Development.`);
  }
}
