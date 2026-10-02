import { apiErrorCodeOf } from '@aliasvault/client/api/errors/ApiRequestError';
import { AppErrorCode, formatErrorWithCode } from '@aliasvault/client/api/errors/AppErrorCodes';
import { MasterPasswordService } from '@aliasvault/client/auth/MasterPasswordService';
import { canAdministerGroup, describeMemberAccess, familySharingText, holdsManifestKey, ownUserIdIn, roleLabel, sharingErrorMessage } from '@aliasvault/client/sharing/FamilySharingView';
import { multiManifestRendering } from '@aliasvault/client/sharing/MultiManifestRendering';
import { SharingService } from '@aliasvault/client/sharing/SharingService';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import AlertMessageError from '@/components/alerts/AlertMessageError';
import AlertMessageSuccess from '@/components/alerts/AlertMessageSuccess';
import FolderIcon from '@/components/folders/FolderIcon';
import FolderModal from '@/components/folders/FolderModal';
import LoadingIndicator from '@/components/loading/LoadingIndicator';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import Button from '@/components/shared/Button';
import Card from '@/components/shared/Card';
import Icon from '@/components/shared/Icon';
import InputTextField from '@/components/shared/InputTextField';
import PageContent from '@/components/shared/PageContent';
import PasswordConfirmationModal from '@/components/shared/PasswordConfirmationModal';
import RefreshButton from '@/components/shared/RefreshButton';
import SectionTitle from '@/components/shared/SectionTitle';
import SmallButton from '@/components/shared/SmallButton';
import { useAuth } from '@/context/AuthContext';
import { useConfirmModal } from '@/context/ConfirmModalContext';
import { useDb } from '@/context/DbContext';
import { useLoading } from '@/context/LoadingContext';
import { useWebApi } from '@/context/WebApiContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVaultSync } from '@/hooks/useVaultSync';
import { folderRoute } from '@/utils/ItemRoute';
import { vaultStore } from '@/vault/VaultStore';

import type { SharingOperationResult } from '@aliasvault/client/sync/VaultSync';
import type { GroupInfo, GroupMemberInfo, GroupOverviewResponse, ReceivedManifestInvitation, SharedManifestInfo } from '@aliasvault/models/webapi';
type ManifestTarget = { group: GroupInfo; manifest: SharedManifestInfo };

/**
 * Error thrown by a failed sharing operation.
 */
class SharingOperationError extends Error {}

/**
 * Props for the invitation card.
 */
type InvitationCardProps = {
  vaultName: string;
  inviterUsername: string;
  isDisabled: boolean;
  onAccept: () => void;
  onDecline: () => void;
};

/**
 * An invitation to a shared manifest, highlighted as something that waits for the user to answer.
 */
const InvitationCard: React.FC<InvitationCardProps> = ({ vaultName, inviterUsername, isDisabled, onAccept, onDecline }) => (
  <Card variant="tile" className="flex flex-col gap-4 border-primary-400 ring-2 ring-primary-200 dark:border-primary-500 dark:ring-primary-900/60">
    <div className="flex items-center gap-2 min-w-0">
      <FolderIcon isShared className="w-5 h-5 text-orange-500" />
      <div className="min-w-0">
        <p className="text-lg font-medium text-gray-900 dark:text-white truncate" title={vaultName}>{vaultName}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400">{familySharingText.invitedBy(inviterUsername)}</p>
      </div>
    </div>
    <div className="flex justify-end gap-2">
      <Button color="secondary" isDisabled={isDisabled} onClick={onDecline}>{familySharingText.decline}</Button>
      <Button isDisabled={isDisabled} onClick={onAccept}>{familySharingText.accept}</Button>
    </div>
  </Card>
);

/**
 * Family sharing page: create a family's shared manifests, invite its members to them, and answer invitations.
 */
