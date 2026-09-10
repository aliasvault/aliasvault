/**
 * Test API utilities for E2E tests.
 *
 * This module provides utilities for interacting with the AliasVault API during E2E tests.
 */

import { SrpAuthService } from '@aliasvault/client/auth/SrpAuthService';
import { base64ToBytes } from '@aliasvault/client/utilities/Base64';
import * as OTPAuth from 'otpauth';

import { pushInitialVault } from './manifest-v2-api';

import './client-platform';

import type { TokenModel } from '@aliasvault/models/webapi';

/**
 * Test user credentials.
 */
export type TestUser = {
  username: string;
  password: string;
  token?: TokenModel;
  /** TOTP secret if 2FA is enabled */
  totpSecret?: string;
  /** Argon2Id password-derived key (the KEK), for tests that walk the account key chain API-side. */
  encryptionKey?: Uint8Array;
};

/**
 * Generates a random test username.
 */
export function generateTestUsername(): string {
  const randomPart = Math.random().toString(36).substring(2, 12);
  return `test_${randomPart}@example.tld`;
}

/**
 * Fixed test password so a developer can manually log in to a test user
 * during a paused/inspected e2e run.
 */
export const TEST_PASSWORD = 'TestPass_e2e_dev!';

/**
 * Returns the deterministic test password.
 */
export function generateTestPassword(): string {
  return TEST_PASSWORD;
}

/**
 * Registers a new test user via the API and writes the first revision of their vault.
 *
 * @param apiBaseUrl - The base URL of the API (e.g., 'http://localhost:5100')
 * @param username - The username for the new account
 * @param password - The password for the new account
 * @returns The token model and the password-derived key (KEK) on success
 * @throws Error if registration fails
 */
export async function registerTestUser(
  apiBaseUrl: string,
  username: string,
  password: string
): Promise<{ tokenModel: TokenModel; encryptionKey: Uint8Array }> {
  const result = await SrpAuthService.registerUser(apiBaseUrl, username, password);
  if (!result.success || !result.token || !result.derivedKey || !result.encryptionKey) {
    throw new Error(result.error ?? 'Registration failed without an error message.');
  }

  await pushInitialVault(apiBaseUrl, result.token.token, username, base64ToBytes(result.encryptionKey));

  return { tokenModel: result.token, encryptionKey: base64ToBytes(result.derivedKey) };
}

/**
 * Creates a test user with random credentials.
 *
 * @param apiBaseUrl - The base URL of the API
 * @returns A TestUser object with credentials and token
 */
export async function createTestUser(apiBaseUrl: string): Promise<TestUser> {
  const username = generateTestUsername();
  const password = generateTestPassword();

  const { tokenModel, encryptionKey } = await registerTestUser(apiBaseUrl, username, password);

  return {
    username,
    password,
    token: tokenModel,
    encryptionKey,
  };
}

/**
 * Checks if the API is available.
 *
 * @param apiBaseUrl - The base URL of the API
 * @returns True if the API is reachable
 */
export async function isApiAvailable(apiBaseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/v2/Status`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    // The status endpoint returns 401 when not authenticated, but that means the API is running
    return response.status === 401 || response.ok;
  } catch {
    return false;
  }
}

/**
 * Enables two-factor authentication for a user.
 *
 * @param apiBaseUrl - The base URL of the API
 * @param token - The authentication token
 * @returns The TOTP secret that can be used to generate codes
 */
export async function enableTwoFactor(apiBaseUrl: string, token: string): Promise<string> {
  const baseUrl = apiBaseUrl.replace(/\/$/, '') + '/v2/';

  // Step 1: Enable 2FA to get the secret
  const enableResponse = await fetch(`${baseUrl}TwoFactorAuth/enable`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (!enableResponse.ok) {
    const errorText = await enableResponse.text();
    throw new Error(`Failed to enable 2FA: ${enableResponse.status} ${errorText}`);
  }

  const responseJson = await enableResponse.json();
  // Handle both PascalCase (C#) and camelCase (serialization might vary)
  const secret = responseJson.Secret || responseJson.secret;
  if (!secret) {
    throw new Error(`2FA enable response missing secret. Got: ${JSON.stringify(responseJson)}`);
  }

  // Step 2: Generate a TOTP code and verify it to complete 2FA setup
  const totp = new OTPAuth.TOTP({
    secret: secret,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });
  const code = totp.generate();

  const verifyResponse = await fetch(`${baseUrl}TwoFactorAuth/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(code),
  });

  if (!verifyResponse.ok) {
    const errorText = await verifyResponse.text();
    throw new Error(`Failed to verify 2FA: ${verifyResponse.status} ${errorText}`);
  }

  return secret;
}

/**
 * Generates a TOTP code from a secret.
 * Uses the same otpauth library as the browser extension.
 *
 * @param secret - The TOTP secret
 * @returns A 6-digit TOTP code
 */
export function generateTotpCode(secret: string): string {
  const totp = new OTPAuth.TOTP({
    secret: secret,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });
  return totp.generate();
}

/**
 * Creates a test user with 2FA enabled.
 *
 * @param apiBaseUrl - The base URL of the API
 * @returns A TestUser object with credentials, token, and TOTP secret
 */
export async function createTestUserWith2FA(apiBaseUrl: string): Promise<TestUser> {
  const username = generateTestUsername();
  const password = generateTestPassword();

  const { tokenModel, encryptionKey } = await registerTestUser(apiBaseUrl, username, password);

  // Enable 2FA for the user
  const totpSecret = await enableTwoFactor(apiBaseUrl, tokenModel.token);

  return {
    username,
    password,
    token: tokenModel,
    totpSecret,
    encryptionKey,
  };
}
