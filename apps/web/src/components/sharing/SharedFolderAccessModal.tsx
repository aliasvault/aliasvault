import { canAdministerGroup, describeMemberAccess, familySharingText, hasOtherPeople, holdsManifestKey, invitablePeople, memberKeyProblem, pendingInvitees, roleLabel, sharingView, type SharedFolder } from '@aliasvault/client/sharing/FamilySharingView';
import { SharingService } from '@aliasvault/client/sharing/SharingService';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AlertMessageError from '@/components/alerts/AlertMessageError';
import AlertMessageSuccess from '@/components/alerts/AlertMessageSuccess';
import FamilyCode from '@/components/settings/FamilyCode';
import InviteMemberWizard, { type FamilyCodeAccount } from '@/components/settings/InviteMemberWizard';
import Button from '@/components/shared/Button';
import FormModal from '@/components/shared/FormModal';
import Icon from '@/components/shared/Icon';
import InlineSpinner from '@/components/shared/InlineSpinner';
import SmallButton from '@/components/shared/SmallButton';
import { useConfirmModal } from '@/context/ConfirmModalContext';
import { useDb } from '@/context/DbContext';
import { useWebApi } from '@/context/WebApiContext';
import { usePasswordConfirmedAction } from '@/hooks/usePasswordConfirmedAction';
import { type SharedFolders } from '@/hooks/useSharedFolders';
import { useVaultMutate } from '@/hooks/useVaultMutate';
import { useVaultSync } from '@/hooks/useVaultSync';
import { SharingOperationError, sharingFailureMessage, unwrapSharingResult } from '@/utils/SharingErrors';
import { vaultStore } from '@/vault/VaultStore';

import type { Folder, FolderRef } from '@aliasvault/client/database/repositories/FolderRepository';
import type { GroupMemberInfo } from '@aliasvault/models/webapi';