const FamilySharing: React.FC = () => {
  const { t } = useTranslation();
  const webApi = useWebApi();
  const { showLoading, hideLoading } = useLoading();
  const { username } = useAuth();
  const { sqliteClient, loadStoredDatabase } = useDb();
  const { syncVault } = useVaultSync();
  const { showConfirmation } = useConfirmModal();
  usePageTitle(familySharingText.title);

  const [overview, setOverview] = useState<GroupOverviewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newVaultNames, setNewVaultNames] = useState<Record<string, string>>({});
  const [vaultNames, setVaultNames] = useState<Record<string, string>>({});
  const [invitationNames, setInvitationNames] = useState<Record<string, string>>({});
  const [openVaultMenuId, setOpenVaultMenuId] = useState<string | null>(null);
  const [pendingVaultRename, setPendingVaultRename] = useState<ManifestTarget | null>(null);
  const [pendingVaultDelete, setPendingVaultDelete] = useState<ManifestTarget | null>(null);
  const [deletePasswordError, setDeletePasswordError] = useState('');

  const loadOverview = useCallback(async (): Promise<void> => {
    try {
      const loaded = await SharingService.getOverview(webApi);
      setOverview(loaded);
      setInvitationNames(await SharingService.openInvitationNames(loaded.receivedInvitations));
      setVaultNames(sqliteClient ? multiManifestRendering.displayNames(sqliteClient) : {});
      setError(null);
    } catch {
      setError(familySharingText.errors.loadFailed);
    } finally {
      setIsLoading(false);
    }
  }, [webApi, sqliteClient, setIsLoading]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  /**
   * The message to show for a failed action.
   * @param actionError - the error thrown by the call.
   * @param fallback - the message for everything else.
   */
  const apiErrorMessage = (actionError: unknown, fallback: string): string => {
    if (actionError instanceof SharingOperationError) {
      return actionError.message;
    }

    const code = apiErrorCodeOf(actionError);
    const knownError = sharingErrorMessage(code);
    if (knownError) {
      return knownError;
    }

    return code !== null ? `${fallback} [${code}]` : fallback;
  };

  /**
   * Run one action, then reload so the page shows what the server holds now.
   * @param action - the action to run.
   * @param failureMessage - what to show when it fails without a more specific reason.
   */
  const run = async (action: () => Promise<void>, failureMessage: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);

    let failure: string | null = null;
    try {
      await action();
    } catch (actionError) {
      failure = apiErrorMessage(actionError, failureMessage);
    }

    await loadOverview();

    if (failure !== null) {
      setError(failure);
    }

    setBusy(false);
  };

  /**
   * Throw the error a failed sync engine sharing operation stands for.
   * @param result - what the operation returned.
   * @param fallback - the message for a failure without a more specific reason.
   */
  const unwrap = (result: SharingOperationResult, fallback: string): void => {
    if (result.success) {
      return;
    }

    if (result.vaultUpgradeRequired) {
      throw new SharingOperationError(familySharingText.errors.vaultUpgradeRequired);
    }

    if (result.errorCode === AppErrorCode.VAULT_LOCKED) {
      throw new SharingOperationError(formatErrorWithCode(t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED));
    }

    const knownError = sharingErrorMessage(result.apiErrorCode);
    const code = result.apiErrorCode ?? result.error;
    throw new SharingOperationError(knownError ?? (code ? `${fallback} [${code}]` : fallback));
  };

  /**
   * Sync, then reopen the stored vault so shared manifest folders and names show the change.
   */
  const syncAndReload = async (): Promise<void> => {
    await syncVault();
    await loadStoredDatabase();
  };

  /**
   * Sync the vault and reload the overview, to pick up what other family members changed.
   */
  const refresh = async (): Promise<void> => {
    setIsLoading(true);
    try {
      await syncAndReload();
      await loadOverview();
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Create another shared manifest for the family. The sync that follows pushes it to the server.
   * @param group - the family to create it for.
   */
  const createSharedVault = (group: GroupInfo): Promise<void> => {
    const name = (newVaultNames[group.groupId] ?? '').trim();
    if (name.length === 0) {
      return Promise.resolve();
    }

    return run(async () => {
      unwrap(await vaultStore.createSharedManifest(group.groupId, name), familySharingText.errors.createVaultFailed);
      setNewVaultNames(previous => ({ ...previous, [group.groupId]: '' }));
      await syncAndReload();
    }, familySharingText.errors.createVaultFailed);
  };

  /**
   * Rename a shared manifest, which only an administrator of the family may do. Throws so the modal shows the error.
   * @param name - the new name.
   */
  const renameSharedVault = async (name: string): Promise<void> => {
    const target = pendingVaultRename;
    if (!target) {
      return;
    }

    try {
      unwrap(await vaultStore.updateSharedManifest(target.group.groupId, target.manifest.manifestId, { name }), t('common.errors.unknownErrorTryAgain'));
    } catch (renameError) {
      throw new Error(apiErrorMessage(renameError, t('common.errors.unknownErrorTryAgain')));
    }

    await syncAndReload();
    await loadOverview();
  };

  /**
   * Invite one member to one shared manifest.
   * @param group - the family the shared manifest belongs to.
   * @param manifest - the shared manifest.
   * @param member - the member being invited.
   */
  const inviteMember = (group: GroupInfo, manifest: SharedManifestInfo, member: GroupMemberInfo): Promise<void> => run(async () => {
    unwrap(await vaultStore.inviteToSharedManifest(group.groupId, manifest.manifestId, member.userId), familySharingText.errors.inviteFailed);
    await loadStoredDatabase();
    setNotice(familySharingText.invitationSent(member.username));
  }, familySharingText.errors.inviteFailed);

  /**
   * Accept an invitation; the sync that follows pulls the joined shared manifest.
   * @param invitationId - the invitation to accept.
   */
  const acceptInvitation = (invitationId: string): Promise<void> => run(async () => {
    await SharingService.acceptInvitation(webApi, invitationId);
    await syncAndReload();
  }, familySharingText.errors.invitationGone);

  /**
   * Ask for confirmation, then take a member's access to a shared manifest away, or hand back one's own.
   * @param group - the family.
   * @param manifest - the shared manifest.
   * @param member - the member losing access.
   * @param isSelf - whether the member is the current user.
   */
  const removeAccess = async (group: GroupInfo, manifest: SharedManifestInfo, member: GroupMemberInfo, isSelf: boolean): Promise<void> => {
    const vault = vaultLabel(manifest);
    const confirmed = isSelf
      ? await showConfirmation(familySharingText.leaveVault, familySharingText.leaveVaultConfirm(vault), familySharingText.leaveVault, t('common.cancel'))
      : await showConfirmation(familySharingText.revoke, `${familySharingText.revokeAccessConfirm(member.username, vault)}\n\n${familySharingText.revokeAccessWarning}`, familySharingText.revoke, t('common.cancel'));
    if (!confirmed) {
      return;
    }

    await run(async () => {
      await SharingService.revokeAccess(webApi, group.groupId, manifest.manifestId, member.userId);
      await syncAndReload();
    }, familySharingText.errors.revokeAccessFailed);
  };

  /**
   * Ask for confirmation, then for the master password, before deleting a shared manifest.
   * @param target - the shared manifest to delete.
   */
  const startVaultDelete = async (target: ManifestTarget): Promise<void> => {
    const confirmed = await showConfirmation(familySharingText.deleteVault, familySharingText.deleteVaultConfirm(vaultLabel(target.manifest)), t('common.delete'), t('common.cancel'));
    if (confirmed) {
      setDeletePasswordError('');
      setPendingVaultDelete(target);
    }
  };

  /**
   * Delete a shared manifest with the entered master password.
   * @param password - the entered master password.
   */
  const deleteSharedVault = async (password: string): Promise<void> => {
    const target = pendingVaultDelete;
    if (!target) {
      return;
    }

    setBusy(true);
    showLoading();
    try {
      await SharingService.deleteSharedManifest(webApi, target.group.groupId, target.manifest.manifestId, async challenge => (await MasterPasswordService.answerSrpChallenge(challenge, password)).proof);
    } catch (deleteError) {
      setDeletePasswordError(apiErrorCodeOf(deleteError) === 'PASSWORD_MISMATCH' ? t('common.errors.wrongPassword') : apiErrorMessage(deleteError, familySharingText.errors.deleteVaultFailed));
      setBusy(false);
      return;
    } finally {
      hideLoading();
    }

    setPendingVaultDelete(null);
    await run(async () => {
      await syncAndReload();
      setNotice(familySharingText.vaultDeleted);
    }, familySharingText.errors.deleteVaultFailed);
  };

  /**
   * What to call a shared manifest on screen.
   * @param manifest - the shared manifest.
   */
  const vaultLabel = (manifest: SharedManifestInfo): string => vaultNames[manifest.manifestId.toLowerCase()] ?? familySharingText.sharedVault;

  const receivedInvitations = overview?.receivedInvitations ?? [];
  const groups = overview?.groups ?? [];
  // An invitation shows in its family's shared vaults; one for a family this overview does not list shows on its own.
  const orphanInvitations = receivedInvitations.filter(invitation => !groups.some(group => group.groupId.toLowerCase() === invitation.groupId.toLowerCase()));

  /**
   * The card of one received invitation.
   * @param invitation - the invitation.
   */
  const invitationCard = (invitation: ReceivedManifestInvitation): React.ReactNode => (
    <InvitationCard
      key={invitation.id}
      vaultName={invitationNames[invitation.id] ?? familySharingText.sharedVault}
      inviterUsername={invitation.inviterUsername}
      isDisabled={busy}
      onAccept={() => void acceptInvitation(invitation.id)}
      onDecline={() => void run(() => SharingService.declineInvitation(webApi, invitation.id), familySharingText.errors.invitationGone)}
    />
  );

  return (
    <>
      <SettingsPageHeader
        icon="familySharing"
        title={familySharingText.title}
        description={familySharingText.description}
        customActions={<RefreshButton onClick={refresh} buttonText={t('common.refresh')} />}
        titleSuffix={<span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 uppercase tracking-wide">{familySharingText.beta}</span>}
      />

      <FolderModal
        isOpen={pendingVaultRename !== null}
        onClose={() => setPendingVaultRename(null)}
        onSave={renameSharedVault}
        initialName={pendingVaultRename ? vaultLabel(pendingVaultRename.manifest) : ''}
        mode="edit"
      />

      <PasswordConfirmationModal
        isOpen={pendingVaultDelete !== null}
        title={familySharingText.deleteVault}
        description={familySharingText.deleteVaultPasswordPrompt(pendingVaultDelete ? vaultLabel(pendingVaultDelete.manifest) : '')}
        errorMessage={deletePasswordError}
        onPasswordSubmitted={password => void deleteSharedVault(password)}
        onClose={() => setPendingVaultDelete(null)}
      />

      <PageContent>
        <div className="mx-4">
          {error && <div className="mb-4"><AlertMessageError message={error} hasTopMargin={false} /></div>}
          {notice && <AlertMessageSuccess message={notice} />}
        </div>

        {isLoading && <LoadingIndicator />}

        {!isLoading && orphanInvitations.length > 0 && (
          <section className="mx-4 mb-6">
            <SectionTitle className="mb-4">{familySharingText.invitations}</SectionTitle>
            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
              {orphanInvitations.map(invitationCard)}
            </div>
          </section>
        )}

        {!isLoading && overview && groups.length === 0 && receivedInvitations.length === 0 && (
          <Card><p className="text-sm text-gray-600 dark:text-gray-400">{familySharingText.notAvailable}</p></Card>
        )}

        {!isLoading && groups.map(group => {
          const canAdminister = canAdministerGroup(group);
          const myUserId = ownUserIdIn(group, username);
          const groupInvitations = receivedInvitations.filter(invitation => invitation.groupId.toLowerCase() === group.groupId.toLowerCase());
          const invitedManifestIds = new Set(groupInvitations.map(invitation => invitation.manifestId.toLowerCase()));

          return (
            <section key={group.groupId} className="mx-4 mb-6 space-y-6">
              {/* The family's members. */}
              <Card variant="tile">
                <SectionTitle className="mb-3">{familySharingText.members} ({group.members.length})</SectionTitle>
                <ul className="flex flex-wrap gap-x-10 gap-y-3">
                  {group.members.map(member => (
                    <li key={member.userId} className="min-w-0">
                      <p className="text-sm text-gray-900 dark:text-white truncate">{member.username}{member.userId === myUserId && ` (${familySharingText.you})`}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{roleLabel(member)}</p>
                    </li>
                  ))}
                </ul>
              </Card>

              <div className="min-w-0">
                <SectionTitle className="mb-0">{familySharingText.sharedVaults}</SectionTitle>
                <p className="mt-1 mb-4 text-sm text-gray-500 dark:text-gray-400">{familySharingText.sharedVaultsHint}</p>

                {/* One card per shared manifest, each with the members who can open it. */}
                <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {/* Invitations first: they wait for an answer, and stand in for the vault's own card until accepted. */}
                  {groupInvitations.map(invitationCard)}

                  {group.manifests.filter(manifest => !invitedManifestIds.has(manifest.manifestId.toLowerCase())).map(manifest => {
                    const iHoldKey = holdsManifestKey(manifest, myUserId);
                    // The shared manifest's folder exists in this vault once the manifest itself does.
                    const folderId = manifest.manifestId.toLowerCase();
                    const hasFolder = vaultNames[folderId] !== undefined;

                    return (
                      <Card key={manifest.manifestId} variant="tile">
                        <div className="flex items-center gap-1 -mx-2 -mt-2 mb-2">
                          {hasFolder ? (
                            <Link to={folderRoute({ Id: folderId, ManifestId: folderId })} className="flex flex-1 items-center gap-2 min-w-0 px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                              <FolderIcon isShared className="w-5 h-5 text-orange-500" />
                              <span className="text-lg font-medium text-gray-900 dark:text-white truncate" title={vaultLabel(manifest)}>{vaultLabel(manifest)}</span>
                              <Icon name="chevron-right" className="w-4 h-4 ml-auto shrink-0 text-gray-400" />
                            </Link>
                          ) : (
                            <div className="flex flex-1 items-center gap-2 min-w-0 px-2 py-1.5">
                              <FolderIcon isShared className="w-5 h-5 text-orange-500" />
                              <span className="text-lg font-medium text-gray-900 dark:text-white truncate" title={vaultLabel(manifest)}>{vaultLabel(manifest)}</span>
                            </div>
                          )}
                          {canAdminister && (
                            <div className="relative shrink-0">
                              <button
                                disabled={busy}
                                onClick={() => setOpenVaultMenuId(previous => (previous === manifest.manifestId ? null : manifest.manifestId))}
                                aria-label={t('common.edit')}
                                className="p-1.5 rounded-md text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                              >
                                <Icon name="cog" className="w-5 h-5" />
                              </button>

                              {openVaultMenuId === manifest.manifestId && (
                                <>
                                  <div className="fixed inset-0 z-10" onClick={() => setOpenVaultMenuId(null)} />
                                  <div className="absolute right-0 top-full mt-1 w-48 py-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl z-20">
                                    {/* Renaming encrypts the name with the shared manifest's key, so it takes a member who holds it. */}
                                    {iHoldKey && (
                                      <button
                                        onClick={() => {
                                          setOpenVaultMenuId(null);
                                          setPendingVaultRename({ group, manifest });
                                        }}
                                        className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600"
                                      >
                                        {t('items.folders.editFolder')}
                                      </button>
                                    )}
                                    <button
                                      onClick={() => {
                                        setOpenVaultMenuId(null);
                                        void startVaultDelete({ group, manifest });
                                      }}
                                      className="w-full px-4 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-600"
                                    >
                                      {familySharingText.deleteVault}
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Inviting somebody encrypts this shared manifest's key for them, which an admin without a grant on it cannot do. */}
                        {canAdminister && !iHoldKey && (
                          <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">{familySharingText.cannotInviteWithoutAccess}</p>
                        )}

                        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                          {group.members.map(member => {
                            const access = describeMemberAccess(group, manifest, member, myUserId);
                            const { isSelf, invitation } = access;

                            return (
                              <li key={member.userId} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                                <div className="min-w-0">
                                  <p className="text-sm text-gray-900 dark:text-white truncate">{member.username}{isSelf && ` (${familySharingText.you})`}</p>
                                  <p className="text-xs text-gray-500 dark:text-gray-400">{access.statusText}</p>
                                </div>

                                {access.canLeave && (
                                  <SmallButton color="danger" isDisabled={busy} onClick={() => void removeAccess(group, manifest, member, isSelf)}>{familySharingText.leaveVault}</SmallButton>
                                )}

                                {access.canRevoke && (
                                  <SmallButton color="danger" isDisabled={busy} onClick={() => void removeAccess(group, manifest, member, isSelf)}>{familySharingText.revoke}</SmallButton>
                                )}

                                {access.canWithdraw && invitation && (
                                  <SmallButton isDisabled={busy} onClick={() => void run(() => SharingService.withdrawInvitation(webApi, invitation.id), familySharingText.errors.invitationGone)}>{familySharingText.withdraw}</SmallButton>
                                )}

                                {access.canInvite && (
                                  <SmallButton
                                    color="primary"
                                    isDisabled={busy || !access.isReadyForInvite}
                                    title={access.isReadyForInvite ? undefined : familySharingText.errors.userNotReady}
                                    onClick={() => void inviteMember(group, manifest, member)}
                                  >
                                    {familySharingText.invite}
                                  </SmallButton>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </Card>
                    );
                  })}

                  {/* Creating another shared manifest. */}
                  {(canAdminister || group.manifests.length === 0) && (
                    <Card variant="tile" className="border-dashed">
                      {group.manifests.length === 0 && (
                        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">{canAdminister ? familySharingText.noSharedVaultAdmin : familySharingText.noSharedVaultMember}</p>
                      )}

                      {canAdminister && (
                        <>
                          <h4 className="mb-3 text-base font-medium text-gray-900 dark:text-white">{familySharingText.createSharedVault}</h4>
                          <form
                            className="flex gap-2"
                            onSubmit={event => {
                              event.preventDefault();
                              void createSharedVault(group);
                            }}
                          >
                            <div className="flex-1 min-w-0">
                              <InputTextField
                                id={`new-vault-name-${group.groupId}`}
                                value={newVaultNames[group.groupId] ?? ''}
                                onValueChange={value => setNewVaultNames(previous => ({ ...previous, [group.groupId]: value }))}
                                placeholder={familySharingText.vaultNamePlaceholder}
                              />
                            </div>
                            <Button type="submit" isDisabled={busy}>{familySharingText.create}</Button>
                          </form>
                        </>
                      )}
                    </Card>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </PageContent>
    </>
  );
};

export default FamilySharing;
