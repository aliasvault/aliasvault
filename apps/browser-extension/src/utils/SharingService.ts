import { storage } from 'wxt/utils/storage';

import { SrpAuthService } from '@/utils/auth/SrpAuthService';
import { StorageKeys } from '@/utils/constants/storageKeys';
import { devWarn } from '@/utils/devLogger/DevLogger';
import { VaultKeyAlgorithm, type CreateSharedManifestRequest, type CreateSharedManifestResponse, type DeleteSharedManifestInitiateResponse, type DeleteSharedManifestRequest, type GrantManifestAccessRequest, type GrantManifestAccessResponse, type GroupMemberInfo, type GroupOverviewResponse, type ManifestGrant, type ReceivedManifestInvitation, type VaultKeyAlgorithmValue } from '@/utils/dist/core/models/webapi';
import { EncryptionUtility } from '@/utils/EncryptionUtility';
import { readLegacySessionEncryptionKey } from '@/utils/legacy/LegacyStorageKeyFallbacks';
import { vaultCodecGenerateManifestSalt } from '@/utils/RustCore';
import type { SqliteClient } from '@/utils/SqliteClient';
import { VaultKeyService } from '@/utils/VaultKeyService';
import type { WebApiService } from '@/utils/WebApiService';

/**
 * Vault sharing logic. A shared manifest is a non-personal VaultManifest server-side, owned by a group and encrypted with its own VEK.
 * All manifests (both personal and shared) get combined into a single local sqlite vault database that this client consumes.
 */

/**
 * A shared vault about to be created, with the creator's own public key: the VEK is encrypted for it and for nothing
 * else, because a new vault starts out with one member and everybody who is let in afterwards gets the key encrypted
 * for them inside the invitation that lets them in.
 */
export type ShareTarget = {
  groupId: string;
  selfPublicKey: string;
};

/**
 * A manifest's VEK as this account holds it.
 */
export type ManifestVekGrant = {
  encryptedVek: string;
  encryptionPublicKey: string;
  algorithm: string;
};

/**
 * The client-side mapping of a newly created shared vault.
 */
export type SharedManifestMapping = ManifestVekGrant & { manifestId: string; salt: string; revision: number };

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
 * What a shared vault is called when this client has no name for it yet.
 */
export const DEFAULT_SHARED_VAULT_NAME = 'Shared';

/**
 * Service with static helpers implementing the vault sharing flows.
 */
export class SharingService {
  /**
   * The families this user belongs to, their shared vaults, and the invitations awaiting an answer.
   * @param webApi - API client to reuse.
   */
  public static async getOverview(webApi: WebApiService): Promise<GroupOverviewResponse> {
    return webApi.get<GroupOverviewResponse>('Groups');
  }

  /**
   * Create a shared group's vault.
   * @param webApi - API client to reuse.
   * @param group - the group to create the vault for, with this client's own public key to encrypt its VEK for.
   * @param manifestId - the client-minted id of the new vault.
   */
  public static async createSharedManifest(webApi: WebApiService, group: ShareTarget, manifestId: string): Promise<SharedManifestMapping> {
    const manifestVek = EncryptionUtility.generateVaultEncryptionKey();
    const selfEncryptedVek = await EncryptionUtility.encryptWithPublicKey(manifestVek, group.selfPublicKey);

    const response = await webApi.post<CreateSharedManifestRequest, CreateSharedManifestResponse>(`Groups/${group.groupId}/manifests`, {
      manifestId,
      selfEncryptedVek,
      selfPublicKey: group.selfPublicKey,
      algorithm: VaultKeyAlgorithm.RsaOaepSha256,
    });

    return {
      manifestId: response.manifestId,
      encryptedVek: selfEncryptedVek,
      encryptionPublicKey: group.selfPublicKey,
      algorithm: VaultKeyAlgorithm.RsaOaepSha256,
      salt: await vaultCodecGenerateManifestSalt(),
      revision: response.revisionNumber,
    };
  }

