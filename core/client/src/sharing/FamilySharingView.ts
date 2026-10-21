import type { GroupInfo, GroupMemberInfo, GroupOverviewResponse, ReceivedManifestInvitation, SentManifestInvitation, SharedManifestInfo } from '@aliasvault/models/webapi';

/**
 * What the shared folders screen shows and offers, generic and used by multiple clients.
 */

/**
 * Maximum length of a shared manifest name in UTF-16 code units. Invitations carry the name RSA-OAEP encrypted, which fits at
 * most 190 UTF-8 bytes; one code unit takes at most 3 bytes, so 60 fits in any script.
 */
export const MAX_SHARED_VAULT_NAME_LENGTH = 60;

/**
 * The shared folders screen's text strings, in English only on purpose (temporary) as the UI is pending changes
 * so we don't let the translation platform see this yet until its finalized. TODO: move these strings to locale files.
 */
export const familySharingText = {
  /** Title of the people dialog of a folder. */
  peopleTitle: 'People with access',
  /** Shown in the people dialog of a folder that is not shared yet. */
  shareFolderHint: 'Invite people to share this folder with them. Everyone you invite can see, change and delete its items.',
  /** A pending invitation shown in the folder list. */
  invitationPending: 'Invitation',
  /** Title of the dialog of an invitation to a shared folder. */
  sharedWithYou: (username: string, folder: string): string => `${username} shared “${folder}” with you`,
  sharedWithYouHint: 'Accept to see this folder and everything in it in your vault.',
  yourCodeSettingsHint: 'Someone who shares a folder with you needs this code to invite you. It is not secret.',
  /** Title of the step that asks for the inviter's code before accepting. */
  inviterCodeTitle: (username: string): string => `Confirm the invitation from ${username}`,
  /** Explains why the inviter's code is asked for. */
  inviterCodeExplanation: (username: string): string => `For your security, enter the code of ${username}. It confirms that this invitation really comes from them. ${username} finds it in Settings on their device.`,
  /** Who sent an invitation, whose key this account verified before. */
  invitedByVerified: (username: string): string => `Invited by ${username} (verified)`,
  /** Who sent an invitation. */
  invitedBy: (username: string): string => `Invited by ${username}`,
  invitePeople: 'Invite someone',
  /** Shown with this account's code while an invitation waits for an answer. */
  pendingCodeTip: 'Tip: looking for your code to send to the people you invited? Here it is:',
  notSharedYet: 'This folder is not shared with anyone yet. Invite someone to start sharing it.',
  inviteWizardChooseTitle: 'Who do you want to invite?',
  inviteWizardNewCodeTitle: 'Or invite someone new with their code',
  inviteWizardCodeTitle: 'Enter the code of the person you invite',
  inviteWizardCodeHint: 'Ask the person to copy their code from Settings and send it to you. The code creates a secure link between your accounts. You only need to do this once per person.',
  inviteWizardConfirmTitle: 'Confirm the invitation',
  /** Asks to confirm who a personal folder is shared with, which makes it a shared folder. */
  inviteWizardConfirmShare: (username: string, folder: string): string => `You are about to share “${folder}” with ${username}. They can see, change and delete everything in it.`,
  /** Asks to confirm who is invited to a shared folder. */
  inviteWizardConfirmFolder: (username: string, folder: string): string => `You are about to invite ${username} to “${folder}”.`,
  /** Confirms the invitation went out. */
  inviteWizardInvited: (username: string): string => `${username} has been invited`,
  inviteWizardNextStep: 'Next step: share your code',
  /** Asks to send this account's own code to the person invited. */
  inviteWizardShareHint: (username: string): string => `Send this code to ${username}. They need to enter it to accept your invitation.`,
  inviteWizardShareNotSecret: 'This code is not secret. It only confirms that the invitation comes from you, so you can send it by email or in a chat app, or type it in by hand.',
  /** A close button that is enabled after a short countdown. */
  closeCountdown: (seconds: number): string => `Close (${seconds})`,
  codePlaceholder: '1234-5678-9012-3456-7890',
  yourCode: 'Your code',
  accept: 'Accept',
  decline: 'Decline',
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  you: 'You',
  /** Progress line of the create shared folder wizard. */
  wizardStep: (step: number, total: number): string => `Step ${step} of ${total}`,
  wizardCreating: 'Creating the shared folder and sending the invitations...',
  sharedVault: 'Shared folder',
  invited: 'Invited',
  revoke: 'Remove access',
  withdraw: 'Withdraw',
  invite: 'Invite',
  leaveVault: 'Leave folder',
  /** Confirmation for leaving a shared folder. */
  leaveVaultConfirm: (vault: string): string => `Leave “${vault}”? You lose access to it right away.`,
  /** Notice after an invitation was sent. */
  invitationSent: (username: string): string => `Invitation sent to ${username}.`,
  /** Confirmation for taking a member's access away. */
  revokeAccessConfirm: (username: string, vault: string): string => `Take ${username} out of “${vault}”? They lose access to it right away.`,
  deleteVault: 'Delete folder',
  /** Confirmation for deleting a shared folder. */
  deleteVaultConfirm: (vault: string): string => `Permanently delete “${vault}”? Everyone with access loses this folder and everything in it. This cannot be undone.`,
  /** Password prompt for taking a member's access to a shared folder away. */
  revokeAccessPasswordPrompt: (username: string, vault: string): string => `Enter your master password to confirm taking ${username} out of “${vault}”.`,
  /** Password prompt for leaving a shared folder. */
  leaveVaultPasswordPrompt: (vault: string): string => `Enter your master password to confirm leaving “${vault}”.`,
  /** Password prompt for deleting a shared folder. */
  deleteVaultPasswordPrompt: (vault: string): string => `Enter your master password to confirm deleting “${vault}” for everyone.`,
  vaultDeleted: 'The shared folder has been deleted.',
  /** An item's email alias that receives its emails in another place than the item's own vault or shared folder. */
  aliasOwner: {
    inPersonalVault: 'This email alias receives its emails in your personal vault.',
    /** The alias receives its emails in a shared folder. */
    inSharedFolder: (folder: string): string => `This email alias receives its emails in the shared folder “${folder}”.`,
    moveHere: 'Move alias here',
    /** Confirmation for moving the alias into a shared folder. */
    moveToSharedFolderConfirm: (email: string, folder: string): string => `From now on, new emails for ${email} go to the shared folder “${folder}”, where everyone with access to it can read them. Emails received before stay where they are.`,
    /** Confirmation for moving the alias into the personal vault. */
    moveToPersonalVaultConfirm: (email: string): string => `From now on, new emails for ${email} go to your personal vault, where only you can read them. Emails received before stay where they are.`,
  },
  errors: {
    createVaultFailed: 'The shared folder could not be created. Please try again.',
    vaultUpgradeRequired: 'Your vault has to finish upgrading before you can share folders.',
    revokeAccessFailed: 'The access could not be changed. Please try again.',
    inviteFailed: 'The invitation could not be sent. Please try again.',
    userNotReady: 'That account has to finish upgrading AliasVault before a folder can be shared with it.',
    alreadyInvited: 'That person has already been invited.',
    invitationGone: 'That invitation is no longer available.',
    invitationKeyOutdated: "This invitation is no longer valid because the shared folder's key has changed. Ask for a new invitation.",
    alreadyHasAccess: 'That person already has access to this folder.',
    lastMemberWithAccess: 'Somebody has to be able to open the shared folder. Give someone else access to it first.',
    deleteVaultFailed: 'The shared folder could not be deleted. Please try again.',
    codeNotFound: 'No account has this code. Check the code and try again.',
    codeRateLimited: 'Too many codes were looked up. Please try again later.',
    codeIsOwn: 'This is your own code. Enter the code of the other person instead.',
    codeMismatch: 'This code is not correct. Ask the other person for their correct code.',
    inviterNotVerified: 'First enter the code of the person who invited you.',
    memberNotVerified: 'First invite this person with their code under Invite someone new.',
    aliasOwnedByOtherFolder: 'This email alias receives its emails in a shared folder you cannot open, or in the personal vault of someone else. Ask them to move it here.',
  },
};

