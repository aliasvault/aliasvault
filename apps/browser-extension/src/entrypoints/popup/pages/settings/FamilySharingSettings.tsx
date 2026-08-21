import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AlertMessage from '@/entrypoints/popup/components/AlertMessage';
import ConfirmDeleteModal from '@/entrypoints/popup/components/Dialogs/ConfirmDeleteModal';
import PageTitle from '@/entrypoints/popup/components/PageTitle';
import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';

import type { GroupInfo, GroupMemberInfo, GroupOverviewResponse } from '@/utils/dist/core/models/webapi';
import { sendMessage } from '@/utils/messaging/ExtensionMessaging';
import { SharingService } from '@/utils/SharingService';
import { ApiRequestError } from '@/utils/types/errors/ApiRequestError';

/** The member the confirmation dialog is about, together with the family they would be removed from. */
type PendingRemoval = { group: GroupInfo; member: GroupMemberInfo; isSelf: boolean };

class BackgroundActionError extends Error {}
class BackgroundApiError extends Error {}

/**
 * Family sharing settings page: create a family's shared vault, invite people to it, and answer invitations others
 * sent.
 */
const FamilySharingSettings: React.FC = () => {
  const { t } = useTranslation();
  const app = useApp();
  const webApi = useWebApi();
  const { loadStoredDatabase } = useDb();
  const { setIsInitialLoading } = useLoading();

  const [overview, setOverview] = useState<GroupOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteUsernames, setInviteUsernames] = useState<Record<string, string>>({});
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);

  const loadOverview = useCallback(async (): Promise<void> => {
    try {
      setOverview(await SharingService.getOverview(webApi));
      setError(null);
    } catch {
      setError(t('sharing.family.errors.loadFailed'));
    } finally {
      setIsInitialLoading(false);
    }
  }, [webApi, t, setIsInitialLoading]);

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
      case 'INVITE_RECIPIENT_NOT_FOUND': return t('sharing.family.errors.userNotFound');
      case 'INVITE_RECIPIENT_NOT_READY': return t('sharing.family.errors.userNotReady');
      case 'ALREADY_GROUP_MEMBER': return t('sharing.family.errors.alreadyMember');
      case 'INVITATION_ALREADY_EXISTS': return t('sharing.family.errors.alreadyInvited');
      case 'INVITATION_NOT_FOUND': return t('sharing.family.errors.invitationGone');
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
   * Create the family's shared vault.
   * @param group - the family to create the vault for.
   */
  const createSharedVault = (group: GroupInfo): Promise<void> => run(async () => {
    unwrap(await sendMessage('GROUP_CREATE_VAULT', { groupId: group.groupId }));
    // The family's folder was written into the stored vault by the background script; this window is still holding the copy from before it.
    await loadStoredDatabase();
  }, t('sharing.family.errors.createVaultFailed'));

  /**
   * Invite the typed username to the family.
   * @param group - the family to invite into.
   */
  const invite = (group: GroupInfo): Promise<void> => {
    const username = (inviteUsernames[group.groupId] ?? '').trim();
    if (username.length === 0) {
      return Promise.resolve();
    }

    return run(async () => {
      unwrap(await sendMessage('GROUP_INVITE_MEMBER', { groupId: group.groupId, username }));
      setInviteUsernames(previous => ({ ...previous, [group.groupId]: '' }));
      setNotice(t('sharing.family.inviteSent'));
    }, t('sharing.family.errors.inviteFailed'));
  };

  /**
   * Accept an invitation, joining the family.
   * @param invitationId - the invitation to accept.
   */
  const acceptInvitation = (invitationId: string): Promise<void> => run(async () => {
    await SharingService.acceptInvitation(webApi, invitationId);
    await sendMessage('SYNC_VAULT');
    // Same as creating one: the sync wrote the joined vault to storage, and this window has to pick it up to render it.
    await loadStoredDatabase();
  }, t('sharing.family.errors.invitationGone'));

  /**
   * Remove the member the confirmation dialog is about.
   */
  const confirmRemoval = (): Promise<void> => {
    const removal = pendingRemoval;
    setPendingRemoval(null);
    if (!removal) {
      return Promise.resolve();
    }

    return run(async () => {
      unwrap(await sendMessage('GROUP_REMOVE_MEMBER', { groupId: removal.group.groupId, userId: removal.member.userId }));
    }, t('sharing.family.errors.removeMemberFailed'));
  };

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

  const receivedInvitations = overview?.receivedInvitations ?? [];
  const groups = overview?.groups ?? [];

  return (
    <div className="space-y-6">
      <ConfirmDeleteModal
        isOpen={pendingRemoval !== null}
        onClose={() => setPendingRemoval(null)}
        onConfirm={confirmRemoval}
        title={pendingRemoval?.isSelf ? t('sharing.family.leaveFamily') : t('common.remove')}
        message={pendingRemoval?.isSelf
          ? t('sharing.family.leaveFamilyConfirm')
          : t('sharing.family.removeMemberConfirm', { username: pendingRemoval?.member.username ?? '' })}
        confirmText={pendingRemoval?.isSelf ? t('sharing.family.leaveFamily') : t('common.remove')}
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
          <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-3">{t('sharing.family.invitations')}</h3>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
            {receivedInvitations.map(invitation => (
              <div key={invitation.id} className="p-4 space-y-3">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{t('sharing.family.invitationReceived', { name: invitation.groupName })}</p>
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

        return (
          <section key={group.groupId}>
            <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-3">{group.name}</h3>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
              {/* Shared vault: the folder the family's items live in, created on request rather than automatically. */}
              <div className="p-4 space-y-3">
                <p className="font-medium text-gray-900 dark:text-white">{t('sharing.family.sharedVault')}</p>
                {group.manifestId ? (
                  <p className="text-sm text-gray-600 dark:text-gray-400">{t('sharing.family.sharedVaultActive', { name: group.name })}</p>
                ) : (
                  <>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {canAdminister ? t('sharing.family.noSharedVaultAdmin') : t('sharing.family.noSharedVaultMember')}
                    </p>
                    {canAdminister && (
                      <button
                        disabled={busy}
                        onClick={() => createSharedVault(group)}
                        className="px-3 py-1.5 text-sm rounded-md bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white"
                      >
                        {t('sharing.family.createSharedVault')}
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* Members, each with whether they can actually open the shared vault yet. */}
              <div className="p-4 space-y-3">
                <p className="font-medium text-gray-900 dark:text-white">{t('sharing.members')}</p>
                <ul className="space-y-2">
                  {group.members.map(member => {
                    const isSelf = member.username === app.username;
                    const canRemove = member.role !== 'Owner' && (isSelf || canAdminister);

                    return (
                      <li key={member.userId} className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm text-gray-900 dark:text-white truncate">
                            {member.username}{isSelf && ` (${t('sharing.family.you')})`}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {roleLabel(member)}
                            {group.manifestId && ` · ${t('sharing.family.hasAccess')}`}
                          </p>
                        </div>
                        {canRemove && (
                          <button
                            disabled={busy}
                            onClick={() => setPendingRemoval({ group, member, isSelf })}
                            className="shrink-0 px-2 py-1 text-xs rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50"
                          >
                            {isSelf ? t('sharing.family.leaveFamily') : t('common.remove')}
                          </button>
                        )}
                      </li>
                    );
                  })}

                  {group.pendingInvitations.map(invitation => (
                    <li key={invitation.id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-gray-900 dark:text-white truncate">{invitation.inviteeUsername}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{t('sharing.family.invited')}</p>
                      </div>
                      <button
                        disabled={busy}
                        onClick={() => run(() => SharingService.withdrawInvitation(webApi, invitation.id), t('sharing.family.errors.invitationGone'))}
                        className="shrink-0 px-2 py-1 text-xs rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                      >
                        {t('sharing.family.withdraw')}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              {canAdminister && group.manifestId && (
                <div className="p-4 space-y-3">
                  <p className="font-medium text-gray-900 dark:text-white">{t('sharing.family.inviteMember')}</p>
                  <form
                    className="flex gap-2"
                    onSubmit={event => {
                      event.preventDefault();
                      invite(group);
                    }}
                  >
                    <input
                      type="text"
                      value={inviteUsernames[group.groupId] ?? ''}
                      onChange={event => setInviteUsernames(previous => ({ ...previous, [group.groupId]: event.target.value }))}
                      placeholder={t('sharing.family.usernamePlaceholder')}
                      className="flex-1 min-w-0 px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                    <button
                      type="submit"
                      disabled={busy}
                      className="shrink-0 px-3 py-1.5 text-sm rounded-md bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white"
                    >
                      {t('sharing.family.invite')}
                    </button>
                  </form>
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
};

export default FamilySharingSettings;
