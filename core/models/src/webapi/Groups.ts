import { VaultKeyAlgorithmValue } from './VaultKeyAlgorithm';

/**
 * The messages of the /v2/Groups API: the membership half of vault sharing.
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
}

/**
 * An invitation sent from a group that is still awaiting an answer.
 */
export type SentGroupInvitation = {
  id: string;
  inviteeUsername: string;
  createdAt: string;
}

/**
 * An open invitation addressed to this user.
 */
export type ReceivedGroupInvitation = {
  id: string;
  groupId: string;
  groupName: string;
  inviterUsername: string;
  createdAt: string;
}

/**
 * One shared group this user belongs to.
 */
export type GroupInfo = {
  groupId: string;
  name: string;
  role: GroupRole;
  manifestId: string | null;
  members: GroupMemberInfo[];
  pendingInvitations: SentGroupInvitation[];
}

/**
 * Everything the sharing screen renders, as served by GET /v2/Groups.
 */
export type GroupOverviewResponse = {
  groups: GroupInfo[];
  receivedInvitations: ReceivedGroupInvitation[];
}

/**
 * Create a shared group's vault.
 */
export type CreateSharedManifestRequest = {
  manifestId: string;
  name: string;
  selfEncryptedVek: string;
  selfPublicKey: string;
  algorithm: VaultKeyAlgorithmValue;
}

/**
 * The created manifest, as served by POST /v2/Groups/{groupId}/manifest.
 */
export type CreateSharedManifestResponse = {
  manifestId: string;
  revisionNumber: number;
}

/**
 * Ask which account a username belongs to, and which public key an invitation to it must be encrypted for.
 */
export type GroupInvitationRecipientRequest = {
  username: string;
}

/**
 * A user a manifest VEK can be encrypted for, with the public key to encrypt it with.
 */
export type GrantRecipient = {
  userId: string;
  publicKeyId: string;
  publicKey: string;
}

/**
 * The resolved recipient, as served by POST /v2/Groups/{groupId}/invitations/recipient.
 */
export type GroupInvitationRecipientResponse = {
  recipient: GrantRecipient;
}

/**
 * One recipient's copy of a manifest VEK, encrypted for a public key of theirs.
 */
export type ManifestGrant = {
  recipientUserId: string;
  recipientPublicKeyId: string;
  encryptedVek: string;
}

/**
 * Invite an account to a group.
 */
export type CreateGroupInvitationRequest = {
  userId: string;
  grant: ManifestGrant;
  algorithm: VaultKeyAlgorithmValue;
}

/**
 * The sent invitation, as served by POST /v2/Groups/{groupId}/invitations.
 */
export type CreateGroupInvitationResponse = {
  invitationId: string;
}
