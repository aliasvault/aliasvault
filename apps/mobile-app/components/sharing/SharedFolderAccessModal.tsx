import { canAdministerGroup, describeMemberAccess, familySharingText, hasOtherPeople, holdsManifestKey, invitablePeople, memberKeyProblem, pendingInvitees, roleLabel, sharingView, type SharedFolder } from '@aliasvault/client/sharing/FamilySharingView';
import { SharingService } from '@aliasvault/client/sharing/SharingService';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';

import emitter from '@/utils/EventEmitter';
import { runSharingOperation, sharingFailureMessage, SharingOperationError } from '@/utils/SharingErrors';

import { useColors } from '@/hooks/useColorScheme';
import { usePasswordConfirmedAction } from '@/hooks/usePasswordConfirmedAction';
import { type SharedFolders } from '@/hooks/useSharedFolders';
import { useVaultSync } from '@/hooks/useVaultSync';

import { ModalWrapper } from '@/components/common/ModalWrapper';
import { FamilyCode } from '@/components/sharing/FamilyCode';
import { InviteMemberWizard, type FamilyCodeAccount } from '@/components/sharing/InviteMemberWizard';
import { ThemedText } from '@/components/themed/ThemedText';
import { useDb } from '@/context/DbContext';
import { useDialog } from '@/context/DialogContext';
import { useWebApi } from '@/context/WebApiContext';

import type { Folder, FolderRef } from '@aliasvault/client/database/repositories/FolderRepository';
import type { GroupMemberInfo } from '@aliasvault/models/webapi';

interface ISharedFolderAccessModalProps {
  folder: Folder;
  isShared: boolean;
  shared: SharedFolders;
  onMoved: (ref: FolderRef, isShared: boolean) => void;
  onLeft: () => void;
  onClose: () => void;
}

/**
 * The people of a folder: who has access, inviting someone new by their code or somebody verified before, and taking
 * access away. A personal folder becomes a shared folder on its first invitation, and turns personal again once nobody
 * else is in it. Mounted while the sheet is open.
 */
