import { ApiRequestError } from '@aliasvault/client/api/errors/ApiRequestError';
import { canAdministerGroup, describeMemberAccess, holdsManifestKey, ownUserIdIn, roleTranslationKey, sharingErrorTranslationKey } from '@aliasvault/client/sharing/FamilySharingView';
import { multiManifestRendering } from '@aliasvault/client/sharing/MultiManifestRendering';
import { SharingService } from '@aliasvault/client/sharing/SharingService';
import { CapabilityKeys } from '@aliasvault/models/webapi';
import { Ionicons } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

import { HapticsUtility } from '@/utils/HapticsUtility';
import { VaultUnlockHelper } from '@/utils/VaultUnlockHelper';

import { useColors } from '@/hooks/useColorScheme';
import { useMinDurationLoading } from '@/hooks/useMinDurationLoading';
import { useVaultSync } from '@/hooks/useVaultSync';

import { FolderModal } from '@/components/folders/FolderModal';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { SkeletonLoader } from '@/components/ui/SkeletonLoader';
import { useApp } from '@/context/AppContext';
import { useCapabilityContext } from '@/context/CapabilityContext';
import { useDb } from '@/context/DbContext';
import { useDialog } from '@/context/DialogContext';
import { useWebApi } from '@/context/WebApiContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

import type { GroupInfo, GroupMemberInfo, GroupOverviewResponse, SharedManifestInfo } from '@aliasvault/models/webapi';

/** A sharing operation that failed with a reason already put into words for the user. */
class SharingOperationError extends Error {}

/**
 * Family sharing screen: create a family's shared folders, invite the members of that family to them, and answer the
 * invitations others sent.
 */
