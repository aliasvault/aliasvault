import { devLog, devWarn } from '@/utils/devLogger/DevLogger';
import type { StatusResponseV2 } from '@/utils/dist/core/models/webapi';
import { SharingService } from '@/utils/SharingService';
import type { SqliteClient } from '@/utils/SqliteClient';
import type { WebApiService } from '@/utils/WebApiService';

/**
 * Carries out work the server hands this client with the status response.
 */

/** One piece of work the server is asking this client to carry out. */
export type PendingClientAction = {
  id: string;
  type: string;
  manifestId?: string | null;
  payload?: string | null;
};

/**
 * The action types this build knows how to carry out. The tokens are the server's `ClientActionType` names.
 */
const ACTION_ROTATE_MANIFEST_DELIVERY_KEY = 'RotateManifestDeliveryKey';

/**
 * What one action left behind: whether the local vault changed, and whether the action is finished and may be retired server-side.
 */
type ActionOutcome = { vaultChanged: boolean; completed: boolean };

/**
 * Runs the server's outstanding work for this client.
 */
export class PendingActionProcessor {
  /**
   * The actions the server has addressed to this client.
   * @param status - the status response of the sync in progress.
   */
  public static pendingActions(status: StatusResponseV2): PendingClientAction[] {
    return (status as StatusResponseV2 & { pendingActions?: PendingClientAction[] }).pendingActions ?? [];
  }

  /**
   * Run every action this client understands and can carry out right now, reporting each one done as it lands.
   * @param webApi - API client to reuse.
   * @param actions - the actions from {@link pendingActions}.
   * @param sqliteClient - the open local vault, mutated in place by the actions that write to it.
   * @returns Whether the vault was mutated and therefore needs to be persisted and pushed.
   */
  public static async process(webApi: WebApiService, actions: PendingClientAction[], sqliteClient: SqliteClient): Promise<boolean> {
    let mutated = false;
    let completed = 0;

    for (const action of actions) {
      try {
        const outcome = await this.runAction(action, sqliteClient);
        mutated = outcome.vaultChanged || mutated;

        if (outcome.completed) {
          await this.complete(webApi, action.id);
          completed++;
        }
      } catch (error) {
        devWarn(`[PendingActions] Could not carry out action ${action.type} (${action.id}); retrying on the next sync.`, error);
      }
    }

    devLog(`[PendingActions] ${completed} of ${actions.length} action(s) carried out${mutated ? '; the vault changed and rides out on this sync' : ''}.`);

    return mutated;
  }

  /**
   * Carry out one action, if this build knows the type and this session holds what it needs.
   * @param action - the action to run.
   * @param sqliteClient - the open local vault.
   */
  private static async runAction(action: PendingClientAction, sqliteClient: SqliteClient): Promise<ActionOutcome> {
    switch (action.type) {
      case ACTION_ROTATE_MANIFEST_DELIVERY_KEY:
        return this.rotateDeliveryKey(action, sqliteClient);
      default:
        devLog(`[PendingActions] Action type ${action.type} is not known to this client; leaving it for one that knows it.`);
        return { vaultChanged: false, completed: false };
    }
  }

  /**
   * Replace a shared vault's mail delivery keypair, which the server asks for after somebody who held the old private half was removed from the group.
   * @param action - the action naming the manifest to rotate.
   * @param sqliteClient - the open local vault.
   */
  private static async rotateDeliveryKey(action: PendingClientAction, sqliteClient: SqliteClient): Promise<ActionOutcome> {
    const record = Object.values(await SharingService.getSessionSharedManifests()).find(candidate => idsEqual(candidate.manifestId, action.manifestId));

    if (!record?.canAdminister) {
      devLog(`[PendingActions] Vault ${action.manifestId} is not open to this session as an administrator; leaving its delivery key rotation for another sync.`);
      return { vaultChanged: false, completed: false };
    }

    await SharingService.rotateManifestEncryptionKey(sqliteClient, record.manifestId);
    devLog(`[PendingActions] Rotated the mail delivery key of shared vault ${record.manifestId}.`);

    return { vaultChanged: true, completed: true };
  }

  /**
   * Report an action done.
   * @param webApi - API client to reuse.
   * @param actionId - the action that was carried out.
   */
  private static async complete(webApi: WebApiService, actionId: string): Promise<void> {
    await webApi.delete<void>(`ClientActions/${actionId}`);
  }
}

/**
 * Whether two ids name the same row, which travel in whatever casing their producer used.
 * @param a - first id.
 * @param b - second id.
 */
function idsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
}

export default PendingActionProcessor;
