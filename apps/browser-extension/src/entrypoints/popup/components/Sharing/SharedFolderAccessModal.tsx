import { canAdministerGroup, describeMemberAccess, familySharingText, hasOtherPeople, holdsManifestKey, invitablePeople, memberKeyProblem, pendingInvitees, roleLabel, sharingView, type SharedFolder } from '@aliasvault/client/sharing/FamilySharingView';
import { SharingService } from '@aliasvault/client/sharing/SharingService';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AlertMessage from '@/entrypoints/popup/components/AlertMessage';
import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';
import Icon from '@/entrypoints/popup/components/Icons/Icon';
import InlineSpinner from '@/entrypoints/popup/components/InlineSpinner';
import FamilyCodeDisplay from '@/entrypoints/popup/components/Sharing/FamilyCodeDisplay';
import InviteMemberWizard, { type FamilyCodeAccount } from '@/entrypoints/popup/components/Sharing/InviteMemberWizard';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';
import { usePasswordConfirmedAction } from '@/entrypoints/popup/hooks/usePasswordConfirmedAction';
import { type SharedFolders } from '@/entrypoints/popup/hooks/useSharedFolders';
import { useVaultMutate } from '@/entrypoints/popup/hooks/useVaultMutate';
import { SharingOperationError, sharingFailureMessage, unwrapSharingResult } from '@/entrypoints/popup/utils/SharingErrors';

import { sendMessage } from '@/utils/messaging/ExtensionMessaging';

import type { Folder, FolderRef } from '@aliasvault/client/database/repositories/FolderRepository';
import type { GroupMemberInfo } from '@aliasvault/models/webapi';

const PRIMARY_BUTTON_CLASS = 'px-3 py-1.5 text-sm rounded-md bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white';
const SMALL_DANGER_CLASS = 'shrink-0 px-2 py-1 text-xs rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50';
const SMALL_NEUTRAL_CLASS = 'shrink-0 px-2 py-1 text-xs rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50';

type SharedFolderAccessModalProps = {
  /** The top-level folder: a personal one (shared on the first invitation) or a shared one. */
  folder: Pick<Folder, 'Id' | 'ManifestId' | 'Name'>;
  /** Whether the folder is a shared one. */
  isShared: boolean;
  shared: SharedFolders;
  /** Called once the folder became a shared one or a personal one again, with the folder it is shown as now. */
  onMoved: (ref: FolderRef, isShared: boolean) => void;
  /** Called once this account left the shared folder, which is gone from its vault. */
  onLeft: () => void;
  onClose: () => void;
};

/**
 * The people of a folder: who has access, inviting someone new by their code or somebody verified before, and taking
 * access away. A personal folder becomes a shared folder on its first invitation.
 */