/**
 * What the viewer can do about one member of a shared folder.
 */
export type MemberAccess = {
  isSelf: boolean;
  canLeave: boolean;
  canRevoke: boolean;
};

/**
 * Whether this account administers the group, which is what creating, inviting, revoking and deleting take.
 * @param group - the group as served by the API.
 */
export function canAdministerGroup(group: Pick<GroupInfo, 'role'>): boolean {
  return group.role === 'owner' || group.role === 'admin';
}

/**
 * `text` split around the first occurrence of `value`, so a screen can render `value` emphasized; `value` is empty when absent.
 * @param text - the full text.
 * @param value - the part to emphasize, such as a username.
 */
export function splitAround(text: string, value: string): [before: string, value: string, after: string] {
  const index = value ? text.indexOf(value) : -1;
  return index < 0 ? [text, '', ''] : [text.slice(0, index), value, text.slice(index + value.length)];
}

/**
 * One shared folder: a shared manifest with the group of people it is shared with.
 */
export type SharedFolder = { group: GroupInfo; manifest: SharedManifestInfo };

/**
 * What the sharing screen shows of an overview: the viewer's user id, the shared folders (each with its own group,
 * members sorted), the invitations waiting for an answer, and the people verified before.
 * @param overview - the overview as served by the API.
 */
export function sharingView(overview: GroupOverviewResponse | null): { myUserId: string; folders: SharedFolder[]; invitations: ReceivedManifestInvitation[]; verifiedPeople: GroupMemberInfo[] } {
  const folders = (overview?.groups ?? []).flatMap(group => {
    const sorted = { ...group, members: sortMembers(group.members) };
    return group.manifests.map(manifest => ({ group: sorted, manifest }));
  });
  return {
    myUserId: overview?.userId ?? '',
    folders,
    invitations: overview?.receivedInvitations ?? [],
    verifiedPeople: [...(overview?.verifiedPeople ?? [])].sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' })),
  };
}

