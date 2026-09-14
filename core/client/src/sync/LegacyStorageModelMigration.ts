/**
 * Legacy storage model migration specific logic.
 *
 * TODO: these methods and file can be deleted later once all users have migrated from sqlite-blob to manifest-v1.
 */

import { ServerUpdateRequiredError } from '../api/errors/ServerUpdateRequiredError';
import { VaultKeyService } from '../auth/VaultKeyService';

/*
 * -- 1. Servers predating the v2 vault API --
 */

/** How long the legacy-API probe may take before we stop blaming the server version. */
const V1_PROBE_TIMEOUT_MS = 3000;

/**
 * Probe whether the configured server answers on the v1 API while v2 does not respond.
 * @param apiBaseUrl - the configured API base URL, without a version segment
 */
export async function serverPredatesV2Api(apiBaseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/v1/Auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(V1_PROBE_TIMEOUT_MS),
    });

    return response.status !== 404;
  } catch {
    // Unreachable or timed out: we cannot prove the server is outdated, so let the caller report the original failure.
    return false;
  }
}

/**
 * Translate a 404 from a v2 endpoint into {@link ServerUpdateRequiredError} when the server turns out to be an
 * outdated AliasVault install.
 * @param status - the HTTP status of the v2 response
 * @param apiBaseUrl - the configured API base URL, without a version segment
 */
export async function throwIfServerPredatesV2Api(status: number, apiBaseUrl: string): Promise<void> {
  if (status !== 404) {
    return;
  }

  if (await serverPredatesV2Api(apiBaseUrl)) {
    throw new ServerUpdateRequiredError();
  }
}

/*
 * -- 2. The missing KEK/VEK account key hierarchy --
 */

/**
 * Whether this vault still has to run the migration, answered entirely from local state: no cached vault key
 * means no hierarchy exists yet.
 */
export async function requiresLegacyAccountKeyMigration(): Promise<boolean> {
  return !await VaultKeyService.hasLocalVaultKey();
}