  /**
   * Encrypt a shared vault's VEK for one member of the group.
   * @param manifestVek - the shared vault's VEK.
   * @param member - the member to encrypt it for.
   * @param vaultName - what the vault is called, or null when this client has no name for it.
   */
  public static async encryptVekFor(manifestVek: string, member: GroupMemberInfo, vaultName: string | null): Promise<ManifestGrant | null> {
    if (!member.publicKey || !member.publicKeyId) {
      return null;
    }

    return {
      recipientUserId: member.userId,
      recipientPublicKeyId: member.publicKeyId,
      encryptedVek: await EncryptionUtility.encryptWithPublicKey(manifestVek, member.publicKey),
      encryptedName: vaultName ? await EncryptionUtility.encryptWithPublicKey(vaultName, member.publicKey) : null,
    };
  }

  /**
   * Open the vault names sealed into the invitations addressed to this account.
   * @param sqliteClient - the open local vault, which holds this account's superseded private keys.
   * @param invitations - the invitations as served by the API.
   * @returns The name of each invitation's vault, keyed by invitation id; invitations whose name will not open are left out.
   */
  public static async openInvitationNames(sqliteClient: SqliteClient, invitations: ReceivedManifestInvitation[]): Promise<Record<string, string>> {
    const names: Record<string, string> = {};

    for (const invitation of invitations) {
      if (!invitation.encryptedName || !invitation.recipientPublicKey) {
        continue;
      }

      const privateKey = await this.resolveGrantPrivateKey(sqliteClient, invitation.recipientPublicKey);
      if (!privateKey) {
        devWarn(`[Sharing] No account key in this vault opens the name sealed into invitation ${invitation.id}.`);
        continue;
      }

      try {
        names[invitation.id] = new TextDecoder().decode(await EncryptionUtility.decryptWithPrivateKey(invitation.encryptedName, privateKey));
      } catch (error) {
        devWarn(`[Sharing] Failed to open the name sealed into invitation ${invitation.id}.`, error);
      }
    }

    return names;
  }

  /**
   * Invite a member of the group to one of its shared vaults.
   * @param webApi - API client to reuse.
   * @param groupId - the group the vault belongs to.
   * @param manifestId - the shared vault to invite them to.
   * @param userId - the member being invited.
   * @param grant - the vault's key, encrypted for that member, as produced by {@link encryptVekFor}.
   * @param algorithm - the algorithm the grant was encrypted with.
   */
  public static async inviteMember(webApi: WebApiService, groupId: string, manifestId: string, userId: string, grant: ManifestGrant, algorithm: VaultKeyAlgorithmValue): Promise<void> {
    await webApi.post<GrantManifestAccessRequest, GrantManifestAccessResponse>(`Groups/${groupId}/manifests/${manifestId}/access`, { userId, grant, algorithm });
  }

  /**
   * Take a member's access to one shared vault away, or give up one's own.
   * @param webApi - API client to reuse.
   * @param groupId - the group the vault belongs to.
   * @param manifestId - the shared vault.
   * @param userId - the member losing access.
   */
  public static async revokeAccess(webApi: WebApiService, groupId: string, manifestId: string, userId: string): Promise<void> {
    await webApi.delete<void>(`Groups/${groupId}/manifests/${manifestId}/access/${userId}`);
  }

  /**
   * Delete a shared vault for good, taking it away from every member at once. The server requires proof of the
   * caller's master password, so this runs the SRP handshake the account deletion flow also uses.
   * @param webApi - API client to reuse.
   * @param groupId - the group the vault belongs to.
   * @param manifestId - the shared vault to delete.
   * @param password - the caller's master password, proven to the server and forgotten.
   */
  public static async deleteSharedManifest(webApi: WebApiService, groupId: string, manifestId: string, password: string): Promise<void> {
    const initiate = await webApi.post<object, DeleteSharedManifestInitiateResponse>(`Groups/${groupId}/manifests/${manifestId}/delete/initiate`, {});
    const { passwordHashString } = await SrpAuthService.prepareCredentials(password, initiate.salt, initiate.encryptionType, initiate.encryptionSettings);
    const proof = await SrpAuthService.deriveClientProof(initiate.salt, initiate.srpIdentity, passwordHashString, initiate.serverEphemeral);
    await webApi.post<DeleteSharedManifestRequest, void>(`Groups/${groupId}/manifests/${manifestId}/delete/confirm`, proof, false);
  }

