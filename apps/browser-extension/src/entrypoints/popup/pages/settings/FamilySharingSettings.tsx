import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AlertMessage from '@/entrypoints/popup/components/AlertMessage';
import ConfirmDeleteModal from '@/entrypoints/popup/components/Dialogs/ConfirmDeleteModal';
import ConfirmPasswordModal from '@/entrypoints/popup/components/Dialogs/ConfirmPasswordModal';
import PageTitle from '@/entrypoints/popup/components/PageTitle';
import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';

import type { GroupInfo, GroupMemberInfo, GroupOverviewResponse, SharedManifestInfo } from '@/utils/dist/core/models/webapi';
import { sendMessage } from '@/utils/messaging/ExtensionMessaging';
import { multiManifestRendering } from '@/utils/MultiManifestRendering';
import { SharingService } from '@/utils/SharingService';
import { ApiRequestError } from '@/utils/types/errors/ApiRequestError';

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
  const [invitationNames, setInvitationNames] = useState<Record<string, string>>({});

  const loadOverview = useCallback(async (): Promise<void> => {
    try {
      const loaded = await SharingService.getOverview(webApi);
      setOverview(loaded);
      setInvitationNames(sqliteClient ? await SharingService.openInvitationNames(sqliteClient, loaded.receivedInvitations) : {});
      const records = await SharingService.getSharedManifestRecords();
      const names = Object.fromEntries(Object.values(records).filter(record => record.name).map(record => [record.manifestId.toLowerCase(), record.name as string]));
      setVaultNames({ ...names, ...(sqliteClient ? multiManifestRendering.displayNames(sqliteClient) : {}) });
      setError(null);
    } catch {
      setError(t('sharing.family.errors.loadFailed'));
    } finally {
      setIsInitialLoading(false);
    }
  }, [webApi, sqliteClient, t, setIsInitialLoading]);

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

    switch (code) {
      case 'INVITE_RECIPIENT_NOT_READY': return t('sharing.family.errors.userNotReady');
      case 'NOT_GROUP_MEMBER': return t('sharing.family.errors.notFamilyMember');
      case 'ACCESS_ALREADY_GRANTED': return t('sharing.family.errors.alreadyHasAccess');
      case 'INVITATION_ALREADY_EXISTS': return t('sharing.family.errors.alreadyInvited');
      case 'INVITATION_NOT_FOUND': return t('sharing.family.errors.invitationGone');
      case 'INVITATION_KEY_OUTDATED': return t('sharing.family.errors.invitationKeyOutdated');
      case 'LAST_MANIFEST_GRANT_HOLDER': return t('sharing.family.errors.lastMemberWithAccess');
      case 'GROUP_MANIFEST_LIMIT_REACHED': return t('sharing.family.errors.vaultLimitReached');
      default: return code !== null ? `${fallback} [${code}]` : fallback;
    }
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
    }, t('sharing.family.errors.createVaultFailed'));
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
    setNotice(t('sharing.family.invitationSent', { username: member.username }));
  }, t('sharing.family.errors.inviteFailed'));

  /**
   * Accept an invitation, opening the shared manifest it names.
   * @param invitationId - the invitation to accept.
   */
  const acceptInvitation = (invitationId: string): Promise<void> => run(async () => {
    await SharingService.acceptInvitation(webApi, invitationId);
    await sendMessage('SYNC_VAULT');
    // Same as creating one: the sync wrote the joined vault to storage, and this window has to pick it up to render it.
    await loadStoredDatabase();
  }, t('sharing.family.errors.invitationGone'));

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
    }, t('sharing.family.errors.revokeAccessFailed'));
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
      await SharingService.deleteSharedManifest(webApi, target.group.groupId, target.manifest.manifestId, password);
    } catch (deleteError) {
      if (deleteError instanceof ApiRequestError && deleteError.apiErrorCode === 'PASSWORD_MISMATCH') {
        throw new Error(t('common.errors.wrongPassword'));
      }

      throw new Error(apiErrorMessage(deleteError, t('sharing.family.errors.deleteVaultFailed')));
    }

    setPendingVaultDelete(null);
    await run(async () => {
      await sendMessage('SYNC_VAULT');
      await loadStoredDatabase();
      setNotice(t('sharing.family.vaultDeleted'));
    }, t('sharing.family.errors.deleteVaultFailed'));
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
  const vaultLabel = (manifest: SharedManifestInfo): string => vaultNames[manifest.manifestId.toLowerCase()] ?? t('sharing.family.unnamedVault');

  /**
   * The role of a member as shown next to their name.
   * @param member - the member.
   */
  const roleLabel = (member: GroupMemberInfo): string => {
    switch (member.role) {
      case 'Owner': return t('sharing.owner');
      case 'Admin': return t('sharing.family.admin');
      default: return t('sharing.family.member');
    }
  };

  /**
   * The title and message of the confirmation dialog.
   */
  const removalDialog = (): { title: string; message: string; confirmText: string } => {
    if (!pendingRemoval) {
      return { title: '', message: '', confirmText: t('sharing.revoke') };
    }

    if (pendingRemoval.isSelf) {
      return {
        title: t('sharing.family.leaveVault'),
        message: t('sharing.family.leaveVaultConfirm', { vault: vaultLabel(pendingRemoval.manifest) }),
        confirmText: t('sharing.family.leaveVault'),
      };
    }

    return {
      title: t('sharing.revoke'),
      message: t('sharing.family.revokeAccessConfirm', { username: pendingRemoval.member.username, vault: vaultLabel(pendingRemoval.manifest) }),
      confirmText: t('sharing.revoke'),
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
      />

      <ConfirmDeleteModal
        isOpen={pendingVaultDelete?.stage === 'confirm'}
        onClose={() => setPendingVaultDelete(null)}
        onConfirm={() => setPendingVaultDelete(previous => (previous ? { ...previous, stage: 'password' } : previous))}
        title={t('sharing.family.deleteVault')}
        message={t('sharing.family.deleteVaultConfirm', { vault: pendingVaultDelete ? vaultLabel(pendingVaultDelete.manifest) : '' })}
        confirmText={t('common.delete')}
      />

      <ConfirmPasswordModal
        isOpen={pendingVaultDelete?.stage === 'password'}
        onClose={() => setPendingVaultDelete(null)}
        onConfirm={deleteSharedVault}
        title={t('sharing.family.deleteVault')}
        message={t('sharing.family.deleteVaultPasswordPrompt', { vault: pendingVaultDelete ? vaultLabel(pendingVaultDelete.manifest) : '' })}
        confirmText={t('common.delete')}
      />

      <div>
        <div className="flex items-center gap-2">
          <PageTitle>{t('sharing.family.title')}</PageTitle>
          <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 uppercase tracking-wide">
            {t('sharing.family.beta')}
          </span>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">{t('sharing.family.description')}</p>
      </div>

      {error && <AlertMessage type="error" message={error} />}
      {notice && <AlertMessage type="success" message={notice} />}

      {receivedInvitations.length > 0 && (
        <section>
          <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-2">{t('sharing.family.invitations')}</h3>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
            {receivedInvitations.map(invitation => (
              <div key={invitation.id} className="p-3 space-y-2">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{invitationNames[invitation.id] ?? t('sharing.family.unnamedVault')}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('sharing.family.invitedBy', { username: invitation.inviterUsername })}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={busy}
                    onClick={() => acceptInvitation(invitation.id)}
                    className="px-3 py-1.5 text-sm rounded-md bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white"
                  >
                    {t('sharing.family.accept')}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => run(() => SharingService.declineInvitation(webApi, invitation.id), t('sharing.family.errors.invitationGone'))}
                    className="px-3 py-1.5 text-sm rounded-md bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 text-gray-700 dark:text-gray-300"
                  >
                    {t('sharing.family.decline')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {groups.length === 0 && receivedInvitations.length === 0 && (
        <AlertMessage type="info" message={t('sharing.family.notAvailable')} />
      )}

      {groups.map(group => {
        const canAdminister = group.role === 'Owner' || group.role === 'Admin';
        const myUserId = group.members.find(member => member.username === app.username)?.userId ?? '';

        return (
          <section key={group.groupId} className="space-y-3">
            {/* The family's members. */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-3">
              <button onClick={() => toggleRoster(group.groupId)} className="flex items-center justify-between w-full text-left">
                <span className="font-medium text-gray-900 dark:text-white">{t('sharing.members')} ({group.members.length})</span>
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
                              {member.username}{isSelf && ` (${t('sharing.family.you')})`}
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

            {/* One block per shared folder, each with the members who can open it. */}
            {group.manifests.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-md font-semibold text-gray-900 dark:text-white">{t('sharing.family.sharedFolders')}</h3>
                {group.manifests.map(manifest => {
                  const iHoldKey = manifest.memberUserIds.includes(myUserId);

                  return (
                    <div key={manifest.manifestId} className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-gray-900 dark:text-white truncate">{vaultLabel(manifest)}</p>
                        {canAdminister && (
                          <button
                            disabled={busy}
                            onClick={() => setPendingVaultDelete({ group, manifest, stage: 'confirm' })}
                            className="shrink-0 px-2 py-1 text-xs rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50"
                          >
                            {t('common.delete')}
                          </button>
                        )}
                      </div>

                      {/* Inviting somebody seals this vault's key for them, which an admin who holds no grant on it cannot do. */}
                      {canAdminister && !iHoldKey && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">{t('sharing.family.cannotInviteWithoutAccess')}</p>
                      )}

                      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                        {group.members.map(member => {
                          const isSelf = member.userId === myUserId;
                          const hasAccess = manifest.memberUserIds.includes(member.userId);
                          const isInvited = manifest.pendingInvitations.some(invitation => invitation.inviteeUserId === member.userId);
                          const invitation = manifest.pendingInvitations.find(candidate => candidate.inviteeUserId === member.userId);

                          return (
                            <li key={member.userId} className="flex items-center justify-between gap-2 py-1.5 first:pt-0 last:pb-0">
                              <div className="min-w-0">
                                <p className="text-sm text-gray-900 dark:text-white truncate">
                                  {member.username}{isSelf && ` (${t('sharing.family.you')})`}
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  {hasAccess ? t('sharing.family.hasAccess') : isInvited ? t('sharing.family.invited') : t('sharing.family.noAccess')}
                                </p>
                              </div>

                              {/* An admin's own grant stays put: it is the only copy of the key their duties, inviting others among them, need. */}
                              {hasAccess && isSelf && !canAdminister && (
                                <button
                                  disabled={busy}
                                  onClick={() => setPendingRemoval({ group, manifest, member, isSelf })}
                                  className="shrink-0 px-2 py-1 text-xs rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50"
                                >
                                  {t('sharing.family.leaveVault')}
                                </button>
                              )}

                              {hasAccess && !isSelf && canAdminister && (
                                <button
                                  disabled={busy}
                                  onClick={() => setPendingRemoval({ group, manifest, member, isSelf })}
                                  className="shrink-0 px-2 py-1 text-xs rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50"
                                >
                                  {t('sharing.revoke')}
                                </button>
                              )}

                              {isInvited && !isSelf && canAdminister && invitation && (
                                <button
                                  disabled={busy}
                                  onClick={() => run(() => SharingService.withdrawInvitation(webApi, invitation.id), t('sharing.family.errors.invitationGone'))}
                                  className="shrink-0 px-2 py-1 text-xs rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                                >
                                  {t('sharing.family.withdraw')}
                                </button>
                              )}

                              {!hasAccess && !isInvited && !isSelf && canAdminister && iHoldKey && (
                                <button
                                  disabled={busy || !member.publicKey}
                                  title={member.publicKey ? undefined : t('sharing.family.errors.userNotReady')}
                                  onClick={() => inviteMember(group, manifest, member)}
                                  className="shrink-0 px-2 py-1 text-xs rounded-md bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white"
                                >
                                  {t('sharing.family.invite')}
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

            {/* Creating another shared folder. */}
            {(canAdminister || group.manifests.length === 0) && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                {group.manifests.length === 0 && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {canAdminister ? t('sharing.family.noSharedVaultAdmin') : t('sharing.family.noSharedVaultMember')}
                  </p>
                )}

                {canAdminister && (
                  <>
                    <p className="font-medium text-gray-900 dark:text-white">{t('sharing.family.createSharedVault')}</p>
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
                        placeholder={t('sharing.family.vaultNamePlaceholder')}
                        className="flex-1 min-w-0 px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                      <button
                        type="submit"
                        disabled={busy}
                        className="shrink-0 px-3 py-1.5 text-sm rounded-md bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white"
                      >
                        {t('sharing.family.create')}
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
