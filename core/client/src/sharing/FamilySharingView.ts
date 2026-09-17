import type { GroupInfo, GroupMemberInfo, SentManifestInvitation, SharedManifestInfo } from '@aliasvault/models/webapi';

/**
 * What the family sharing screen shows and offers, generic and used by multiple clients.
 */

/**
 * One member's access status and current user's available actions on it.
 */
export type MemberAccess = {
  isSelf: boolean;
  hasAccess: boolean;
  invitation: SentManifestInvitation | null;
  statusKey: string;
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
    statusKey: hasAccess ? 'sharing.family.hasAccess' : invitation ? 'sharing.family.invited' : 'sharing.family.noAccess',
    canLeave: hasAccess && isSelf && !isAdmin,
    canRevoke: hasAccess && !isSelf && isAdmin,
    canWithdraw: invitation !== null && !isSelf && isAdmin,
    canInvite: !hasAccess && invitation === null && !isSelf && isAdmin && holdsManifestKey(manifest, ownUserId),
    isReadyForInvite: Boolean(member.publicKey),
  };
}

/**
 * The translation key of a member's role.
 * @param member - the member.
 */
export function roleTranslationKey(member: Pick<GroupMemberInfo, 'role'>): string {
  switch (member.role) {
    case 'Owner': return 'sharing.owner';
    case 'Admin': return 'sharing.family.admin';
    default: return 'sharing.family.member';
  }
}

/**
 * The translation key that explains a sharing API error code.
 * @param apiErrorCode - the code the server answered with.
 * @returns The key, or null for a code this screen has no words for.
 */
export function sharingErrorTranslationKey(apiErrorCode: string | null | undefined): string | null {
  switch (apiErrorCode) {
    case 'INVITE_RECIPIENT_NOT_READY': return 'sharing.family.errors.userNotReady';
    case 'NOT_GROUP_MEMBER': return 'sharing.family.errors.notFamilyMember';
    case 'ACCESS_ALREADY_GRANTED': return 'sharing.family.errors.alreadyHasAccess';
    case 'INVITATION_ALREADY_EXISTS': return 'sharing.family.errors.alreadyInvited';
    case 'INVITATION_NOT_FOUND': return 'sharing.family.errors.invitationGone';
    case 'INVITATION_KEY_OUTDATED': return 'sharing.family.errors.invitationKeyOutdated';
    case 'LAST_MANIFEST_GRANT_HOLDER': return 'sharing.family.errors.lastMemberWithAccess';
    case 'GROUP_MANIFEST_LIMIT_REACHED': return 'sharing.family.errors.vaultLimitReached';
    default: return null;
  }
}