  /**
   * Withdraw an invitation this group sent that has not been answered yet.
   * @param webApi - API client to reuse.
   * @param invitationId - the invitation to withdraw.
   */
  public static async withdrawInvitation(webApi: WebApiService, invitationId: string): Promise<void> {
    await webApi.delete<void>(`Groups/invitations/${invitationId}`);
  }

  /**
   * Accept an invitation addressed to this user, opening the shared vault it names.
   * @param webApi - API client to reuse.
   * @param invitationId - the invitation to accept.
   */
  public static async acceptInvitation(webApi: WebApiService, invitationId: string): Promise<void> {
    await webApi.post<object, void>(`Groups/invitations/${invitationId}/accept`, {}, false);
  }

  /**
   * Decline an invitation addressed to this user.
   * @param webApi - API client to reuse.
   * @param invitationId - the invitation to decline.
   */
  public static async declineInvitation(webApi: WebApiService, invitationId: string): Promise<void> {
    await webApi.post<object, void>(`Groups/invitations/${invitationId}/decline`, {}, false);
  }

  /**
   * Remove a member from a group, or leave one by naming oneself.
   * @param webApi - API client to reuse.
   * @param groupId - the group.
   * @param userId - the member to remove.
   */
  public static async removeMember(webApi: WebApiService, groupId: string, userId: string): Promise<void> {
    await webApi.delete<void>(`Groups/${groupId}/members/${userId}`);
  }

  /**
   * Make sure every shared vault this session administers is anchored at a local folder.
   * @param sqliteClient - the open local vault.
   * @returns Whether the vault was mutated.
   */
  public static async ensureAnchorFolders(sqliteClient: SqliteClient): Promise<boolean> {
    let mutated = false;

    for (const record of Object.values(await this.getSharedManifestRecords())) {
      if (!record.canAdminister) {
        // A member waiting for the administrator's first push has nothing to anchor yet.
        continue;
      }

      const anchored = sqliteClient.executeQuery<{ Id: string }>('SELECT Id FROM Folders WHERE ManifestId = ? AND IsDeleted = 0 AND ParentFolderId IS NULL', [record.manifestId]);
      if (anchored.length > 0) {
        continue;
      }

      await createAnchorFolder(sqliteClient, record.manifestId, record.name ?? DEFAULT_SHARED_VAULT_NAME);
      devWarn(`[Sharing] Shared vault ${record.manifestId} had no anchor folder; recreated it.`);
      mutated = true;
    }

    return mutated;
  }

  /**
   * Mint a fresh active keypair for a shared manifest.
   * @param sqliteClient - the open local vault DB (caller must run this inside a vault mutation so it is saved)
   * @param manifestId - the shared manifest's id (the stamp its key rows carry)
   */
  public static async rotateManifestEncryptionKey(sqliteClient: SqliteClient, manifestId: string): Promise<void> {
    const keyPair = await EncryptionUtility.generateRsaKeyPair();
    sqliteClient.encryptionKeys.setActiveForManifest(manifestId, keyPair.publicKey, keyPair.privateKey);
  }