export const SharedFolderAccessModal: React.FC<ISharedFolderAccessModalProps> = ({ folder, isShared, shared, onMoved, onLeft, onClose }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const webApi = useWebApi();
  const dbContext = useDb();
  const { syncVault } = useVaultSync();
  const { showDialog } = useDialog();
  const runWithPassword = usePasswordConfirmedAction();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  /** Whether the sheet makes way for a confirmation or the password prompt, which show on top of the screen. */
  const [isHidden, setIsHidden] = useState(false);
  /** The notice of the invite wizard, shown once it closes rather than behind it. */
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);

  // Who is in the folder changes on other devices too, so the sheet shows the server's current view when it opens.
  const { reload } = shared;
  useEffect(() => {
    void reload();
  }, [reload]);

  const current = isShared ? shared.folders.find(candidate => candidate.manifest.manifestId.toLowerCase() === folder.ManifestId.toLowerCase()) ?? null : null;
  const others = shared.verifiedPeople.filter(person => person.userId !== shared.myUserId);
  const invitable = current ? invitablePeople(current, others) : others;
  const hasOthers = current !== null && hasOtherPeople(current, shared.myUserId);
  const canInvite = isShared ? current !== null && canAdministerGroup(current.group) && holdsManifestKey(current.manifest, shared.myUserId) : true;

  /**
   * Run one action, showing its error in the sheet, then reload what is shown.
   * @param action - the action to run.
   * @param failureMessage - the message for a failure without a more specific reason.
   */
  const run = async (action: () => Promise<void>, failureMessage: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (actionError) {
      setError(sharingFailureMessage(actionError, failureMessage));
    }
    await shared.reload();
    setBusy(false);
  };

  /**
   * The shared folder this folder is, turning a personal folder into one first (the wizard had the user confirm who it is
   * shared with): the shared folder is created with the folder's name, the folder's contents move into it, and the
   * personal folder is deleted.
   * @returns The shared folder.
   */
  const ensureShared = async (): Promise<SharedFolder> => {
    if (current) {
      return current;
    }
    const client = dbContext.sqliteClient;
    if (isShared || !client) {
      // A shared folder whose people have not loaded yet; never share it a second time.
      throw new SharingOperationError(isShared ? familySharingText.errors.inviteFailed : familySharingText.errors.createVaultFailed);
    }

    const result = await runSharingOperation('createSharedManifest', { name: folder.Name }, familySharingText.errors.createVaultFailed);
    const manifestId = (result.manifestId ?? '').toLowerCase();

    // The sync pushes the new shared folder; the contents then move into it with a push of their own.
    await syncVault();
    // The native store commits the move into the vault the sync just reopened, and marks it dirty for the push below.
    await client.folders.moveContentsToManifest({ Id: folder.Id, ManifestId: folder.ManifestId }, manifestId);
    await dbContext.refreshSyncState();
    await syncVault();
    emitter.emit('itemChanged');

    const created = sharingView(await SharingService.getOverview(webApi)).folders.find(candidate => candidate.manifest.manifestId.toLowerCase() === manifestId) ?? null;
    if (!created) {
      throw new SharingOperationError(familySharingText.errors.createVaultFailed);
    }
    onMoved({ Id: manifestId, ManifestId: manifestId }, true);
    return created;
  };

  /**
   * Invite somebody verified before (picked in the wizard), sharing a personal folder at this point.
   * @param userId - the person to invite.
   */
  const inviteKnown = async (userId: string): Promise<void> => {
    try {
      const target = await ensureShared();
      await runSharingOperation('inviteToSharedManifest', { groupId: target.group.groupId, manifestId: target.manifest.manifestId, userId }, familySharingText.errors.inviteFailed);
      setInviteNotice(familySharingText.invitationSent(shared.verifiedPeople.find(person => person.userId === userId)?.username ?? ''));
    } catch (inviteError) {
      throw new Error(sharingFailureMessage(inviteError, familySharingText.errors.inviteFailed));
    } finally {
      await shared.reload();
    }
  };

  /**
   * Find the account behind a code for the invite wizard, also before the folder is shared. Throws an error with the message to show.
   * @param code - the code entered.
   */
  const lookup = async (code: string): Promise<FamilyCodeAccount> => {
    try {
      const result = await runSharingOperation('lookupIdentityCode', { groupId: current?.group.groupId, identityCode: code }, familySharingText.errors.inviteFailed);
      if (result.alreadyMember) {
        throw new SharingOperationError(familySharingText.errors.alreadyHasAccess);
      }
      return { username: result.username ?? '' };
    } catch (lookupError) {
      throw new Error(sharingFailureMessage(lookupError, familySharingText.errors.inviteFailed));
    }
  };

  /**
   * Invite the account behind a code, sharing a personal folder at this point; the sync engine checks its key against the code and certifies it.
   * @param code - the code entered.
   */
  const inviteByCode = async (code: string): Promise<void> => {
    try {
      const target = await ensureShared();
      const result = await runSharingOperation('inviteToSharedManifest', { groupId: target.group.groupId, manifestId: target.manifest.manifestId, identityCode: code }, familySharingText.errors.inviteFailed);
      setInviteNotice(familySharingText.invitationSent(result.username ?? ''));
    } catch (inviteError) {
      throw new Error(sharingFailureMessage(inviteError, familySharingText.errors.inviteFailed));
    } finally {
      await shared.reload();
    }
  };

  /**
   * Open the invite wizard, which shows instead of the sheet.
   */
  const openInviteWizard = (): void => {
    setError(null);
    setNotice(null);
    setIsInviteOpen(true);
  };

  /**
   * Close the invite wizard and show the sheet again, with the wizard's notice.
   */
  const closeInviteWizard = (): void => {
    setIsInviteOpen(false);
    setNotice(inviteNotice);
    setInviteNotice(null);
  };

  /**
   * Turn a shared folder this account owns back into a personal one when nobody else is in it or invited anymore (as the
   * server sees it now): its contents move into a new personal folder with its name, then the empty shared folder is
   * deleted. Nothing is shared anymore, so this takes no master password.
   * @param manifestId - the shared folder.
   */
  const revertIfEmpty = async (manifestId: string): Promise<void> => {
    const latest = sharingView(await SharingService.getOverview(webApi)).folders.find(candidate => candidate.manifest.manifestId.toLowerCase() === manifestId.toLowerCase());
    const client = dbContext.sqliteClient;
    if (!latest || latest.group.role !== 'owner' || hasOtherPeople(latest, shared.myUserId) || !client) {
      return;
    }

    // The native store commits the move and marks the vault dirty; the sync pushes it before the shared folder goes.
    const personal = await client.folders.moveManifestToNewFolder(manifestId, folder.Name);
    await dbContext.refreshSyncState();
    await syncVault();
    await SharingService.unshareSharedManifest(webApi, latest.group.groupId, manifestId);
    await syncVault();
    emitter.emit('itemChanged');
    await shared.reload();
    onMoved(personal, false);
  };

  /**
   * Ask for confirmation, then for the master password, before taking a member's access away or handing back one's own.
   * The sheet hides first, so the confirmation and the password prompt show on top of the screen.
   * @param target - the shared folder.
   * @param member - the member losing access.
   * @param isSelf - whether the member is the current user.
   */
  const removeAccess = (target: SharedFolder, member: GroupMemberInfo, isSelf: boolean): void => {
    const title = isSelf ? familySharingText.leaveVault : familySharingText.revoke;
    const message = isSelf ? familySharingText.leaveVaultConfirm(folder.Name) : familySharingText.revokeAccessConfirm(member.username, folder.Name);
    const passwordPrompt = isSelf ? familySharingText.leaveVaultPasswordPrompt(folder.Name) : familySharingText.revokeAccessPasswordPrompt(member.username, folder.Name);

    /**
     * Confirmed: ask for the password, then show the sheet with a spinner while the change runs and syncs in.
     */
    const confirmed = async (): Promise<void> => {
      try {
        const done = await runWithPassword(title, passwordPrompt, title, async answerChallenge => {
          setBusy(true);
          setIsHidden(false);
          await (isSelf
            ? SharingService.leaveSharedManifest(webApi, target.group.groupId, target.manifest.manifestId, answerChallenge)
            : SharingService.revokeAccess(webApi, target.group.groupId, target.manifest.manifestId, member.userId, answerChallenge));
        });
        if (!done) {
          return;
        }
        await syncVault();
        emitter.emit('itemChanged');
        if (isSelf) {
          await shared.reload();
          onLeft();
          return;
        }
        // Taking the last other person out makes the folder personal again.
        await revertIfEmpty(target.manifest.manifestId);
        await shared.reload();
      } catch (removeError) {
        setError(sharingFailureMessage(removeError, familySharingText.errors.revokeAccessFailed));
      } finally {
        setBusy(false);
        setIsHidden(false);
      }
    };

    setError(null);
    setNotice(null);
    setIsHidden(true);
    /**
     * Cancelled: show the sheet again.
     */
    const cancelled = (): void => setIsHidden(false);

    showDialog(title, message, [
      { text: t('common.cancel'), style: 'cancel', onPress: cancelled },
      { text: title, style: 'destructive', onPress: confirmed },
    ]);
  };

  /*
   * A shared folder this account owns that nobody else is in anymore (they left, or an invitation was declined or expired
   * elsewhere) is personal again: turned back once when the sheet shows it, never while the invite wizard runs.
   */
  const revertCheckedRef = useRef<string | null>(null);
  const emptyOwnedManifestId = current && current.group.role === 'owner' && !hasOthers && !busy && !isInviteOpen && !isHidden ? current.manifest.manifestId : null;
  useEffect(() => {
    if (!emptyOwnedManifestId || revertCheckedRef.current === emptyOwnedManifestId) {
      return;
    }
    revertCheckedRef.current = emptyOwnedManifestId;
    void run(() => revertIfEmpty(emptyOwnedManifestId), familySharingText.errors.revokeAccessFailed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emptyOwnedManifestId]);

  const styles = StyleSheet.create({
    actionText: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '600',
    },
    actionTextDestructive: {
      color: colors.destructive,
    },
    addButton: {
      padding: 4,
    },
    banner: {
      borderRadius: 10,
      marginBottom: 12,
      padding: 12,
    },
    bannerError: {
      backgroundColor: colors.errorBackground,
    },
    bannerErrorText: {
      color: colors.errorText,
      fontSize: 14,
    },
    bannerSuccess: {
      backgroundColor: colors.successBackground,
    },
    bannerSuccessText: {
      color: colors.success,
      fontSize: 14,
    },
    busyBox: {
      alignItems: 'center',
      gap: 12,
      paddingVertical: 24,
    },
    busyText: {
      color: colors.textMuted,
      fontSize: 14,
    },
    codeTip: {
      gap: 6,
      marginTop: 16,
    },
    disabled: {
      opacity: 0.5,
    },
    hintText: {
      color: colors.textMuted,
      fontSize: 14,
    },
    memberName: {
      color: colors.text,
      fontSize: 14,
    },
    memberRow: {
      alignItems: 'center',
      borderTopColor: colors.accentBorder,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'space-between',
      paddingVertical: 10,
    },
    memberText: {
      flex: 1,
    },
    mutedText: {
      color: colors.textMuted,
      fontSize: 13,
    },
    peopleHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    peopleTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    primaryButton: {
      alignItems: 'center',
      alignSelf: 'flex-start',
      backgroundColor: colors.primary,
      borderRadius: 8,
      flexDirection: 'row',
      gap: 6,
      marginTop: 12,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    primaryButtonText: {
      color: colors.primarySurfaceText,
      fontSize: 14,
      fontWeight: '600',
    },
    tipText: {
      color: colors.textMuted,
      fontSize: 12,
    },
  });

  /**
   * One row of the people list, with whatever can be done about it on the right.
   */
  const renderRow = (key: string, name: string, detail: string, action?: React.ReactNode): React.ReactNode => (
    <View key={key} style={styles.memberRow}>
      <View style={styles.memberText}>
        <ThemedText style={styles.memberName} numberOfLines={1}>{name}</ThemedText>
        <ThemedText style={styles.mutedText}>{detail}</ThemedText>
      </View>
      {action}
    </View>
  );

  /**
   * A text button on the right of a row.
   */
  const renderAction = (label: string, onPress: () => void, destructive: boolean = false): React.ReactNode => (
    <TouchableOpacity onPress={onPress} disabled={busy} style={busy && styles.disabled}>
      <ThemedText style={[styles.actionText, destructive && styles.actionTextDestructive]}>{label}</ThemedText>
    </TouchableOpacity>
  );

  /**
   * The people with access and the pending invitees, with a + to invite more.
   */
  const renderPeople = (target: SharedFolder): React.ReactNode => (
    <View>
      <View style={styles.peopleHeader}>
        <ThemedText style={styles.peopleTitle}>{familySharingText.peopleTitle}</ThemedText>
        {canInvite && (
          <TouchableOpacity style={styles.addButton} onPress={openInviteWizard} disabled={busy} accessibilityRole="button" accessibilityLabel={familySharingText.invitePeople} hitSlop={8}>
            <Ionicons name="add" size={24} color={colors.primary} />
          </TouchableOpacity>
        )}
      </View>
      {target.group.members.map(member => {
        const access = describeMemberAccess(target.group, target.manifest, member, shared.myUserId);
        return renderRow(member.userId, access.isSelf ? `${member.username} (${familySharingText.you})` : member.username, roleLabel(member), (
          <>
            {access.canLeave && renderAction(familySharingText.leaveVault, () => removeAccess(target, member, true), true)}
            {access.canRevoke && renderAction(familySharingText.revoke, () => removeAccess(target, member, false), true)}
          </>
        ));
      })}
      {canAdministerGroup(target.group) && pendingInvitees(target).map(invitation => renderRow(invitation.id, invitation.inviteeUsername, familySharingText.invited, renderAction(familySharingText.withdraw, () => void run(async () => {
        await SharingService.withdrawInvitation(webApi, invitation.id);
        await revertIfEmpty(target.manifest.manifestId);
      }, familySharingText.errors.invitationGone))))}
    </View>
  );

  return (
    <>
      <ModalWrapper isOpen={!isInviteOpen && !isHidden} onClose={onClose} isSubmitting={busy} title={folder.Name} showCloseButton scrollable maxScrollHeight={480}>
        {/* While something runs (sharing, inviting, taking access away, making the folder personal) the content makes way for a spinner. */}
        {busy ? (
          <View style={styles.busyBox}>
            <ActivityIndicator color={colors.primary} />
            <ThemedText style={styles.busyText}>{t('common.loading')}</ThemedText>
          </View>
        ) : (
          <View>
            {error && <View style={[styles.banner, styles.bannerError]}><ThemedText style={styles.bannerErrorText}>{error}</ThemedText></View>}
            {notice && <View style={[styles.banner, styles.bannerSuccess]}><ThemedText style={styles.bannerSuccessText}>{notice}</ThemedText></View>}

            {!isShared && <ThemedText style={styles.hintText}>{familySharingText.shareFolderHint}</ThemedText>}

            {/* The people with access; only listed once anybody besides this account is in. */}
            {current && hasOthers && renderPeople(current)}

            {/* While an invitation waits, the code the invitee types to accept it is at hand here too. */}
            {current && canAdministerGroup(current.group) && pendingInvitees(current).length > 0 && shared.ownCode && (
              <View style={styles.codeTip}>
                <ThemedText style={styles.tipText}>{familySharingText.pendingCodeTip}</ThemedText>
                <FamilyCode code={shared.ownCode} isSmall />
              </View>
            )}

            {/* Nobody else in yet (or still a personal folder): inviting is the one thing to do, so it is shown prominently. */}
            {current && !hasOthers && <ThemedText style={styles.hintText}>{familySharingText.notSharedYet}</ThemedText>}
            {canInvite && !hasOthers && (
              <TouchableOpacity style={styles.primaryButton} activeOpacity={0.7} onPress={openInviteWizard}>
                <Ionicons name="add" size={18} color={colors.primarySurfaceText} />
                <ThemedText style={styles.primaryButtonText}>{familySharingText.invitePeople}</ThemedText>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ModalWrapper>

      <InviteMemberWizard
        isOpen={isInviteOpen}
        ownCode={shared.ownCode}
        folderName={folder.Name}
        sharesFolder={!isShared}
        onLookup={lookup}
        onInvite={inviteByCode}
        people={invitable.map(person => ({ userId: person.userId, username: person.username, problem: memberKeyProblem(person) }))}
        onInvitePerson={inviteKnown}
        onClose={closeInviteWizard}
      />
    </>
  );
};

export default SharedFolderAccessModal;
