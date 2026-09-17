import { type DeleteSharedManifestInitiateResponse, type DeleteSharedManifestRequest, type GroupOverviewResponse, type ReceivedManifestInvitation } from '@aliasvault/models/webapi';

import { VaultKeyService } from '../auth/VaultKeyService';
import { StorageKeys } from '../constants/StorageKeys';
import { EncryptionUtility } from '../crypto/EncryptionUtility';
import { getPlatform } from '../platform/ClientPlatform';
import { devWarn } from '../platform/Logger';

import type { WebApiService } from '../api/WebApiService';
import type { SqliteClient } from '../database/SqliteClient';

/**
 * Vault sharing logic. A shared manifest is a non-personal VaultManifest server-side, owned by a group and encrypted with its own VEK.
 * All manifests (both personal and shared) get combined into a single local sqlite vault database that this client consumes.
 */

/**
 * The API calls the sharing flows make.
 */
export type SharingApi = Pick<WebApiService, 'get' | 'post' | 'delete'>;

/**
 * Proves the caller's master password to the server by answering its SRP challenge.
 */
export type SrpChallengeResponder = (challenge: DeleteSharedManifestInitiateResponse) => Promise<DeleteSharedManifestRequest>;

/**
 * Finds the private key that opens something encrypted for the given public key, or null when this client holds none.
 */
export type PrivateKeyResolver = (publicKey: string) => Promise<string | null>;

/**
 * A manifest's VEK as this account holds it.
 */
export type ManifestVekGrant = {
  encryptedVek: string;
  encryptionPublicKey: string;
  algorithm: string;
};

/**
 * Key record of a shared manifest, resolved during the last pull (or a share create) and rebuilt from the server
 * grant on every pull.
 */
export type SharedManifestRecord = ManifestVekGrant & {
  manifestId: string;
  salt: string;
  name?: string | null;
  canAdminister?: boolean;
};

/**
 * Service with static helpers implementing the vault sharing flows.
 */
export class SharingService {
  /**
   * The families this user belongs to, their shared manifests, and the invitations awaiting an answer.
   * @param webApi - API client to reuse.
   */
  public static async getOverview(webApi: SharingApi): Promise<GroupOverviewResponse> {
    return webApi.get<GroupOverviewResponse>('Groups');
  }

  /**
   * Decrypt the vault names encrypted into the invitations addressed to this account.
   * @param sqliteClient - the open local vault, which holds this account's superseded private keys.
   * @param invitations - the invitations as served by the API.
   * @returns The name of each invitation's vault, keyed by invitation id; invitations whose name will not open are left out.
   */
  public static async openInvitationNames(sqliteClient: SqliteClient, invitations: ReceivedManifestInvitation[]): Promise<Record<string, string>> {
    return this.openInvitationNamesWith(publicKey => this.resolveGrantPrivateKey(sqliteClient, publicKey), invitations);
  }

  /**
   * Decrypt the vault names encrypted into the invitations addressed to this account, for a host that keeps its keys elsewhere.
   * @param resolvePrivateKey - finds the private key for the public key an invitation was encrypted for.
   * @param invitations - the invitations as served by the API.
   * @returns The name of each invitation's vault, keyed by invitation id; invitations whose name will not open are left out.
   */
  public static async openInvitationNamesWith(resolvePrivateKey: PrivateKeyResolver, invitations: ReceivedManifestInvitation[]): Promise<Record<string, string>> {
    const names: Record<string, string> = {};

    for (const invitation of invitations) {
      if (!invitation.encryptedName || !invitation.recipientPublicKey) {
        continue;
      }

      const privateKey = await resolvePrivateKey(invitation.recipientPublicKey);
      if (!privateKey) {
        devWarn(`[Sharing] No account key in this vault decrypts the name encrypted into invitation ${invitation.id}.`);
        continue;
      }

      try {
        names[invitation.id] = new TextDecoder().decode(await EncryptionUtility.decryptWithPrivateKey(invitation.encryptedName, privateKey));
      } catch (error) {
        devWarn(`[Sharing] Failed to decrypt the name encrypted into invitation ${invitation.id}.`, error);
      }
    }

    return names;
  }

