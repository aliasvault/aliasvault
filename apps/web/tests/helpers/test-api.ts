/**
 * Direct API calls used by the E2E suite outside the browser.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

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
 * Request header with which the API (DEBUG build in Development) handles that request as if public registration is disabled.
 */
export const TEST_DISABLE_PUBLIC_REGISTRATION_HEADER = 'X-AliasVault-Test-Disable-Public-Registration';

/**
 * Create a registration invite via the DEBUG-only test controller, as the admin panel would.
 * @returns The invite code
 */
export async function createRegistrationInvite(apiUrl: string, maxUses = 1): Promise<string> {
  const url = `${apiUrl}/v2/Test/registration-invites?maxUses=${maxUses}`;
  const response = await fetch(url, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`Failed to create a registration invite via ${url} (status ${response.status}). The test controller only exists in DEBUG builds running with ASPNETCORE_ENVIRONMENT=Development.`);
  }
  return ((await response.json()) as { code: string }).code;
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

/**
 * A vault written by an old client, with the login material of that time (core/test-fixtures/legacy-vaults).
 */
export type LegacyVaultFixture = {
  password: string;
  expectedItemNames: string[];
  vault: Record<string, unknown>;
};

/**
 * Read a legacy vault fixture by the client version that wrote it, e.g. "1.0.0".
 */
export function readLegacyVaultFixture(version: string): LegacyVaultFixture {
  const fixturePath = path.resolve(import.meta.dirname, '..', '..', '..', '..', 'core', 'test-fixtures', 'legacy-vaults', `${version}.json`);
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as LegacyVaultFixture;
}

/**
 * Turn an account into one that predates the unlock-key model and holds the given legacy vault, via the DEBUG-only
 * test controller. Afterwards the account logs in with the fixture's password.
 */
export async function restoreLegacyVault(apiUrl: string, username: string, fixture: LegacyVaultFixture): Promise<void> {
  const url = `${apiUrl}/v2/Test/legacy-vault/by-username/${encodeURIComponent(username)}`;
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fixture.vault) });
  if (!response.ok) {
    throw new Error(`Restoring the legacy vault via ${url} failed with status ${response.status}: ${await response.text()}`);
  }
}

/**
 * Call a TwoFactorAuth endpoint directly with the given access token.
 */
export async function postTwoFactorAuth(apiUrl: string, token: string, action: 'enable' | 'verify' | 'disable', body?: string): Promise<Response> {
  return fetch(`${WebApiService.versionedBaseUrl(apiUrl)}TwoFactorAuth/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
