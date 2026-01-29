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

  console.log('API is available. Proceeding with tests...');
}
