/**
 * Direct API calls used by the E2E suite outside the browser.
 */

import { WebApiService } from '@aliasvault/client/api/WebApiService';
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
 * Register an account via the API, skipping the setup wizard. The first login writes its empty vault.
 */
export async function createTestUser(apiUrl: string): Promise<{ username: string; password: string }> {
  const username = generateTestUsername();
  const baseUrl = WebApiService.versionedBaseUrl(apiUrl);
  const api = {
    /**
     * Send an auth request straight to the API.
     */
    rawFetch: (endpoint: string, options?: RequestInit): Promise<Response> => fetch(`${baseUrl}${endpoint}`, options),
  };
  await new SrpLoginService(api).register(username, TEST_PASSWORD);
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
