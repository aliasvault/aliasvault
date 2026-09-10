import { type StatusResponseV2 } from '@aliasvault/models/webapi';

import { StorageKeys } from '../constants/StorageKeys';
import { getPlatform } from '../platform/ClientPlatform';

/** The resolved capabilities, keyed by capability key. */
export type Capabilities = Record<string, string>;

/**
 * Reads and stores the capabilities the server resolved for this account.
 */
export class CapabilityService {
  /**
   * Persist the capabilities that came with a status response.
   * @param status - the status response to take the capabilities from.
   */
  public static async store(status: StatusResponseV2): Promise<void> {
    const resolved = status.capabilities ?? {};

    // Only write when the status response actually changed.
    if (canonical(await this.getAll()) === canonical(resolved)) {
      return;
    }

    await getPlatform().storage.set(StorageKeys.CAPABILITIES, resolved);
  }

  /**
   * The capabilities from the last status call.
   */
  public static async getAll(): Promise<Capabilities> {
    return await getPlatform().storage.get<Capabilities>(StorageKeys.CAPABILITIES) ?? {};
  }

  /**
   * Watch for capabilities changing.
   * @param callback - called with the new set whenever it changes.
   * @returns Unwatch function.
   */
  public static watch(callback: (capabilities: Capabilities) => void): () => void {
    return getPlatform().storage.watch<Capabilities>(StorageKeys.CAPABILITIES, (capabilities) => callback(capabilities ?? {}));
  }
}

/**
 * Check if two capability sets are equal.
 * @param capabilities - the capabilities to serialise.
 */
function canonical(capabilities: Capabilities): string {
  return JSON.stringify(Object.entries(capabilities).sort(([a], [b]) => a.localeCompare(b)));
}
