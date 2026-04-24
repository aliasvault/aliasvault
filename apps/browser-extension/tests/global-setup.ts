/**
 * Global setup for E2E tests.
 *
 * Runs before any tests to ensure prerequisites are met.
 */

import { isApiAvailable } from './helpers/test-api';

/**
 * Default API URL for local development.
 */
const DEFAULT_API_URL = process.env.ALIASVAULT_API_URL || 'http://localhost:5092';

/**
 * Set a server setting via the DEBUG-only test controller.
 * Fails loudly if the endpoint is missing — a Release build of the API is not
 * testable with this suite because the tests share one IP against a persistent DB.
 */
async function setServerSetting(apiUrl: string, key: string, value: string): Promise<void> {
  const url = `${apiUrl.replace(/\/$/, '')}/v1/Test/server-settings`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to set server setting "${key}" via ${url} (status ${response.status}). ` +
        'The test controller is only compiled into DEBUG builds and only active when ASPNETCORE_ENVIRONMENT=Development. ' +
        'Rebuild the API in Debug/Development to run the e2e suite.'
    );
  }
}

export default async function globalSetup(): Promise<void> {
  console.log(`Checking API availability at ${DEFAULT_API_URL}...`);

  const apiAvailable = await isApiAvailable(DEFAULT_API_URL);

  if (!apiAvailable) {
    throw new Error(
      `API is not available at ${DEFAULT_API_URL}. ` +
        'Please ensure the AliasVault API server is running before running E2E tests. ' +
        'You can set a custom API URL via the ALIASVAULT_API_URL environment variable.'
    );
  }

  // Tests all register from the same source IP, so we disable the rate limit.
  await setServerSetting(DEFAULT_API_URL, 'MaxRegistrationsPerIpPer24Hours', '0');

  console.log('API is available and test settings applied. Proceeding with tests...');
}