export default function FamilySharingScreen(): React.ReactNode {
  const colors = useColors();
  const webApi = useWebApi();
  const { t } = useTranslation();
  const { username } = useApp();
  const { sqliteClient } = useDb();
  const { isEnabled, isLoaded } = useCapabilityContext();
  const { showConfirm } = useDialog();
  const { syncVault } = useVaultSync();

  const [overview, setOverview] = useState<GroupOverviewResponse | null>(null);
  const [vaultNames, setVaultNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isLoading, setIsLoading] = useMinDurationLoading(true, 200);
  const [isRefreshing, setIsRefreshing] = useMinDurationLoading(false, 200);
  const [expandedRosters, setExpandedRosters] = useState<Record<string, boolean>>({});
  const [newVaultNames, setNewVaultNames] = useState<Record<string, string>>({});
  const [pendingVaultRename, setPendingVaultRename] = useState<{ group: GroupInfo; manifest: SharedManifestInfo } | null>(null);
  const [invitationNames, setInvitationNames] = useState<Record<string, string>>({});

  /**
   * Load the families, their shared folders and the open invitations, plus the names this vault has for them.
   */
  const loadOverview = useCallback(async (): Promise<void> => {
    try {
      const loaded = await SharingService.getOverview(webApi);
      setOverview(loaded);
      setInvitationNames(await SharingService.openInvitationNames(loaded.receivedInvitations, encryptedName => NativeVaultManager.decryptInvitationName(encryptedName)));

      if (sqliteClient) {
        // A shared vault is shown as a top-level folder.
        const folders = await sqliteClient.folders.getAll();
        setVaultNames(Object.fromEntries(folders.filter(folder => multiManifestRendering.isVirtualFolder(folder)).map(folder => [folder.Id.toLowerCase(), folder.Name])));
      }

      setError(null);
    } catch {
      setError(t('sharing.family.errors.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [webApi, sqliteClient, t, setIsLoading]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadOverview();
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

    const code = actionError instanceof ApiRequestError ? actionError.apiErrorCode : null;
    const knownErrorKey = sharingErrorTranslationKey(code);
    if (knownErrorKey) {
      return t(knownErrorKey);
    }

    return code !== null ? `${fallback} [${code}]` : fallback;
  };

  /**
   * Run one action, then reload so the screen shows what the server holds now.
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
   * Run one of the sync engine's sharing operations, which hold the vault keys this screen never sees.
   * @param operation - the engine operation.
   * @param params - what it acts on.
   * @param fallback - the message for a failure without a more specific reason.
   */
  const runSharingOperation = async (operation: 'createSharedManifest' | 'inviteToSharedManifest' | 'updateSharedManifest', params: Record<string, string>, fallback: string): Promise<void> => {
    const result = await NativeVaultManager.runSharingOperation(operation, JSON.stringify(params));
    if (result.success) {
      return;
    }

    if (result.vaultUpgradeRequired) {
      throw new SharingOperationError(t('sharing.family.errors.vaultUpgradeRequired'));
    }

    const knownErrorKey = sharingErrorTranslationKey(result.apiErrorCode);
    const code = result.apiErrorCode ?? result.error;
    throw new SharingOperationError(knownErrorKey ? t(knownErrorKey) : code ? `${fallback} [${code}]` : fallback);
  };

  /**
   * Create another shared folder for the family. The sync that follows pushes it to the server.
   * @param group - the family to create it for.
   */
  const createSharedVault = (group: GroupInfo): Promise<void> => {
    const name = (newVaultNames[group.groupId] ?? '').trim();
    if (name.length === 0) {
      return Promise.resolve();
    }

    return run(async () => {
      await runSharingOperation('createSharedManifest', { groupId: group.groupId, name }, t('sharing.family.errors.createVaultFailed'));
      setNewVaultNames(previous => ({ ...previous, [group.groupId]: '' }));
      await syncVault();
    }, t('sharing.family.errors.createVaultFailed'));
  };

  /**
   * Rename a shared folder, which only an administrator of the family may do. Every member fetches the name on their next sync.
   * @param name - the new name.
   */
  const renameSharedVault = async (name: string): Promise<void> => {
    const target = pendingVaultRename;
    if (!target) {
      return;
    }

    await run(async () => {
      await runSharingOperation('updateSharedManifest', { groupId: target.group.groupId, manifestId: target.manifest.manifestId, name }, t('common.errors.unknownErrorTryAgain'));
      await syncVault();
    }, t('common.errors.unknownErrorTryAgain'));
  };

  /**
   * Invite one member to one shared folder.
   * @param group - the family the shared folder belongs to.
   * @param manifest - the shared folder.
   * @param member - the member being invited.
   */
  const inviteMember = (group: GroupInfo, manifest: SharedManifestInfo, member: GroupMemberInfo): Promise<void> => run(async () => {
    await runSharingOperation('inviteToSharedManifest', { groupId: group.groupId, manifestId: manifest.manifestId, userId: member.userId }, t('sharing.family.errors.inviteFailed'));
    setNotice(t('sharing.family.invitationSent', { username: member.username }));
  }, t('sharing.family.errors.inviteFailed'));

  /**
   * Accept an invitation. The sync that follows is what brings the shared folder into this vault.
   * @param invitationId - the invitation to accept.
   */
  const acceptInvitation = (invitationId: string): Promise<void> => run(async () => {
    await SharingService.acceptInvitation(webApi, invitationId);
    await syncVault();
  }, t('sharing.family.errors.invitationGone'));

  /**
   * What to call a shared folder on screen.
   * @param manifest - the shared folder.
   */
  const vaultLabel = (manifest: SharedManifestInfo): string => vaultNames[manifest.manifestId.toLowerCase()] ?? t('sharing.family.unnamedVault');

  /**
   * Ask before taking a member's access away, or before giving up one's own.
   */
  const confirmRemoval = (group: GroupInfo, manifest: SharedManifestInfo, member: GroupMemberInfo, isSelf: boolean): void => {
    const title = isSelf ? t('sharing.family.leaveVault') : t('sharing.revoke');
    const message = isSelf
      ? t('sharing.family.leaveVaultConfirm', { vault: vaultLabel(manifest) })
      : `${t('sharing.family.revokeAccessConfirm', { username: member.username, vault: vaultLabel(manifest) })}\n\n${t('sharing.family.revokeAccessWarning')}`;

    showConfirm(title, message, title, () => run(async () => {
      await SharingService.revokeAccess(webApi, group.groupId, manifest.manifestId, member.userId);
      await syncVault();
    }, t('sharing.family.errors.revokeAccessFailed')), { confirmStyle: 'destructive' });
  };

  /**
   * Delete a shared folder behind the native password prompt. The server wants proof of the master password, which
   * the native layer answers with the unlock key of the open session.
   * @param group - the group the shared folder belongs to.
   * @param manifest - the shared folder to delete.
   */
  const deleteSharedVault = async (group: GroupInfo, manifest: SharedManifestInfo): Promise<void> => {
    const authenticated = await VaultUnlockHelper.authenticateForAction(t('sharing.family.deleteVault'), t('settings.passwordConfirm.description'), null, t('common.delete'));
    if (!authenticated) {
      return;
    }

    await run(async () => {
      try {
        await SharingService.deleteSharedManifest(webApi, group.groupId, manifest.manifestId, challenge => NativeVaultManager.deriveSrpProof(challenge.salt, challenge.srpIdentity, challenge.serverEphemeral));
      } catch (deleteError) {
        // Local unlock key could mismatch what is actually stored on server (recent password change on other device), if so we show a incorrect password error.
        if (deleteError instanceof ApiRequestError && deleteError.apiErrorCode === 'PASSWORD_MISMATCH') {
          throw new SharingOperationError(t('auth.errors.incorrectPassword'));
        }

        throw deleteError;
      }

      await syncVault();
      setNotice(t('sharing.family.vaultDeleted'));
    }, t('sharing.family.errors.deleteVaultFailed'));
  };

  /**
   * Ask before deleting a shared folder, then move on to the native master password prompt.
   */
  const confirmVaultDelete = (group: GroupInfo, manifest: SharedManifestInfo): void => {
    showConfirm(
      t('sharing.family.deleteVault'),
      t('sharing.family.deleteVaultConfirm', { vault: vaultLabel(manifest) }),
      t('common.delete'),
      () => deleteSharedVault(group, manifest),
      { confirmStyle: 'destructive' }
    );
  };

  /**
   * Refresh on pull to refresh.
   */
  const onRefresh = async (): Promise<void> => {
    HapticsUtility.impact();
    setIsRefreshing(true);
    await loadOverview();
    setIsRefreshing(false);
  };

  const styles = StyleSheet.create({
    actionText: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '600',
    },
    actionTextDestructive: {
      color: colors.destructive,
    },
    banner: {
      borderRadius: 10,
      marginTop: 16,
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
    betaBadge: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    betaBadgeText: {
      color: colors.primarySurfaceText,
      fontSize: 11,
      fontWeight: '600',
      textTransform: 'uppercase',
    },
    buttonRow: {
      flexDirection: 'row',
      gap: 16,
      marginTop: 10,
    },
    card: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      marginBottom: 12,
      padding: 16,
    },
    cardHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    cardTitle: {
      color: colors.text,
      flex: 1,
      fontSize: 16,
      fontWeight: '600',
    },
    createInput: {
      backgroundColor: colors.background,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      color: colors.text,
      flex: 1,
      fontSize: 14,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    createRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      marginTop: 10,
    },
    disabled: {
      opacity: 0.5,
    },
    headerRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
    },
    headerText: {
      color: colors.textMuted,
      flex: 1,
      fontSize: 13,
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
      marginTop: 10,
      paddingTop: 10,
    },
    memberText: {
      flex: 1,
    },
    mutedText: {
      color: colors.textMuted,
      fontSize: 13,
    },
    section: {
      marginTop: 20,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
      marginBottom: 8,
    },
  });

  // Nothing is known before the stored capabilities are read, and redirecting on a guess would throw out a deep link.
  if (!isLoaded) {
    return null;
  }

  if (!isEnabled(CapabilityKeys.VaultSharing)) {
    return <Redirect href="/(tabs)/settings" />;
  }

  const receivedInvitations = overview?.receivedInvitations ?? [];
  const groups = overview?.groups ?? [];

  /**
   * One member of a family or of a shared folder, with whatever can be done about them on the right.
   */
  const renderMemberRow = (member: GroupMemberInfo, isSelf: boolean, detail: string, action?: React.ReactNode): React.ReactNode => (
    <View key={member.userId} style={styles.memberRow}>
      <View style={styles.memberText}>
        <ThemedText style={styles.memberName} numberOfLines={1}>
          {member.username}{isSelf && ` (${t('sharing.family.you')})`}
        </ThemedText>
        <ThemedText style={styles.mutedText}>{detail}</ThemedText>
      </View>
      {action}
    </View>
  );

  /**
   * A text button on the right of a row.
   */
  const renderAction = (label: string, onPress: () => void, destructive: boolean = false, enabled: boolean = true): React.ReactNode => (
    <TouchableOpacity onPress={onPress} disabled={busy || !enabled} style={(busy || !enabled) && styles.disabled}>
      <ThemedText style={[styles.actionText, destructive && styles.actionTextDestructive]}>{label}</ThemedText>
    </TouchableOpacity>
  );

  return (
    <ThemedContainer>
      <ThemedScrollView refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />}>
        <View style={styles.headerRow}>
          <ThemedText style={styles.headerText}>{t('sharing.family.description')}</ThemedText>
          <View style={styles.betaBadge}>
            <ThemedText style={styles.betaBadgeText}>{t('sharing.family.beta')}</ThemedText>
          </View>
        </View>

        {error && (
          <View style={[styles.banner, styles.bannerError]}>
            <ThemedText style={styles.bannerErrorText}>{error}</ThemedText>
          </View>
        )}
        {notice && (
          <View style={[styles.banner, styles.bannerSuccess]}>
            <ThemedText style={styles.bannerSuccessText}>{notice}</ThemedText>
          </View>
        )}

        {isLoading ? (
          <View style={styles.section}>
            <SkeletonLoader count={2} height={100} parts={3} />
          </View>
        ) : (
          <>
            {receivedInvitations.length > 0 && (
              <View style={styles.section}>
                <ThemedText style={styles.sectionTitle}>{t('sharing.family.invitations')}</ThemedText>
                {receivedInvitations.map(invitation => (
                  <View key={invitation.id} style={styles.card}>
                    <ThemedText style={styles.cardTitle}>{invitationNames[invitation.id] ?? t('sharing.family.unnamedVault')}</ThemedText>
                    <ThemedText style={styles.mutedText}>{t('sharing.family.invitedBy', { username: invitation.inviterUsername })}</ThemedText>
                    <View style={styles.buttonRow}>
                      {renderAction(t('sharing.family.accept'), () => acceptInvitation(invitation.id))}
                      {renderAction(t('sharing.family.decline'), () => run(() => SharingService.declineInvitation(webApi, invitation.id), t('sharing.family.errors.invitationGone')), true)}
                    </View>
                  </View>
                ))}
              </View>
            )}

            {groups.length === 0 && receivedInvitations.length === 0 && !error && (
              <View style={styles.section}>
                <ThemedText style={styles.mutedText}>{t('sharing.family.notAvailable')}</ThemedText>
              </View>
            )}

            {groups.map((group) => {
              const canAdminister = canAdministerGroup(group);
              const myUserId = ownUserIdIn(group, username);
              const isRosterExpanded = expandedRosters[group.groupId] ?? false;

              return (
                <View key={group.groupId} style={styles.section}>
                  {/* The family's members. */}
                  <View style={styles.card}>
                    <TouchableOpacity style={styles.cardHeader} onPress={() => setExpandedRosters(previous => ({ ...previous, [group.groupId]: !isRosterExpanded }))} activeOpacity={0.7}>
                      <ThemedText style={styles.cardTitle}>{t('sharing.members')} ({group.members.length})</ThemedText>
                      <Ionicons name={isRosterExpanded ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textMuted} />
                    </TouchableOpacity>
                    {isRosterExpanded && group.members.map(member => renderMemberRow(member, member.userId === myUserId, t(roleTranslationKey(member))))}
                  </View>

                  {/* One card per shared folder, each with the members who can open it. */}
                  <ThemedText style={styles.sectionTitle}>{t('sharing.family.sharedFolders')}</ThemedText>
                  {group.manifests.length === 0 && (
                    <ThemedText style={styles.mutedText}>{canAdminister ? t('sharing.family.noSharedVaultAdmin') : t('sharing.family.noSharedVaultMember')}</ThemedText>
                  )}
                  {group.manifests.map(manifest => (
                    <View key={manifest.manifestId} style={styles.card}>
                      <View style={styles.cardHeader}>
                        <ThemedText style={styles.cardTitle} numberOfLines={1}>{vaultLabel(manifest)}</ThemedText>
                        {/* Renaming encrypts the name with the folder's key, so it takes a member who holds it. */}
                        {canAdminister && holdsManifestKey(manifest, myUserId) && renderAction(t('items.folders.editFolder'), () => setPendingVaultRename({ group, manifest }))}
                        {canAdminister && renderAction(t('sharing.family.deleteVault'), () => confirmVaultDelete(group, manifest), true)}
                      </View>

                      {/* Inviting somebody encrypts this folder's key for them, which an admin who holds no grant on it cannot do. */}
                      {canAdminister && !holdsManifestKey(manifest, myUserId) && (
                        <ThemedText style={styles.mutedText}>{t('sharing.family.cannotInviteWithoutAccess')}</ThemedText>
                      )}

                      {group.members.map((member) => {
                        const access = describeMemberAccess(group, manifest, member, myUserId);
                        const invitation = access.invitation;

                        return renderMemberRow(member, access.isSelf, t(access.statusKey), (
                          <>
                            {access.canLeave && renderAction(t('sharing.family.leaveVault'), () => confirmRemoval(group, manifest, member, true), true)}
                            {access.canRevoke && renderAction(t('sharing.revoke'), () => confirmRemoval(group, manifest, member, false), true)}
                            {access.canWithdraw && invitation && renderAction(t('sharing.family.withdraw'), () => run(() => SharingService.withdrawInvitation(webApi, invitation.id), t('sharing.family.errors.invitationGone')))}
                            {access.canInvite && renderAction(t('sharing.family.invite'), () => inviteMember(group, manifest, member), false, access.isReadyForInvite)}
                          </>
                        ));
                      })}
                    </View>
                  ))}

                  {/* Creating another shared folder. */}
                  {canAdminister && (
                    <View style={styles.card}>
                      <ThemedText style={styles.cardTitle}>{t('sharing.family.createSharedVault')}</ThemedText>
                      <View style={styles.createRow}>
                        <TextInput
                          style={styles.createInput}
                          value={newVaultNames[group.groupId] ?? ''}
                          onChangeText={text => setNewVaultNames(previous => ({ ...previous, [group.groupId]: text }))}
                          placeholder={t('sharing.family.vaultNamePlaceholder')}
                          placeholderTextColor={colors.textMuted}
                          editable={!busy}
                          onSubmitEditing={() => createSharedVault(group)}
                        />
                        {renderAction(t('sharing.family.create'), () => createSharedVault(group))}
                      </View>
                    </View>
                  )}
                </View>
              );
            })}
          </>
        )}
      </ThemedScrollView>

      <FolderModal
        isOpen={pendingVaultRename !== null}
        onClose={() => setPendingVaultRename(null)}
        onSave={renameSharedVault}
        initialName={pendingVaultRename ? vaultLabel(pendingVaultRename.manifest) : ''}
        mode="edit"
      />
    </ThemedContainer>
  );
}