const SharedFolderAccessModal: React.FC<SharedFolderAccessModalProps> = ({ folder, isShared, shared, onMoved, onLeft, onClose }) => {
  const { t } = useTranslation();
  const webApi = useWebApi();
  const { loadStoredDatabase, getSqliteClient } = useDb();
  const { executeVaultMutationLocally } = useVaultMutate();
  const { askPassword, passwordModal } = usePasswordConfirmedAction();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  /** The notice of the invite wizard, shown once it closes rather than behind it. */
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);

  // Who is in the folder changes on other devices too, so the dialog shows the server's current view when it opens.
  const { reload } = shared;
  useEffect(() => {
    void reload();
  }, [reload]);

  const current = isShared ? shared.folders.find(candidate => candidate.manifest.manifestId.toLowerCase() === folder.ManifestId.toLowerCase()) ?? null : null;
  const others = shared.verifiedPeople.filter(person => person.userId !== shared.myUserId);
  const invitable = current ? invitablePeople(current, others) : others;
  const hasOthers = current !== null && hasOtherPeople(current, shared.myUserId);
  // A personal folder can always be shared; a shared folder takes an admin holding its key (and its overview loaded).
  const canInvite = isShared ? current !== null && canAdministerGroup(current.group) && holdsManifestKey(current.manifest, shared.myUserId) : true;

  /**
   * Sync with the server, throwing when the sync failed.
   * @param failureMessage - the message to show when it failed.
   */
  const syncVault = async (failureMessage: string): Promise<void> => {
    if (!(await sendMessage('FULL_VAULT_SYNC', {})).success) {
      throw new SharingOperationError(failureMessage);
    }
  };

  /**
   * Run one action, showing its error in the dialog, then reload what is shown.
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
   * Write one change into the open vault and push it, so the server has it before the next sharing call.
   * @param operation - the change.
   * @param failureMessage - the message to show when it could not be pushed.
   */
  const writeAndPush = async (operation: () => Promise<void>, failureMessage: string): Promise<void> => {
    await executeVaultMutationLocally(operation);
    await syncVault(failureMessage);
    await loadStoredDatabase();
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
    if (isShared) {
      // A shared folder whose people have not loaded yet; never share it a second time.
      throw new SharingOperationError(familySharingText.errors.inviteFailed);
    }

    // The background syncs the new shared folder to the server before it answers.
    const result = unwrapSharingResult(await sendMessage('GROUP_CREATE_VAULT', { name: folder.Name }));
    const manifestId = (result.manifestId ?? '').toLowerCase();

    // The contents move into the reopened vault, which then holds the new shared folder.
    await loadStoredDatabase();
    await writeAndPush(async () => {
      const client = getSqliteClient();
      if (!client) {
        throw new SharingOperationError(familySharingText.errors.createVaultFailed);
      }
      await client.folders.moveContentsToManifest({ Id: folder.Id, ManifestId: folder.ManifestId }, manifestId);
    }, familySharingText.errors.createVaultFailed);

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
      unwrapSharingResult(await sendMessage('GROUP_INVITE_MEMBER', { groupId: target.group.groupId, manifestId: target.manifest.manifestId, userId }));
      await loadStoredDatabase();
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
      const result = unwrapSharingResult(await sendMessage('GROUP_LOOKUP_IDENTITY_CODE', { groupId: current?.group.groupId, identityCode: code }));
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
      const result = unwrapSharingResult(await sendMessage('GROUP_INVITE_MEMBER_BY_CODE', { groupId: target.group.groupId, manifestId: target.manifest.manifestId, identityCode: code }));
      setInviteNotice(familySharingText.invitationSent(result.username ?? ''));
    } catch (inviteError) {
      throw new Error(sharingFailureMessage(inviteError, familySharingText.errors.inviteFailed));
    } finally {
      await shared.reload();
    }
  };

  /**
   * Turn a shared folder this account owns back into a personal one when nobody else is in it or invited anymore (as the
   * server sees it now): its contents move into a new personal folder with its name, then the empty shared folder is
   * deleted. Nothing is shared anymore, so this takes no master password.
   * @param manifestId - the shared folder.
   */
  const revertIfEmpty = async (manifestId: string): Promise<void> => {
    const latest = sharingView(await SharingService.getOverview(webApi)).folders.find(candidate => candidate.manifest.manifestId.toLowerCase() === manifestId.toLowerCase());
    if (!latest || latest.group.role !== 'owner' || hasOtherPeople(latest, shared.myUserId) || !getSqliteClient()) {
      return;
    }

    let personal: FolderRef | null = null;
    await writeAndPush(async () => {
      const client = getSqliteClient();
      if (!client) {
        throw new SharingOperationError(familySharingText.errors.revokeAccessFailed);
      }
      personal = await client.folders.moveManifestToNewFolder(manifestId, folder.Name);
    }, familySharingText.errors.revokeAccessFailed);
    await SharingService.unshareSharedManifest(webApi, latest.group.groupId, manifestId);
    await syncVault(familySharingText.errors.revokeAccessFailed);
    await loadStoredDatabase();
    await shared.reload();
    if (personal) {
      onMoved(personal, false);
    }
  };

  /**
   * Show the spinner while a password confirmed action runs and syncs in; a refused password takes it away again.
   * @param work - the action's work.
   */
  const withSpinner = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await work();
    } catch (workError) {
      setBusy(false);
      throw workError;
    }
  };

  /**
   * Ask for confirmation, then for the master password, before taking a member's access away or handing back one's own.
   * @param target - the shared folder.
   * @param member - the member losing access.
   * @param isSelf - whether the member is the current user.
   */
  const removeAccess = (target: SharedFolder, member: GroupMemberInfo, isSelf: boolean): void => {
    askPassword({
      title: isSelf ? familySharingText.leaveVault : familySharingText.revoke,
      confirmMessage: isSelf ? familySharingText.leaveVaultConfirm(folder.Name) : familySharingText.revokeAccessConfirm(member.username, folder.Name),
      confirmText: isSelf ? familySharingText.leaveVault : familySharingText.revoke,
      description: isSelf ? familySharingText.leaveVaultPasswordPrompt(folder.Name) : familySharingText.revokeAccessPasswordPrompt(member.username, folder.Name),
      failureMessage: familySharingText.errors.revokeAccessFailed,
      /**
       * Run the action with the password proof.
       * @param answerChallenge - answers the SRP challenge.
       */
      perform: answerChallenge => withSpinner(() => (isSelf
        ? SharingService.leaveSharedManifest(webApi, target.group.groupId, target.manifest.manifestId, answerChallenge)
        : SharingService.revokeAccess(webApi, target.group.groupId, target.manifest.manifestId, member.userId, answerChallenge))),
      /**
       * Sync the change in and leave the folder, which is gone for this account, when it was its own access.
       */
      onDone: async () => {
        setError(null);
        setNotice(null);
        try {
          await syncVault(familySharingText.errors.revokeAccessFailed);
          await loadStoredDatabase();
          if (!isSelf) {
            // Taking the last other person out makes the folder personal again.
            await revertIfEmpty(target.manifest.manifestId);
          }
          await shared.reload();
        } catch (revertError) {
          setError(sharingFailureMessage(revertError, familySharingText.errors.revokeAccessFailed));
        } finally {
          setBusy(false);
        }
        if (isSelf) {
          onLeft();
        }
      },
    });
  };

  /*
   * A shared folder this account owns that nobody else is in anymore (they left, or an invitation was declined or expired
   * elsewhere) is personal again: turned back once when the dialog shows it, never while the invite wizard runs.
   */
  const revertCheckedRef = useRef<string | null>(null);
  const emptyOwnedManifestId = current && current.group.role === 'owner' && !hasOthers && !busy && !isInviteOpen ? current.manifest.manifestId : null;
  useEffect(() => {
    if (!emptyOwnedManifestId || revertCheckedRef.current === emptyOwnedManifestId) {
      return;
    }
    revertCheckedRef.current = emptyOwnedManifestId;
    void run(() => revertIfEmpty(emptyOwnedManifestId), familySharingText.errors.revokeAccessFailed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emptyOwnedManifestId]);

  return (
    <>
      <ModalWrapper isOpen onClose={() => (isInviteOpen || busy ? undefined : onClose())} title={folder.Name} showCloseButton>
        {/* While something runs (sharing, inviting, taking access away, making the folder personal) the content makes way for a spinner. */}
        {busy && <InlineSpinner text={t('common.loading')} />}
        <div className={`space-y-3 ${busy ? 'hidden' : ''}`}>
          {error && <AlertMessage type="error" message={error} />}
          {notice && <AlertMessage type="success" message={notice} />}

          {!isShared && <p className="text-sm text-gray-600 dark:text-gray-400">{familySharingText.shareFolderHint}</p>}

          {/* The people with access, with a + to invite more; only listed once anybody besides this account is in. */}
          {current && hasOthers && (
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <h4 className="text-sm font-medium text-gray-900 dark:text-white">{familySharingText.peopleTitle}</h4>
                {canInvite && (
                  <button id="invite-someone-new" disabled={busy} onClick={() => setIsInviteOpen(true)} title={familySharingText.invitePeople} aria-label={familySharingText.invitePeople} className="p-1.5 rounded-md text-primary-600 hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-primary-900/30 disabled:opacity-50">
                    <Icon name="plus" className="w-4 h-4" />
                  </button>
                )}
              </div>
              <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {current.group.members.map(member => {
                  const access = describeMemberAccess(current.group, current.manifest, member, shared.myUserId);
                  return (
                    <li key={member.userId} className="flex items-center justify-between gap-2 py-1.5" data-person={member.username}>
                      <div className="min-w-0">
                        <p className="text-sm text-gray-900 dark:text-white truncate">{member.username}{access.isSelf && ` (${familySharingText.you})`}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{roleLabel(member)}</p>
                      </div>
                      {access.canLeave && <button disabled={busy} onClick={() => removeAccess(current, member, true)} className={SMALL_DANGER_CLASS}>{familySharingText.leaveVault}</button>}
                      {access.canRevoke && <button disabled={busy} onClick={() => removeAccess(current, member, false)} className={SMALL_DANGER_CLASS}>{familySharingText.revoke}</button>}
                    </li>
                  );
                })}
                {canAdministerGroup(current.group) && pendingInvitees(current).map(invitation => (
                  <li key={invitation.id} className="flex items-center justify-between gap-2 py-1.5" data-person={invitation.inviteeUsername}>
                    <div className="min-w-0">
                      <p className="text-sm text-gray-900 dark:text-white truncate">{invitation.inviteeUsername}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{familySharingText.invited}</p>
                    </div>
                    <button
                      disabled={busy}
                      onClick={() => void run(async () => {
                        await SharingService.withdrawInvitation(webApi, invitation.id);
                        await revertIfEmpty(current.manifest.manifestId);
                      }, familySharingText.errors.invitationGone)}
                      className={SMALL_NEUTRAL_CLASS}
                    >
                      {familySharingText.withdraw}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* While an invitation waits, the code the invitee types to accept it is at hand here too. */}
          {current && canAdministerGroup(current.group) && pendingInvitees(current).length > 0 && shared.ownCode && (
            <div className="space-y-1.5">
              <p className="text-xs text-gray-500 dark:text-gray-400">{familySharingText.pendingCodeTip}</p>
              <FamilyCodeDisplay code={shared.ownCode} isSmall />
            </div>
          )}

          {/* Nobody else in yet (or still a personal folder): inviting is the one thing to do, so it is shown prominently. */}
          {current && !hasOthers && <p className="text-sm text-gray-600 dark:text-gray-400">{familySharingText.notSharedYet}</p>}
          {canInvite && !hasOthers && (
            <button id="invite-someone-new" disabled={busy} onClick={() => setIsInviteOpen(true)} className={`${PRIMARY_BUTTON_CLASS} inline-flex items-center gap-1.5`}>
              <Icon name="plus" className="w-4 h-4" />
              {familySharingText.invitePeople}
            </button>
          )}
        </div>
      </ModalWrapper>

      <InviteMemberWizard
        isOpen={isInviteOpen}
        sharesFolder={!isShared}
        folderName={folder.Name}
        ownCode={shared.ownCode}
        people={invitable.map(person => ({ userId: person.userId, username: person.username, problem: memberKeyProblem(person) }))}
        onLookup={lookup}
        onInvite={inviteByCode}
        onInvitePerson={inviteKnown}
        onClose={() => {
          setIsInviteOpen(false);
          setNotice(inviteNotice);
          setInviteNotice(null);
        }}
      />

      {passwordModal}
    </>
  );
};

export default SharedFolderAccessModal;