type SharedFolderAccessModalProps = {
  isOpen: boolean;
  folder: Folder;
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
const SharedFolderAccessModal: React.FC<SharedFolderAccessModalProps> = ({ isOpen, folder, isShared, shared, onMoved, onLeft, onClose }) => {
  const { t } = useTranslation();
  const webApi = useWebApi();
  const { loadStoredDatabase, getSqliteClient } = useDb();
  const { syncVault } = useVaultSync();
  const { executeVaultMutationAsync } = useVaultMutate();
  const { showConfirmation } = useConfirmModal();
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
    if (isOpen) {
      void reload();
    }
  }, [isOpen, reload]);

  const current = isShared ? shared.folders.find(candidate => candidate.manifest.manifestId.toLowerCase() === folder.ManifestId.toLowerCase()) ?? null : null;
  const others = shared.verifiedPeople.filter(person => person.userId !== shared.myUserId);
  const invitable = current ? invitablePeople(current, others) : others;
  const hasOthers = current !== null && hasOtherPeople(current, shared.myUserId);
  const canInvite = isShared ? current !== null && canAdministerGroup(current.group) && holdsManifestKey(current.manifest, shared.myUserId) : true;

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

    const result = await vaultStore.createSharedManifest(folder.Name);
    unwrapSharingResult(result, familySharingText.errors.createVaultFailed, t);
    const manifestId = (result.manifestId ?? '').toLowerCase();

    // The sync pushes the new shared folder; the contents then move into it with a push of their own.
    await syncVault();
    const client = await loadStoredDatabase();
    if (!client) {
      throw new SharingOperationError(familySharingText.errors.createVaultFailed);
    }
    await executeVaultMutationAsync(async () => {
      await client.folders.moveContentsToManifest({ Id: folder.Id, ManifestId: folder.ManifestId }, manifestId);
    });

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
      unwrapSharingResult(await vaultStore.inviteToSharedManifest(target.group.groupId, target.manifest.manifestId, userId), familySharingText.errors.inviteFailed, t);
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
      const result = await vaultStore.lookupIdentityCode(current?.group.groupId, code);
      unwrapSharingResult(result, familySharingText.errors.inviteFailed, t);
      if (result.alreadyMember) {
        throw new SharingOperationError(familySharingText.errors.alreadyHasAccess);
      }
      return { username: result.username ?? '' };
    } catch (lookupError) {
      throw new Error(sharingFailureMessage(lookupError, familySharingText.errors.inviteFailed));
    }
  };

  /**
   * Invite the account behind a code, sharing a personal folder at this point, once the person is known and confirmed.
   * The sync engine checks their key against the code and certifies it.
   * @param code - the code entered.
   */
  const inviteByCode = async (code: string): Promise<void> => {
    try {
      const target = await ensureShared();
      const result = await vaultStore.inviteToSharedManifestByCode(target.group.groupId, target.manifest.manifestId, code);
      unwrapSharingResult(result, familySharingText.errors.inviteFailed, t);
      setInviteNotice(familySharingText.invitationSent(result.username ?? ''));
    } catch (inviteError) {
      throw new Error(sharingFailureMessage(inviteError, familySharingText.errors.inviteFailed));
    } finally {
      await shared.reload();
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
  const removeAccess = async (target: SharedFolder, member: GroupMemberInfo, isSelf: boolean): Promise<void> => {
    const confirmed = isSelf
      ? await showConfirmation(familySharingText.leaveVault, familySharingText.leaveVaultConfirm(folder.Name), familySharingText.leaveVault, t('common.cancel'))
      : await showConfirmation(familySharingText.revoke, familySharingText.revokeAccessConfirm(member.username, folder.Name), familySharingText.revoke, t('common.cancel'));
    if (!confirmed) {
      return;
    }

    askPassword({
      title: isSelf ? familySharingText.leaveVault : familySharingText.revoke,
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
        try {
          await syncVault();
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

  /**
   * Turn a shared folder this account owns back into a personal one when nobody else is in it or invited anymore (as the
   * server sees it now): its contents move into a new personal folder with its name, then the empty shared folder is
   * deleted. Nothing is shared anymore, so this takes no master password.
   * @param manifestId - the shared folder.
   */
  const revertIfEmpty = async (manifestId: string): Promise<void> => {
    const latest = sharingView(await SharingService.getOverview(webApi)).folders.find(candidate => candidate.manifest.manifestId.toLowerCase() === manifestId.toLowerCase());
    const client = getSqliteClient();
    if (!latest || latest.group.role !== 'owner' || hasOtherPeople(latest, shared.myUserId) || !client) {
      return;
    }

    let personal: FolderRef | null = null;
    await executeVaultMutationAsync(async () => {
      personal = await client.folders.moveManifestToNewFolder(manifestId, folder.Name);
    });
    await SharingService.unshareSharedManifest(webApi, latest.group.groupId, manifestId);
    await syncVault();
    await loadStoredDatabase();
    await shared.reload();
    if (personal) {
      onMoved(personal, false);
    }
  };

  /*
   * A shared folder this account owns that nobody else is in anymore (they left, or an invitation was declined or expired
   * elsewhere) is personal again: turned back once when the dialog shows it, never while the invite wizard runs.
   */
  const revertCheckedRef = useRef<string | null>(null);
  const emptyOwnedManifestId = isOpen && current && current.group.role === 'owner' && !hasOthers && !busy && !isInviteOpen ? current.manifest.manifestId : null;
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
      <FormModal
        isOpen={isOpen}
        title={folder.Name}
        showCloseButton
        showDefaultFooter={false}
        onClose={onClose}
      >
        {/* While something runs (sharing, inviting, taking access away, making the folder personal) the content makes way for a spinner. */}
        {busy && <InlineSpinner text={t('common.loading')} />}
        <div className={`space-y-4 ${busy ? 'hidden' : ''}`}>
          {error && <AlertMessageError message={error} hasTopMargin={false} />}
          {notice && <AlertMessageSuccess message={notice} />}

          {!isShared && <p className="text-sm text-gray-600 dark:text-gray-400">{familySharingText.shareFolderHint}</p>}

          {/* The people with access, with a + to invite more; only listed once anybody besides this account is in. */}
          {current && hasOthers && (
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="text-sm font-medium text-gray-900 dark:text-white">{familySharingText.peopleTitle}</h4>
                {canInvite && hasOthers && (
                  <button id="invite-someone-new" disabled={busy} onClick={() => setIsInviteOpen(true)} title={familySharingText.invitePeople} aria-label={familySharingText.invitePeople} className="p-1.5 rounded-md text-primary-600 hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-primary-900/30 disabled:opacity-50">
                    <Icon name="plus" className="w-5 h-5" />
                  </button>
                )}
              </div>
              <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {current.group.members.map(member => {
                  const access = describeMemberAccess(current.group, current.manifest, member, shared.myUserId);
                  return (
                    <li key={member.userId} className="flex items-center justify-between gap-2 py-2" data-person={member.username}>
                      <div className="min-w-0">
                        <p className="text-sm text-gray-900 dark:text-white truncate">{member.username}{access.isSelf && ` (${familySharingText.you})`}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{roleLabel(member)}</p>
                      </div>
                      {access.canLeave && <SmallButton color="danger" isDisabled={busy} onClick={() => void removeAccess(current, member, true)}>{familySharingText.leaveVault}</SmallButton>}
                      {access.canRevoke && <SmallButton color="danger" isDisabled={busy} onClick={() => void removeAccess(current, member, false)}>{familySharingText.revoke}</SmallButton>}
                    </li>
                  );
                })}
                {canAdministerGroup(current.group) && pendingInvitees(current).map(invitation => (
                  <li key={invitation.id} className="flex items-center justify-between gap-2 py-2" data-person={invitation.inviteeUsername}>
                    <div className="min-w-0">
                      <p className="text-sm text-gray-900 dark:text-white truncate">{invitation.inviteeUsername}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{familySharingText.invited}</p>
                    </div>
                    <SmallButton isDisabled={busy} onClick={() => void run(async () => {
                      await SharingService.withdrawInvitation(webApi, invitation.id);
                      await revertIfEmpty(current.manifest.manifestId);
                    }, familySharingText.errors.invitationGone)}>{familySharingText.withdraw}</SmallButton>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* While an invitation waits, the code the invitee types to accept it is at hand here too. */}
          {current && canAdministerGroup(current.group) && pendingInvitees(current).length > 0 && shared.ownCode && (
            <div className="space-y-1.5">
              <p className="text-xs text-gray-500 dark:text-gray-400">{familySharingText.pendingCodeTip}</p>
              <FamilyCode code={shared.ownCode} isSmall />
            </div>
          )}

          {/* Nobody else in yet (or still a personal folder): inviting is the one thing to do, so it is shown prominently. */}
          {current && !hasOthers && <p className="text-sm text-gray-600 dark:text-gray-400">{familySharingText.notSharedYet}</p>}
          {canInvite && !hasOthers && (
            <div>
              <Button id="invite-someone-new" isDisabled={busy} onClick={() => setIsInviteOpen(true)}>
                <span className="inline-flex items-center gap-2"><Icon name="plus" className="w-4 h-4" />{familySharingText.invitePeople}</span>
              </Button>
            </div>
          )}
        </div>
      </FormModal>

      <InviteMemberWizard
        isOpen={isInviteOpen}
        sharesFolder={!isShared}
        folderName={folder.Name}
        ownFamilyCode={shared.ownCode}
        onLookup={lookup}
        onInvite={inviteByCode}
        people={invitable.map(person => ({ userId: person.userId, username: person.username, problem: memberKeyProblem(person) }))}
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
