/**
 * Global setup: runs once before the suite to check the API and apply the test server settings.
 */
import { resolveApiUrl } from './helpers/api-url';
import { isApiAvailable, setServerSetting } from './helpers/test-api';

/**
 * Fail early when the API is down, and lift the registration rate limit since every test registers from one IP.
 */
export default async function globalSetup(): Promise<void> {
  const apiUrl = resolveApiUrl();
  console.info(`Checking API availability at ${apiUrl}...`);

  if (!await isApiAvailable(apiUrl)) {
    throw new Error(`API is not available at ${apiUrl}. Start the AliasVault API (e.g. ./scripts/dev.sh api) or point ALIASVAULT_API_URL at a running instance.`);
  }

  await setServerSetting(apiUrl, 'MaxRegistrationsPerIpPer24Hours', '0');
}
