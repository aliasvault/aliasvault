import type { VaultKeyAlgorithmValue } from './VaultKeyAlgorithm';

/**
 * The messages of the /v2/Groups API: the sharing half of vault sharing.
 */

/**
 * A member's role in a group.
 */
export type GroupRole = 'owner' | 'admin' | 'member';

/**
 * One member of a group.
 */
export type GroupMemberInfo = {
  userId: string;
  username: string;
  role: GroupRole;
  accountPublicKeyId: string | null;
  accountPublicKey: string | null;
  accountPublicKeySignature: string | null;
  signingPublicKey: string | null;
}

/**
 * An offer of access to a shared manifest that is still awaiting the recipient's answer.
 */
export type SentManifestInvitation = {
  id: string;
  inviteeUserId: string;
  inviteeUsername: string;
  createdAt: string;
}

/**
 * An open offer of access to a shared manifest, addressed to this user.
 */
export type ReceivedManifestInvitation = {
  id: string;
  groupId: string;
  manifestId: string;
  inviterUsername: string;
  inviterUserId: string;
  createdAt: string;
  encryptedName: string | null;
  encryptedNameSignature: string | null;
  signerPublicKey: string | null;
  recipientAccountPublicKey: string | null;
  algorithm: string;
}

/**
 * One shared manifest owned by a group, with the members who can open it.
 */
export type SharedManifestInfo = {
  manifestId: string;
  keyVersion: number;
  memberUserIds: string[];
  pendingInvitations: SentManifestInvitation[];
}

/**
 * One shared group this user belongs to.
 */
export type GroupInfo = {
  groupId: string;
  role: GroupRole;
  manifests: SharedManifestInfo[];
  members: GroupMemberInfo[];
}

/**
 * Everything the sharing screen renders, as served by GET /v2/Groups.
 */
export type GroupOverviewResponse = {
  groups: GroupInfo[];
  receivedInvitations: ReceivedManifestInvitation[];
}

/**
 * Create another shared manifest for a group.
 */
export type CreateSharedManifestRequest = {
  manifestId: string;
  selfEncryptedVek: string;
  selfPublicKey: string;
  algorithm: VaultKeyAlgorithmValue;
  selfGrantSignature: string;
  /** The name of the manifest, encrypted with the manifest's own key (base64). */
  encryptedName?: string | null;
}

/**
 * Change the details of one of a group's shared manifests (POST /v2/Groups/{groupId}/manifests/{manifestId}).
 */
export type UpdateSharedManifestRequest = {
  /** The new name of the manifest, encrypted with the manifest's own key (base64). */
  encryptedName?: string | null;
}

/**
 * The created manifest, as served by POST /v2/Groups/{groupId}/manifests.
 */
export type CreateSharedManifestResponse = {
  manifestId: string;
  revisionNumber: number;
}

/**
 * One recipient's copy of a shared manifest's VEK, encrypted for a public key of theirs.
 */
export type ManifestGrant = {
  recipientUserId: string;
  recipientPublicKeyId: string;
  encryptedVek: string;
  encryptedName?: string | null;
  encryptedNameSignature?: string | null;
  signature: string;
}

/**
 * Give a member of the group access to one of its shared manifests.
 */
export type GrantManifestAccessRequest = {
  userId: string;
  grant: ManifestGrant;
  algorithm: VaultKeyAlgorithmValue;
}

/**
 * The created offer, as served by POST /v2/Groups/{groupId}/manifests/{manifestId}/access.
 */
export type GrantManifestAccessResponse = {
  invitationId: string;
}

/**
 * The SRP handshake served by POST /v2/Groups/{groupId}/manifests/{manifestId}/delete/initiate.
 */
export type DeleteSharedManifestInitiateResponse = {
  salt: string;
  serverEphemeral: string;
  encryptionType: string;
  encryptionSettings: string;
  srpIdentity: string;
}

/**
 * Delete a shared manifest for good, carrying the SRP proof of the caller's master password.
 */
export type DeleteSharedManifestRequest = {
  clientPublicEphemeral: string;
  clientSessionProof: string;
}