/** The order roles are listed in: the owner first, then admins, then members. */
const ROLE_ORDER: Record<GroupMemberInfo['role'], number> = { owner: 0, admin: 1, member: 2 };

/**
 * Members sorted by role (owner, admins, members), then alphabetically by username within each role.
 * @param members - the members as served by the API.
 */
function sortMembers<T extends Pick<GroupMemberInfo, 'role' | 'username'>>(members: T[]): T[] {
  return [...members].sort((a, b) => (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3) || a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }));
}

/**
 * Whether this account certified the inviter's key before, so the invitation takes no code.
 * @param invitation - the invitation as served by the API.
 */
export function isInviterVerified(invitation: Pick<ReceivedManifestInvitation, 'inviterCertification'>): boolean {
  return invitation.inviterCertification !== null;
}

/**
 * Why a person cannot be handed a manifest key yet, or null when they can: their key is not certified, or their account
 * has no keys yet.
 * @param member - the person as served by the API.
 */
export function memberKeyProblem(member: Pick<GroupMemberInfo, 'accountPublicKey' | 'signingPublicKey' | 'keyCertification'>): string | null {
  if (!member.accountPublicKey || !member.signingPublicKey) {
    return familySharingText.errors.userNotReady;
  }
  return member.keyCertification ? null : familySharingText.errors.memberNotVerified;
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
 * The people verified before who are not in the folder and have no open invitation to it, so they can be invited.
 * @param folder - the shared folder.
 * @param verifiedPeople - the people verified before.
 */
export function invitablePeople(folder: SharedFolder, verifiedPeople: GroupMemberInfo[]): GroupMemberInfo[] {
  return verifiedPeople.filter(person => !folder.group.members.some(member => member.userId === person.userId) && !folder.manifest.pendingInvitations.some(invitation => invitation.inviteeUserId === person.userId));
}

/**
 * Whether anybody besides the viewer is in a shared folder or invited to it. A shared folder without anybody else is
 * personal again: its owner's client turns it back into a personal folder.
 * @param folder - the shared folder.
 * @param ownUserId - the viewer's user id.
 */
export function hasOtherPeople(folder: SharedFolder, ownUserId: string): boolean {
  return folder.group.members.some(member => member.userId !== ownUserId) || folder.manifest.pendingInvitations.length > 0;
}

/**
 * The open invitations to a shared folder for people outside its group, who join it when they accept.
 * @param folder - the shared folder.
 */
export function pendingInvitees(folder: SharedFolder): SentManifestInvitation[] {
  return folder.manifest.pendingInvitations.filter(invitation => !folder.group.members.some(member => member.userId === invitation.inviteeUserId));
}

/**
 * What the viewer can do about one member: a member leaves, an administrator takes another member's access away.
 * @param group - the group the manifest belongs to.
 * @param manifest - the shared manifest.
 * @param member - the member being described.
 * @param ownUserId - the viewer's user id.
 */
export function describeMemberAccess(group: Pick<GroupInfo, 'role'>, manifest: Pick<SharedManifestInfo, 'memberUserIds'>, member: Pick<GroupMemberInfo, 'userId'>, ownUserId: string): MemberAccess {
  const isSelf = member.userId === ownUserId;
  const isAdmin = canAdministerGroup(group);
  const hasAccess = manifest.memberUserIds.includes(member.userId);

  return {
    isSelf,
    canLeave: hasAccess && isSelf && !isAdmin,
    canRevoke: hasAccess && !isSelf && isAdmin,
  };
}

/**
 * The label of a member's role.
 * @param member - the member.
 */
export function roleLabel(member: Pick<GroupMemberInfo, 'role'>): string {
  switch (member.role) {
    case 'owner': return familySharingText.owner;
    case 'admin': return familySharingText.admin;
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
    case 'ACCESS_ALREADY_GRANTED': return familySharingText.errors.alreadyHasAccess;
    case 'INVITATION_ALREADY_EXISTS': return familySharingText.errors.alreadyInvited;
    case 'INVITATION_NOT_FOUND': return familySharingText.errors.invitationGone;
    case 'INVITATION_KEY_OUTDATED': return familySharingText.errors.invitationKeyOutdated;
    case 'LAST_MANIFEST_GRANT_HOLDER': return familySharingText.errors.lastMemberWithAccess;
    case 'SHARED_MANIFEST_IN_USE': return familySharingText.errors.revokeAccessFailed;
    case 'IDENTITY_CODE_NOT_FOUND': return familySharingText.errors.codeNotFound;
    case 'RATE_LIMIT_EXCEEDED': return familySharingText.errors.codeRateLimited;
    case 'MEMBER_NOT_VERIFIED': return familySharingText.errors.memberNotVerified;
    case 'INVITER_NOT_VERIFIED': return familySharingText.errors.inviterNotVerified;
    case 'IDENTITY_CODE_MISMATCH': return familySharingText.errors.codeMismatch;
    case 'IDENTITY_CODE_IS_OWN': return familySharingText.errors.codeIsOwn;
    default: return null;
  }
}
