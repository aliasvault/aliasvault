import type { GroupInfo, GroupMemberInfo, SentManifestInvitation, SharedManifestInfo } from '@aliasvault/models/webapi';

/**
 * What the family sharing screen shows and offers, generic and used by multiple clients.
 */

/**
 * The family sharing screen's text strings, in English only on purpose (temporary) as the UI is pending changes
 * so we don't let the translation platform see this yet until its finalized. TODO: move these strings to locale files.
 */
export const familySharingText = {
  title: 'Family Sharing',
  beta: 'Beta',
  description: 'Share vaults with the people in your family.',
  notAvailable: 'Family sharing is not enabled for this account yet. Once a family has been set up for you, it appears here.',
  invitations: 'Invitations',
  /** Who sent an invitation. */
  invitedBy: (username: string): string => `Invited by ${username}`,
  accept: 'Accept',
  decline: 'Decline',
  members: 'Family members',
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  you: 'You',
  noSharedVaultAdmin: 'This family has no shared vault yet. Once created, it shows up as a folder for every member you invite.',
  noSharedVaultMember: 'Nobody has created a shared vault for this family yet.',
  createSharedVault: 'Create a shared vault',
  sharedVault: 'Shared vault',
  sharedVaults: 'Shared vaults',
  hasAccess: 'Has access',
  invited: 'Invited',
  noAccess: 'No access',
  revoke: 'Revoke',
  withdraw: 'Withdraw',
  invite: 'Invite',
  create: 'Create',
  leaveVault: 'Leave vault',
  /** Confirmation for leaving a shared vault. */
  leaveVaultConfirm: (vault: string): string => `Leave “${vault}”? You lose access to it, but stay in the family.`,
  cannotInviteWithoutAccess: 'You do not have access to this vault, so you cannot invite anyone to it. Ask a member who has access to invite you first.',
  vaultNamePlaceholder: 'Vault name, for example Streaming',
  /** Notice after an invitation was sent. */
  invitationSent: (username: string): string => `Invitation sent to ${username}.`,
  /** Confirmation for taking a member's access away. */
  revokeAccessConfirm: (username: string, vault: string): string => `Take ${username} out of “${vault}”? They lose access to it right away, but stay in the family.`,
  revokeAccessWarning: 'They keep any copy of this vault they already downloaded. Change the passwords in it that you do not want them to keep using.',
  deleteVault: 'Delete vault',
  /** Confirmation for deleting a shared vault. */
  deleteVaultConfirm: (vault: string): string => `Permanently delete “${vault}”? Every member of the family loses this vault and everything in it. This cannot be undone.`,
  /** Password prompt for deleting a shared vault. */
  deleteVaultPasswordPrompt: (vault: string): string => `Enter your master password to confirm deleting “${vault}” for the whole family.`,
  vaultDeleted: 'The shared vault has been deleted.',
  errors: {
    loadFailed: 'Family sharing could not be loaded.',
    createVaultFailed: 'The shared vault could not be created. Please try again.',
    vaultUpgradeRequired: 'Your vault has to finish upgrading before it can be shared.',
    revokeAccessFailed: 'The access could not be changed. Please try again.',
    inviteFailed: 'The invitation could not be sent. Please try again.',
    userNotReady: 'That account has to finish upgrading AliasVault before a vault can be shared with it.',
    alreadyInvited: 'That person has already been invited.',
    invitationGone: 'That invitation is no longer available.',
    invitationKeyOutdated: "This invitation is no longer valid because the shared vault's key has changed. Ask for a new invitation.",
    notFamilyMember: 'That person is not in this family.',
    alreadyHasAccess: 'That person already has access to this vault.',
    lastMemberWithAccess: 'Somebody has to be able to open the shared vault. Give another member access to it first.',
    vaultLimitReached: 'Max amount of shared vaults reached.',
    deleteVaultFailed: 'The shared vault could not be deleted. Please try again.',
  },
};

/**
 * One member's access status and current user's available actions on it.
 */
