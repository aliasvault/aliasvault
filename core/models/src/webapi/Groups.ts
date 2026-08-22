import { VaultKeyAlgorithmValue } from './VaultKeyAlgorithm';

/**
 * The messages of the /v2/Groups API: the sharing half of vault sharing.
 */

/**
 * A member's role in a group.
 */
export type GroupRole = 'Owner' | 'Admin' | 'Member';

/**
 * One member of a group.
 */
export type GroupMemberInfo = {
  userId: string;
  username: string;
  role: GroupRole;
  publicKeyId: string | null;
  publicKey: string | null;
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
  createdAt: string;
  encryptedName: string | null;
  recipientPublicKey: string | null;
}

/**
 * One shared manifest owned by a group, with the members who can open it.
 */
export type SharedManifestInfo = {
  manifestId: string;
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
}

/**
 * The created vault, as served by POST /v2/Groups/{groupId}/manifests.
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