  /**
   * The shared-manifest key records (see {@link SharedManifestRecord}), keyed by manifest id.
   */
  public static async getSharedManifestRecords(): Promise<Record<string, SharedManifestRecord>> {
    const ciphertext = (await storage.getItem(StorageKeys.SHARED_MANIFESTS)) as string | null;
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
   * The key record of one shared manifest.
   * @param manifestId - the manifest to look up.
   */
  public static async getSharedManifestRecord(manifestId: string): Promise<SharedManifestRecord | null> {
    return Object.values(await this.getSharedManifestRecords()).find(record => record.manifestId.toLowerCase() === manifestId.toLowerCase()) ?? null;
  }

  /**
   * Persist the shared-manifest key records.
   * @param manifests - the full record map; replaces whatever is stored.
   * @param encryptionKey - the vault encryption key the map is sealed with, passed explicitly because both writers already hold it.
   */
  public static async setSharedManifestRecords(manifests: Record<string, SharedManifestRecord>, encryptionKey: string): Promise<void> {
    await storage.setItem(StorageKeys.SHARED_MANIFESTS, await EncryptionUtility.symmetricEncrypt(JSON.stringify(manifests), encryptionKey));
  }

  /**
   * Add (or replace) one shared-manifest key record.
   * @param record - the record to add.
   * @param encryptionKey - the vault encryption key the map is sealed with.
   */
  public static async addSharedManifestRecord(record: SharedManifestRecord, encryptionKey: string): Promise<void> {
    const manifests = await this.getSharedManifestRecords();
    manifests[record.manifestId] = record;
    await this.setSharedManifestRecords(manifests, encryptionKey);
  }

  /**
   * The session vault encryption key, or null while the vault is locked.
   */
  private static async sessionEncryptionKey(): Promise<string | null> {
    return ((await storage.getItem(StorageKeys.ENCRYPTION_KEY)) as string | null) ?? await readLegacySessionEncryptionKey();
  }

  /**
   * Decrypt an RSA-OAEP encrypted manifest VEK with the given private key (JWK string), returning the VEK as base64.
   */
  public static async decryptManifestVek(encryptedVek: string, privateKey: string): Promise<string> {
    const plaintextBytes = await EncryptionUtility.decryptWithPrivateKey(encryptedVek, privateKey);
    return new TextDecoder().decode(plaintextBytes);
  }

  /**
   * Unwrap one shared manifest's VEK from the grant this account holds on it.
   * @param sqliteClient - the open local vault, the durable home of the account's superseded private keys.
   * @param record - the manifest to open.
   */
  public static async openSharedManifestVek(sqliteClient: SqliteClient, record: SharedManifestRecord): Promise<string | null> {
    if (record.algorithm !== VaultKeyAlgorithm.RsaOaepSha256) {
      devWarn(`[Sharing] Vault ${record.manifestId} grants its key under an unsupported algorithm "${record.algorithm}" (newer server?); leaving it closed.`);
      return null;
    }

    const privateKey = await this.resolveGrantPrivateKey(sqliteClient, record.encryptionPublicKey);
    if (!privateKey) {
      devWarn(`[Sharing] No account key in this vault opens the grant on vault ${record.manifestId}; leaving it closed.`);
      return null;
    }

    try {
      return await this.decryptManifestVek(record.encryptedVek, privateKey);
    } catch (error) {
      devWarn(`[Sharing] Failed to unwrap the key of vault ${record.manifestId}; leaving it closed.`, error);
      return null;
    }
  }

  /**
   * Unwrap the VEK of every shared manifest this session holds a grant on, keyed by manifest id.
   * @param sqliteClient - the open local vault.
   */
  public static async openSharedManifestVeks(sqliteClient: SqliteClient): Promise<Map<string, string>> {
    const veks = new Map<string, string>();
    for (const record of Object.values(await this.getSharedManifestRecords())) {
      const vek = await this.openSharedManifestVek(sqliteClient, record);
      if (vek) {
        veks.set(record.manifestId, vek);
      }
    }
    return veks;
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

/**
 * What every shared manifest in this vault is called, keyed by lower-cased manifest id.
 * @param sqliteClient - the open local vault.
 */
export function anchorFolderNames(sqliteClient: SqliteClient): Record<string, string> {
  const anchors = sqliteClient.executeQuery<{ ManifestId: string; Name: string }>('SELECT ManifestId, Name FROM Folders WHERE IsDeleted = 0 AND ManifestId IS NOT NULL AND UPPER(Id) = UPPER(ManifestId)');
  return Object.fromEntries(anchors.map(anchor => [anchor.ManifestId.toLowerCase(), anchor.Name]));
}

/**
 * Renders a shared manifest as a local folder.
 * @param sqliteClient - the open local vault.
 * @param manifestId - the shared vault to give a folder to.
 * @param name - the vault's own name, used as the folder name.
 */
export async function createAnchorFolder(sqliteClient: SqliteClient, manifestId: string, name: string): Promise<void> {
  const folderId = manifestId.toUpperCase();
  await sqliteClient.folders.create(name, null, folderId);
  await sqliteClient.folders.restampSubtree(folderId, manifestId);
}

export default SharingService;