export type MemberAccess = {
  isSelf: boolean;
  hasAccess: boolean;
  invitation: SentManifestInvitation | null;
  statusText: string;
  canLeave: boolean;
  canRevoke: boolean;
  canWithdraw: boolean;
  canInvite: boolean;
  isReadyForInvite: boolean;
};

/**
 * Whether this account administers the group, which is what creating, inviting, revoking and deleting take.
 * @param group - the group as served by the API.
 */
export function canAdministerGroup(group: Pick<GroupInfo, 'role'>): boolean {
  return group.role === 'Owner' || group.role === 'Admin';
}

/**
 * The viewer's own user id in a group, found through the roster because the API does not name the caller.
 * @param group - the group as served by the API.
 * @param username - the viewer's username.
 * @returns The user id, or an empty string when the roster does not list the viewer.
 */
export function ownUserIdIn(group: Pick<GroupInfo, 'members'>, username: string | null | undefined): string {
  return group.members.find(member => member.username === username)?.userId ?? '';
}

/**
 * Whether the viewer holds a grant on the manifest. Inviting encrypts the manifest's key for somebody else, which
 * an administrator without a grant of their own cannot do.
 * @param manifest - the shared manifest.
 * @param ownUserId - the viewer's user id.
 */
export function holdsManifestKey(manifest: Pick<SharedManifestInfo, 'memberUserIds'>, ownUserId: string): boolean {
  return manifest.memberUserIds.includes(ownUserId);
}

/**
 * One member's access status and current user's available actions on it.
 * @param group - the group the manifest belongs to.
 * @param manifest - the shared manifest.
 * @param member - the member being described.
 * @param ownUserId - the viewer's user id.
 */
export function describeMemberAccess(group: GroupInfo, manifest: SharedManifestInfo, member: GroupMemberInfo, ownUserId: string): MemberAccess {
  const isSelf = member.userId === ownUserId;
  const isAdmin = canAdministerGroup(group);
  const hasAccess = manifest.memberUserIds.includes(member.userId);
  const invitation = manifest.pendingInvitations.find(candidate => candidate.inviteeUserId === member.userId) ?? null;

  return {
    isSelf,
    hasAccess,
    invitation,
    statusText: hasAccess ? familySharingText.hasAccess : invitation ? familySharingText.invited : familySharingText.noAccess,
    canLeave: hasAccess && isSelf && !isAdmin,
    canRevoke: hasAccess && !isSelf && isAdmin,
    canWithdraw: invitation !== null && !isSelf && isAdmin,
    canInvite: !hasAccess && invitation === null && !isSelf && isAdmin && holdsManifestKey(manifest, ownUserId),
    isReadyForInvite: Boolean(member.publicKey),
  };
}

/**
 * The label of a member's role.
 * @param member - the member.
 */
export function roleLabel(member: Pick<GroupMemberInfo, 'role'>): string {
  switch (member.role) {
    case 'Owner': return familySharingText.owner;
    case 'Admin': return familySharingText.admin;
    default: return familySharingText.member;
  }
}

/**
 * The message that explains a sharing API error code.
 * @param apiErrorCode - the code the server answered with.
 * @returns The message, or null for a code this screen has no words for.
 */
export function sharingErrorMessage(apiErrorCode: string | null | undefined): string | null {
  switch (apiErrorCode) {
    case 'INVITE_RECIPIENT_NOT_READY': return familySharingText.errors.userNotReady;
    case 'NOT_GROUP_MEMBER': return familySharingText.errors.notFamilyMember;
    case 'ACCESS_ALREADY_GRANTED': return familySharingText.errors.alreadyHasAccess;
    case 'INVITATION_ALREADY_EXISTS': return familySharingText.errors.alreadyInvited;
    case 'INVITATION_NOT_FOUND': return familySharingText.errors.invitationGone;
    case 'INVITATION_KEY_OUTDATED': return familySharingText.errors.invitationKeyOutdated;
    case 'LAST_MANIFEST_GRANT_HOLDER': return familySharingText.errors.lastMemberWithAccess;
    case 'GROUP_MANIFEST_LIMIT_REACHED': return familySharingText.errors.vaultLimitReached;
    default: return null;
  }
}
