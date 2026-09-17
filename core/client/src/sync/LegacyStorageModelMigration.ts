/**
 * Legacy storage model migration specific logic.
 *
 * TODO: these methods and file can be deleted later once all users have migrated from sqlite-blob to manifest-v1.
 */

import { ServerUpdateRequiredError } from '../api/errors/ServerUpdateRequiredError';
import { timeoutAbortSignal } from '../api/WebApiService';
import { VaultKeyService } from '../auth/VaultKeyService';

import type { WebApiService } from '../api/WebApiService';

/*
 * -- 1. Servers predating the v2 vault API --
 */

/** How long the legacy-API probe may take before we stop blaming the server version, where the host's API client honors the abort signal. */
const V1_PROBE_TIMEOUT_MS = 3000;

/**
 * The part of an API client the legacy probe needs.
 */
export type LegacyProbeApi = Pick<WebApiService, 'rawFetch'>;

/**
 * Probe whether the configured server answers on the v1 API while v2 does not respond.
 *
 * The probe is a GET on purpose: the endpoint only accepts POST, so an existing route answers 405 and a server
 * without the v1 API answers 404, which is the whole signal.
 * @param api - the API client the probe goes through
 */
export async function serverPredatesV2Api(api: LegacyProbeApi): Promise<boolean> {
  try {
    const response = await api.rawFetch('v1/Auth/login', {
      method: 'GET',
      signal: timeoutAbortSignal(V1_PROBE_TIMEOUT_MS),
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
 * @param api - the API client the probe goes through
 */
export async function throwIfServerPredatesV2Api(status: number, api: LegacyProbeApi): Promise<void> {
  if (status !== 404) {
    return;
  }

  if (await serverPredatesV2Api(api)) {
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
