import { VaultKeyAlgorithm, type GroupOverviewResponse, type PasswordConfirmationChallenge, type PasswordConfirmationRequest, type ReceivedManifestInvitation } from '@aliasvault/models/webapi';

import { VaultKeyService } from '../auth/VaultKeyService';
import { StorageKeys } from '../constants/StorageKeys';
import { getPlatform } from '../platform/ClientPlatform';
import { devWarn } from '../platform/Logger';
import { rustCore } from '../rust/RustCore';

import type { WebApiService } from '../api/WebApiService';

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
export type SrpChallengeResponder = (challenge: PasswordConfirmationChallenge) => Promise<PasswordConfirmationRequest>;

/**
 * Decrypts a vault name encrypted into an invitation to the given manifest for the given public key, or returns null when this session holds no key that opens it.
 */
export type InvitationNameDecryptor = (encryptedName: string, manifestId: string, recipientPublicKey: string) => Promise<string | null>;

/**
 * Service with static helpers implementing the vault sharing flows.
 */
export class SharingService {
  /**
   * Watch the number of open invitations to shared folders, which every sync updates.
   * @param callback - called with the new number whenever it changes.
   * @returns Unwatch function.
   */
  public static watchPendingInvitationCount(callback: (count: number) => void): () => void {
    return getPlatform().storage.watch<number>(StorageKeys.PENDING_SHARING_INVITATIONS, count => callback(count ?? 0));
  }

  /**
   * This account's own account fingerprint, derived from its signing private key; null while the vault is locked or the account has no signing key yet.
   */
  public static async ownAccountFingerprint(): Promise<string | null> {
    const [accountKey, encryptedSigningPrivateKey] = await Promise.all([VaultKeyService.getSessionAccountKey(), VaultKeyService.getEncryptedSigningPrivateKey()]);
    if (!accountKey || !encryptedSigningPrivateKey) {
      return null;
    }

    try {
      return await rustCore().accountSigningKeyFingerprint(encryptedSigningPrivateKey, accountKey);
    } catch (error) {
      devWarn('[Sharing] The own signing key did not open, so no account fingerprint can be shown.', error);
      return null;
    }
  }

  /**
   * The shared folders this account is in (each with its group of people), the invitations awaiting an answer, and the people verified before.
   * @param webApi - API client to reuse.
   */
  public static async getOverview(webApi: SharingApi): Promise<GroupOverviewResponse> {
    return webApi.get<GroupOverviewResponse>('Groups');
  }

  /**
   * Decrypt the vault names encrypted into the invitations addressed to this account.
   * @param invitations - the invitations as served by the API.
   * @param decryptName - decrypts one name; defaults to the session account private key this realm holds. The mobile app
   * passes a native call instead, as its private key never leaves the native layer.
   * @returns The name of each invitation's vault, keyed by invitation id; invitations whose name will not open are left out.
   */
  public static async openInvitationNames(invitations: ReceivedManifestInvitation[], decryptName: InvitationNameDecryptor = (name, manifestId, key) => this.decryptManifestInvitationNameWithSessionKey(name, manifestId, key)): Promise<Record<string, string>> {
    const names: Record<string, string> = {};

    for (const invitation of invitations) {
      if (!invitation.encryptedName || !invitation.recipientAccountPublicKey) {
        continue;
      }

      if (invitation.algorithm !== VaultKeyAlgorithm.RsaOaepSha256) {
        devWarn(`[Sharing] Invitation ${invitation.id} is encrypted with an unsupported algorithm '${invitation.algorithm}'.`);
        continue;
      }

      try {
        const name = await decryptName(invitation.encryptedName, invitation.manifestId, invitation.recipientAccountPublicKey);
        if (name === null) {
          devWarn(`[Sharing] This session holds no account private key that decrypts the name encrypted into invitation ${invitation.id}.`);
          continue;
        }
        names[invitation.id] = name;
      } catch (error) {
        devWarn(`[Sharing] Failed to decrypt the name encrypted into invitation ${invitation.id}.`, error);
      }
    }

    return names;
  }