  /**
   * Take a member's access to one shared manifest away, or hand back one's own. The server refuses the latter for group admins.
   * @param webApi - API client to reuse.
   * @param groupId - the group the manifest belongs to.
   * @param manifestId - the shared manifest.
   * @param userId - the member losing access.
   */
  public static async revokeAccess(webApi: SharingApi, groupId: string, manifestId: string, userId: string): Promise<void> {
    await webApi.delete<void>(`Groups/${groupId}/manifests/${manifestId}/access/${userId}`);
  }

  /**
   * Delete a shared manifest for good, taking it away from every member at once. The server requires proof of the
   * caller's master password, so this runs the SRP handshake the account deletion flow also uses.
   * @param webApi - API client to reuse.
   * @param groupId - the group the manifest belongs to.
   * @param manifestId - the shared manifest to delete.
   * @param answerChallenge - proves the master password, which each host derives its own way.
   */
  public static async deleteSharedManifest(webApi: SharingApi, groupId: string, manifestId: string, answerChallenge: SrpChallengeResponder): Promise<void> {
    const challenge = await webApi.post<object, DeleteSharedManifestInitiateResponse>(`Groups/${groupId}/manifests/${manifestId}/delete/initiate`, {});
    await webApi.post<DeleteSharedManifestRequest, void>(`Groups/${groupId}/manifests/${manifestId}/delete/confirm`, await answerChallenge(challenge), false);
  }

  /**
   * Withdraw an invitation this group sent that has not been answered yet.
   * @param webApi - API client to reuse.
   * @param invitationId - the invitation to withdraw.
   */
  public static async withdrawInvitation(webApi: SharingApi, invitationId: string): Promise<void> {
    await webApi.delete<void>(`Groups/invitations/${invitationId}`);
  }

  /**
   * Accept an invitation addressed to this user, opening the shared manifest it names.
   * @param webApi - API client to reuse.
   * @param invitationId - the invitation to accept.
   */
  public static async acceptInvitation(webApi: SharingApi, invitationId: string): Promise<void> {
    await webApi.post<object, void>(`Groups/invitations/${invitationId}/accept`, {}, false);
  }

  /**
   * Decline an invitation addressed to this user.
   * @param webApi - API client to reuse.
   * @param invitationId - the invitation to decline.
   */
  public static async declineInvitation(webApi: SharingApi, invitationId: string): Promise<void> {
    await webApi.post<object, void>(`Groups/invitations/${invitationId}/decline`, {}, false);
  }

  /**
   * The shared-manifest key records (see {@link SharedManifestRecord}), keyed by manifest id.
   */
  public static async getSharedManifestRecords(): Promise<Record<string, SharedManifestRecord>> {
    const ciphertext = (await getPlatform().storage.get(StorageKeys.SHARED_MANIFESTS)) as string | null;
    const encryptionKey = ciphertext ? await this.sessionEncryptionKey() : null;
    if (!ciphertext || !encryptionKey) {
      return {};
    }

    try {
      return JSON.parse(await EncryptionUtility.symmetricDecrypt(ciphertext, encryptionKey)) as Record<string, SharedManifestRecord>;
    } catch (error) {
      devWarn('[Sharing] The stored shared-manifest key records did not decrypt (re-keyed vault?); treating them as absent.', error);
      return {};
    }
  }

  /**
   * The session vault encryption key, or null while the vault is locked.
   */
  private static async sessionEncryptionKey(): Promise<string | null> {
    return VaultKeyService.getSessionVaultEncryptionKey();
  }

  /**
   * The private key that opens a grant made out to `publicKey`.
   * @param sqliteClient - the open local vault.
   * @param publicKey - the public half the grant was encrypted for.
   */
  private static async resolveGrantPrivateKey(sqliteClient: SqliteClient, publicKey: string): Promise<string | null> {
    if (await VaultKeyService.getAccountPublicKey() === publicKey) {
      const sessionPrivateKey = await VaultKeyService.getSessionAccountPrivateKey();
      if (sessionPrivateKey) {
        return sessionPrivateKey;
      }
    }

    return sqliteClient.encryptionKeys.getAccountKeypair(publicKey)?.PrivateKey ?? null;
  }

}

export default SharingService;
