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
  /** The caller's own certification of `signingPublicKey`, for admins; the client verifies it itself. */
  keyCertification: string | null;
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
  keyVersion: number;
  /** The vault's key encrypted for `recipientAccountPublicKey`; the invitee signs it as their grant when accepting. */
  encryptedVek: string | null;
  grantSignature: string | null;
  encryptedName: string | null;
  encryptedNameSignature: string | null;
  signerPublicKey: string | null;
  recipientAccountPublicKey: string | null;
  algorithm: string;
  /** The invitee's own certification of `signerPublicKey`, when they certified the inviter before. */
  inviterCertification: string | null;
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
  /** The caller's own user id. */
  userId: string;
  groups: GroupInfo[];
  receivedInvitations: ReceivedManifestInvitation[];
  /** The people whose current signing key this user certified, who can be invited without their identity code. */
  verifiedPeople: GroupMemberInfo[];
}

/**
 * Create a shared manifest, with a group of its own that the caller owns (POST /v2/Groups/manifests).
 */
export type CreateSharedManifestRequest = {
  manifestId: string;
  selfEncryptedVek: string;
  selfAccountPublicKey: string;
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
 * The created manifest and its group, as served by POST /v2/Groups/manifests.
 */
export type CreateSharedManifestResponse = {
  groupId: string;
  manifestId: string;
  revisionNumber: number;
}

/**
 * One recipient's copy of a shared manifest's VEK, encrypted for a public key of theirs.
 */
export type ManifestGrant = {
  recipientUserId: string;
  recipientAccountPublicKeyId: string;
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
 * The SRP handshake served by the initiate endpoints of the sharing actions confirmed with the master password.
 */
export type PasswordConfirmationChallenge = {
  salt: string;
  serverEphemeral: string;
  encryptionType: string;
  encryptionSettings: string;
  srpIdentity: string;
}

/**
 * The SRP proof of the caller's master password, for the matching confirm endpoint.
 */
export type PasswordConfirmationRequest = {
  clientPublicEphemeral: string;
  clientSessionProof: string;
}