  /**
   * Take another member's access to one shared manifest away. The server requires proof of the caller's master password.
   * @param webApi - API client to reuse.
   * @param groupId - the group the manifest belongs to.
   * @param manifestId - the shared manifest.
   * @param userId - the member losing access.
   * @param answerChallenge - proves the master password, which each host derives its own way.
   */
  public static async revokeAccess(webApi: SharingApi, groupId: string, manifestId: string, userId: string, answerChallenge: SrpChallengeResponder): Promise<void> {
    const challenge = await webApi.post<object, PasswordConfirmationChallenge>(`Groups/${groupId}/manifests/${manifestId}/access/${userId}/revoke/initiate`, {});
    await webApi.post<PasswordConfirmationRequest, void>(`Groups/${groupId}/manifests/${manifestId}/access/${userId}/revoke/confirm`, await answerChallenge(challenge), false);
  }

  /**
   * Delete a shared manifest nobody else is in, after its owner moved its contents out, so the folder is personal again.
   * The server refuses while anybody else is in it or invited; it asks for no master password, as nothing is shared anymore.
   * @param webApi - API client to reuse.
   * @param groupId - the group of the shared manifest.
   * @param manifestId - the shared manifest.
   */
  public static async unshareSharedManifest(webApi: SharingApi, groupId: string, manifestId: string): Promise<void> {
    await webApi.post<object, void>(`Groups/${groupId}/manifests/${manifestId}/unshare`, {}, false);
  }

  /**
   * Hand back one's own access to a shared manifest. The server requires proof of the caller's master password and
   * refuses this for group admins.
   * @param webApi - API client to reuse.
   * @param groupId - the group the manifest belongs to.
   * @param manifestId - the shared manifest.
   * @param answerChallenge - proves the master password, which each host derives its own way.
   */
  public static async leaveSharedManifest(webApi: SharingApi, groupId: string, manifestId: string, answerChallenge: SrpChallengeResponder): Promise<void> {
    const challenge = await webApi.post<object, PasswordConfirmationChallenge>(`Groups/${groupId}/manifests/${manifestId}/leave/initiate`, {});
    await webApi.post<PasswordConfirmationRequest, void>(`Groups/${groupId}/manifests/${manifestId}/leave/confirm`, await answerChallenge(challenge), false);
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
    const challenge = await webApi.post<object, PasswordConfirmationChallenge>(`Groups/${groupId}/manifests/${manifestId}/delete/initiate`, {});
    await webApi.post<PasswordConfirmationRequest, void>(`Groups/${groupId}/manifests/${manifestId}/delete/confirm`, await answerChallenge(challenge), false);
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
   * Decline an invitation addressed to this user.
   * @param webApi - API client to reuse.
   * @param invitationId - the invitation to decline.
   */
  public static async declineInvitation(webApi: SharingApi, invitationId: string): Promise<void> {
    await webApi.post<object, void>(`Groups/invitations/${invitationId}/decline`, {}, false);
  }

  /**
   * Decrypt an invitation's vault name encrypted for `publicKey` with the account private key of this session.
   * @param encryptedName - the base64 RSA-OAEP ciphertext.
   * @param manifestId - the shared manifest the invitation is for.
   * @param publicKey - the public half it was encrypted for.
   * @returns The name, or null when this session holds no private key for `publicKey`.
   */
  private static async decryptManifestInvitationNameWithSessionKey(encryptedName: string, manifestId: string, publicKey: string): Promise<string | null> {
    if (await VaultKeyService.getAccountPublicKey() !== publicKey) {
      return null;
    }
    const privateKey = await VaultKeyService.getSessionAccountPrivateKey();
    if (!privateKey) {
      return null;
    }
    return rustCore().decryptManifestInvitationName(encryptedName, manifestId, privateKey);
  }

}

export default SharingService;
