import { ApiRequestError } from '@aliasvault/client/api/errors/ApiRequestError';
import { MasterPasswordService } from '@aliasvault/client/auth/MasterPasswordService';
import { canAdministerGroup, describeMemberAccess, familySharingText, holdsManifestKey, ownUserIdIn, roleLabel, sharingErrorMessage } from '@aliasvault/client/sharing/FamilySharingView';
import { multiManifestRendering } from '@aliasvault/client/sharing/MultiManifestRendering';
import { SharingService } from '@aliasvault/client/sharing/SharingService';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AlertMessage from '@/entrypoints/popup/components/AlertMessage';
import ConfirmDeleteModal from '@/entrypoints/popup/components/Dialogs/ConfirmDeleteModal';
import ConfirmPasswordModal from '@/entrypoints/popup/components/Dialogs/ConfirmPasswordModal';
import FolderModal from '@/entrypoints/popup/components/Folders/FolderModal';
import { HeaderIcon, HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import PageTitle from '@/entrypoints/popup/components/PageTitle';
import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';

import { sendMessage } from '@/utils/messaging/ExtensionMessaging';

import type { GroupInfo, GroupMemberInfo, GroupOverviewResponse, SharedManifestInfo } from '@aliasvault/models/webapi';

/**
 * The access removal the confirmation dialog is about.
 */
type PendingRemoval = { group: GroupInfo; manifest: SharedManifestInfo; member: GroupMemberInfo; isSelf: boolean };

/**
 * A shared manifest deletion in progress: first a plain warning, then the master password confirmation.
 */
type PendingVaultDelete = { group: GroupInfo; manifest: SharedManifestInfo; stage: 'confirm' | 'password' };

/** A failure the background script already put into words for the user. */
class BackgroundActionError extends Error {}

/** A failure the background script reported as a bare API error code. */
class BackgroundApiError extends Error {}

/**
 * Family sharing settings page: create a family's shared manifests, invite the members of that family to them, and
 * answer the invitations others sent.
 */
const FamilySharingSettings: React.FC = () => {
  const { t } = useTranslation();
  const app = useApp();
  const webApi = useWebApi();
  const { sqliteClient, loadStoredDatabase } = useDb();
  const { setIsInitialLoading } = useLoading();

  const [overview, setOverview] = useState<GroupOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newVaultNames, setNewVaultNames] = useState<Record<string, string>>({});
  const [vaultNames, setVaultNames] = useState<Record<string, string>>({});
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  const [pendingVaultDelete, setPendingVaultDelete] = useState<PendingVaultDelete | null>(null);
  const [expandedRosters, setExpandedRosters] = useState<Record<string, boolean>>({});
  const [openVaultMenuId, setOpenVaultMenuId] = useState<string | null>(null);
  const [pendingVaultRename, setPendingVaultRename] = useState<{ group: GroupInfo; manifest: SharedManifestInfo } | null>(null);
  const [invitationNames, setInvitationNames] = useState<Record<string, string>>({});

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
      setIsInitialLoading(false);
    }
  }, [webApi, sqliteClient, setIsInitialLoading]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  /**
   * Run one action.
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
   * The message to show for a failed action.
   * @param actionError - the error thrown by the call.
   * @param fallback - the message for everything else.
   */
  const apiErrorMessage = (actionError: unknown, fallback: string): string => {
    if (actionError instanceof BackgroundActionError) {
      // The background script says why in the user's own language; that reason beats anything this page could guess.
      return actionError.message.length > 0 ? actionError.message : fallback;
    }

    const code = actionError instanceof BackgroundApiError
      ? actionError.message
      : actionError instanceof ApiRequestError ? actionError.apiErrorCode : null;

    const knownError = sharingErrorMessage(code);
    if (knownError) {
      return knownError;
    }

    return code !== null ? `${fallback} [${code}]` : fallback;
  };

  /**
   * Send one background message and turn a failure into the error the screen knows how to report.
   * @param result - what the background script answered.
   */
  const unwrap = (result: { success: boolean; error?: string; apiErrorCode?: string }): void => {
    if (result.success) {
      return;
    }

    throw result.apiErrorCode ? new BackgroundApiError(result.apiErrorCode) : new BackgroundActionError(result.error ?? '');
  };

  /**
   * Create another shared manifest for the family.
   * @param group - the family to create it for.
   */
  const createSharedVault = (group: GroupInfo): Promise<void> => {
    const name = (newVaultNames[group.groupId] ?? '').trim();
    if (name.length === 0) {
      return Promise.resolve();
    }

    return run(async () => {
      unwrap(await sendMessage('GROUP_CREATE_VAULT', { groupId: group.groupId, name }));
      setNewVaultNames(previous => ({ ...previous, [group.groupId]: '' }));
      await loadStoredDatabase();
    }, familySharingText.errors.createVaultFailed);
  };

  /**
   * Rename a shared manifest, which only an administrator of the family may do.
   * @param name - the new name.
   */
  const renameSharedVault = async (name: string): Promise<void> => {
    if (!pendingVaultRename) {
      return;
    }

    unwrap(await sendMessage('GROUP_UPDATE_VAULT', { groupId: pendingVaultRename.group.groupId, manifestId: pendingVaultRename.manifest.manifestId, details: { name } }));
    await loadStoredDatabase();
  };

  /**
   * Invite one member to one shared manifest.
   * @param group - the family the vault belongs to.
   * @param manifest - the vault.
   * @param member - the member being invited.
   */
  const inviteMember = (group: GroupInfo, manifest: SharedManifestInfo, member: GroupMemberInfo): Promise<void> => run(async () => {
    unwrap(await sendMessage('GROUP_INVITE_MEMBER', { groupId: group.groupId, manifestId: manifest.manifestId, userId: member.userId }));
    await loadStoredDatabase();
    setNotice(familySharingText.invitationSent(member.username));
  }, familySharingText.errors.inviteFailed);

  /**
   * Accept an invitation, opening the shared manifest it names.
   * @param invitationId - the invitation to accept.
   */
  const acceptInvitation = (invitationId: string): Promise<void> => run(async () => {
    await SharingService.acceptInvitation(webApi, invitationId);
    await sendMessage('FULL_VAULT_SYNC', {});
    // Same as creating one: the sync wrote the joined vault to storage, and this window has to pick it up to render it.
    await loadStoredDatabase();
  }, familySharingText.errors.invitationGone);

  /**
   * Carry out the access removal the confirmation dialog was about.
   */
  const confirmRemoval = (): Promise<void> => {
    const removal = pendingRemoval;
    setPendingRemoval(null);
    if (!removal) {
      return Promise.resolve();
    }

    return run(async () => {
      unwrap(await sendMessage('GROUP_REVOKE_ACCESS', { groupId: removal.group.groupId, manifestId: removal.manifest.manifestId, userId: removal.member.userId }));
      await loadStoredDatabase();
    }, familySharingText.errors.revokeAccessFailed);
  };

  /**
   * Delete a shared manifest with password confirmation.
   * @param password - the entered master password.
   */
  const deleteSharedVault = async (password: string): Promise<void> => {
    const target = pendingVaultDelete;
    if (!target) {
      return;
    }

    try {
      await SharingService.deleteSharedManifest(webApi, target.group.groupId, target.manifest.manifestId, async challenge => (await MasterPasswordService.answerSrpChallenge(challenge, password)).proof);
    } catch (deleteError) {
      if (deleteError instanceof ApiRequestError && deleteError.apiErrorCode === 'PASSWORD_MISMATCH') {
        throw new Error(t('common.errors.wrongPassword'));
      }

      throw new Error(apiErrorMessage(deleteError, familySharingText.errors.deleteVaultFailed));
    }

    setPendingVaultDelete(null);
    await run(async () => {
      await sendMessage('FULL_VAULT_SYNC', {});
      await loadStoredDatabase();
      setNotice(familySharingText.vaultDeleted);
    }, familySharingText.errors.deleteVaultFailed);
  };

  /**
   * Whether a family's roster is expanded.
   * @param groupId - the family.
   */
  const isRosterExpanded = (groupId: string): boolean => expandedRosters[groupId] ?? false;

  /**
   * Toggle a family's roster open or shut.
   * @param groupId - the family.
   */
  const toggleRoster = (groupId: string): void => setExpandedRosters(previous => ({ ...previous, [groupId]: !isRosterExpanded(groupId) }));

  /**
   * What to call a shared manifest on screen.
   * @param manifest - the vault.
   */
  const vaultLabel = (manifest: SharedManifestInfo): string => vaultNames[manifest.manifestId.toLowerCase()] ?? familySharingText.sharedVault;

  /**
   * The title and message of the confirmation dialog.
   */
  const removalDialog = (): { title: string; message: string; confirmText: string; warning?: string } => {
    if (!pendingRemoval) {
      return { title: '', message: '', confirmText: familySharingText.revoke };
    }

    if (pendingRemoval.isSelf) {
      return {
        title: familySharingText.leaveVault,
        message: familySharingText.leaveVaultConfirm(vaultLabel(pendingRemoval.manifest)),
        confirmText: familySharingText.leaveVault,
      };
    }

    return {
      title: familySharingText.revoke,
      message: familySharingText.revokeAccessConfirm(pendingRemoval.member.username, vaultLabel(pendingRemoval.manifest)),
      confirmText: familySharingText.revoke,
      warning: familySharingText.revokeAccessWarning,
    };
  };

  const receivedInvitations = overview?.receivedInvitations ?? [];
  const groups = overview?.groups ?? [];
  const dialog = removalDialog();

  return (
    <div className="space-y-4">
      <ConfirmDeleteModal
        isOpen={pendingRemoval !== null}
        onClose={() => setPendingRemoval(null)}
        onConfirm={confirmRemoval}
        title={dialog.title}
        message={dialog.message}
        confirmText={dialog.confirmText}
        warning={dialog.warning}
      />

      <FolderModal
        isOpen={pendingVaultRename !== null}
        onClose={() => setPendingVaultRename(null)}
        onSave={renameSharedVault}
        initialName={pendingVaultRename ? vaultLabel(pendingVaultRename.manifest) : ''}
        mode="edit"
      />

      <ConfirmDeleteModal
        isOpen={pendingVaultDelete?.stage === 'confirm'}
        onClose={() => setPendingVaultDelete(null)}
        onConfirm={() => setPendingVaultDelete(previous => (previous ? { ...previous, stage: 'password' } : previous))}
        title={familySharingText.deleteVault}
        message={familySharingText.deleteVaultConfirm(pendingVaultDelete ? vaultLabel(pendingVaultDelete.manifest) : '')}
        confirmText={t('common.delete')}
      />

      <ConfirmPasswordModal
        isOpen={pendingVaultDelete?.stage === 'password'}
        onClose={() => setPendingVaultDelete(null)}
        onConfirm={deleteSharedVault}
        title={familySharingText.deleteVault}
        message={familySharingText.deleteVaultPasswordPrompt(pendingVaultDelete ? vaultLabel(pendingVaultDelete.manifest) : '')}
        confirmText={t('common.delete')}
      />

      <div>
        <div className="flex items-center gap-2">
          <PageTitle>{familySharingText.title}</PageTitle>
          <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 uppercase tracking-wide">
            {familySharingText.beta}
          </span>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">{familySharingText.description}</p>
      </div>

      {error && <AlertMessage type="error" message={error} />}
      {notice && <AlertMessage type="success" message={notice} />}

      {receivedInvitations.length > 0 && (
        <section>
          <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-2">{familySharingText.invitations}</h3>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
            {receivedInvitations.map(invitation => (
              <div key={invitation.id} className="p-3 space-y-2">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{invitationNames[invitation.id] ?? familySharingText.sharedVault}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{familySharingText.invitedBy(invitation.inviterUsername)}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={busy}
                    onClick={() => acceptInvitation(invitation.id)}
                    className="px-3 py-1.5 text-sm rounded-md bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white"
                  >
                    {familySharingText.accept}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => run(() => SharingService.declineInvitation(webApi, invitation.id), familySharingText.errors.invitationGone)}
                    className="px-3 py-1.5 text-sm rounded-md bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 text-gray-700 dark:text-gray-300"
                  >
                    {familySharingText.decline}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {groups.length === 0 && receivedInvitations.length === 0 && (
        <AlertMessage type="info" message={familySharingText.notAvailable} />
      )}

      {groups.map(group => {
        const canAdminister = canAdministerGroup(group);
        const myUserId = ownUserIdIn(group, app.username);

        return (
          <section key={group.groupId} className="space-y-3">
            {/* The family's members. */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-3">
              <button onClick={() => toggleRoster(group.groupId)} className="flex items-center justify-between w-full text-left">
                <span className="font-medium text-gray-900 dark:text-white">{familySharingText.members} ({group.members.length})</span>
                <svg className={`w-5 h-5 text-gray-500 transition-transform ${isRosterExpanded(group.groupId) ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isRosterExpanded(group.groupId) && (
                <div className="mt-2 space-y-2">
                  <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                    {group.members.map(member => {
                      const isSelf = member.userId === myUserId;

                      return (
                        <li key={member.userId} className="flex items-center justify-between gap-2 py-1.5 first:pt-0 last:pb-0">
                          <div className="min-w-0">
                            <p className="text-sm text-gray-900 dark:text-white truncate">
                              {member.username}{isSelf && ` (${familySharingText.you})`}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{roleLabel(member)}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>

            {/* One block per shared manifest, each with the members who can open it. */}
            {group.manifests.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-md font-semibold text-gray-900 dark:text-white">{familySharingText.sharedVaults}</h3>
                {group.manifests.map(manifest => {
                  const iHoldKey = holdsManifestKey(manifest, myUserId);

                  return (
                    <div key={manifest.manifestId} className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-gray-900 dark:text-white truncate">{vaultLabel(manifest)}</p>
                        {/* Deleting a shared manifest is hidden behind a settings gear icon menu. */}
                        {canAdminister && (
                          <div className="relative shrink-0">
                            <button
                              disabled={busy}
                              onClick={() => setOpenVaultMenuId(previous => (previous === manifest.manifestId ? null : manifest.manifestId))}
                              title={t('common.settings')}
                              aria-label={t('common.settings')}
                              className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                            >
                              <HeaderIcon type={HeaderIconType.SETTINGS} className="w-4 h-4" />
                            </button>

                            {openVaultMenuId === manifest.manifestId && (
                              <>
                                <div className="fixed inset-0 z-10" onClick={() => setOpenVaultMenuId(null)} />
                                <div className="absolute right-0 top-full mt-1 w-44 py-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-20">
                                  {/* Renaming encrypts the name with the vault's key, so it takes a member who holds it. */}
                                  {iHoldKey && (
                                    <button
                                      onClick={() => {
                                        setOpenVaultMenuId(null);
                                        setPendingVaultRename({ group, manifest });
                                      }}
                                      className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                                    >
                                      {t('items.editFolder')}
                                    </button>
                                  )}
                                  <button
                                    onClick={() => {
                                      setOpenVaultMenuId(null);
                                      setPendingVaultDelete({ group, manifest, stage: 'confirm' });
                                    }}
                                    className="w-full px-3 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                                  >
                                    {familySharingText.deleteVault}
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Inviting somebody encrypts this vault's key for them, which an admin who holds no grant on it cannot do. */}
                      {canAdminister && !iHoldKey && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">{familySharingText.cannotInviteWithoutAccess}</p>
                      )}

                      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                        {group.members.map(member => {
                          const access = describeMemberAccess(group, manifest, member, myUserId);
                          const { isSelf, invitation } = access;

                          return (
                            <li key={member.userId} className="flex items-center justify-between gap-2 py-1.5 first:pt-0 last:pb-0">
                              <div className="min-w-0">
                                <p className="text-sm text-gray-900 dark:text-white truncate">
                                  {member.username}{isSelf && ` (${familySharingText.you})`}
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  {access.statusText}
                                </p>
                              </div>

                              {access.canLeave && (
                                <button
                                  disabled={busy}
                                  onClick={() => setPendingRemoval({ group, manifest, member, isSelf })}
                                  className="shrink-0 px-2 py-1 text-xs rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50"
                                >
                                  {familySharingText.leaveVault}
                                </button>
                              )}

                              {access.canRevoke && (
                                <button
                                  disabled={busy}
                                  onClick={() => setPendingRemoval({ group, manifest, member, isSelf })}
                                  className="shrink-0 px-2 py-1 text-xs rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50"
                                >
                                  {familySharingText.revoke}
                                </button>
                              )}

                              {access.canWithdraw && invitation && (
                                <button
                                  disabled={busy}
                                  onClick={() => run(() => SharingService.withdrawInvitation(webApi, invitation.id), familySharingText.errors.invitationGone)}
                                  className="shrink-0 px-2 py-1 text-xs rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                                >
                                  {familySharingText.withdraw}
                                </button>
                              )}

                              {access.canInvite && (
                                <button
                                  disabled={busy || !access.isReadyForInvite}
                                  title={access.isReadyForInvite ? undefined : familySharingText.errors.userNotReady}
                                  onClick={() => inviteMember(group, manifest, member)}
                                  className="shrink-0 px-2 py-1 text-xs rounded-md bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white"
                                >
                                  {familySharingText.invite}
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Creating another shared manifest. */}
            {(canAdminister || group.manifests.length === 0) && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                {group.manifests.length === 0 && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {canAdminister ? familySharingText.noSharedVaultAdmin : familySharingText.noSharedVaultMember}
                  </p>
                )}

                {canAdminister && (
                  <>
                    <p className="font-medium text-gray-900 dark:text-white">{familySharingText.createSharedVault}</p>
                    <form
                      className="flex gap-2"
                      onSubmit={event => {
                        event.preventDefault();
                        createSharedVault(group);
                      }}
                    >
                      <input
                        type="text"
                        value={newVaultNames[group.groupId] ?? ''}
                        onChange={event => setNewVaultNames(previous => ({ ...previous, [group.groupId]: event.target.value }))}
                        placeholder={familySharingText.vaultNamePlaceholder}
                        className="flex-1 min-w-0 px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                      <button
                        type="submit"
                        disabled={busy}
                        className="shrink-0 px-3 py-1.5 text-sm rounded-md bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white"
                      >
                        {familySharingText.create}
                      </button>
                    </form>
                  </>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
};

export default FamilySharingSettings;
