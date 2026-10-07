/**
 * Runtime configuration, read from /appsettings.json at startup. The Docker entrypoint rewrites that file in the web
 * root, so its name and structure are kept for compatibility.
 */

import { StorageKeys } from '@aliasvault/client/constants/StorageKeys';
import { getPlatform } from '@aliasvault/client/platform';

/**
 * The appsettings.json file as served.
 */
type AppSettingsFile = {
  ApiUrl?: string;
  SupportEmail?: string;
  PublicRegistrationEnabled?: string | boolean;
  DeploymentMode?: string;
  TermsUrl?: string;
};

/**
 * The resolved configuration.
 */
export type AppConfig = {
  apiUrl: string;
  supportEmail: string;
  publicRegistrationEnabled: boolean;
  deploymentMode: string;
  termsUrl: string;
};

let current: AppConfig | null = null;

/**
 * Load the configuration and record the API URL in platform storage, where the client core reads it from.
 */
export async function loadAppConfig(): Promise<AppConfig> {
  /*
   * In dev, appsettings.Development.json wins when present: scripts/dev.sh writes it with the ports of the
   * running instance, so the checked-in appsettings.json stays untouched.
   */
  const candidates = import.meta.env.DEV ? ['appsettings.Development.json', 'appsettings.json'] : ['appsettings.json'];

  let file: AppSettingsFile | null = null;
  for (const candidate of candidates) {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}${candidate}`, { cache: 'no-store' });
      // The dev server answers a missing file with the SPA fallback, so only a JSON response counts as a hit.
      if (response.ok && response.headers.get('content-type')?.includes('json')) {
        file = await response.json() as AppSettingsFile;
        break;
      }
    } catch (error) {
      console.warn(`Could not load ${candidate}:`, error);
    }
  }

  if (!file) {
    console.warn('No appsettings file could be loaded, using defaults.');
    file = {};
  }

  // Without an explicit API URL the API lives next to the app under /api, which is the Docker setup's default.
  const apiUrl = (file.ApiUrl && file.ApiUrl.length > 0 ? file.ApiUrl : `${window.location.origin}/api`).replace(/\/$/, '');

  current = {
    apiUrl,
    supportEmail: file.SupportEmail ?? '',
    publicRegistrationEnabled: String(file.PublicRegistrationEnabled ?? 'true').toLowerCase() === 'true',
    deploymentMode: file.DeploymentMode ?? '',
    termsUrl: (file.TermsUrl ?? '').trim(),
  };

  await getPlatform().storage.set(StorageKeys.API_URL, apiUrl);
  return current;
}

/**
 * The loaded configuration.
 * @throws When loadAppConfig has not run yet.
 */
export function getAppConfig(): AppConfig {
  if (!current) {
    throw new Error('App config not loaded. Call loadAppConfig() first.');
  }
  return current;
}
