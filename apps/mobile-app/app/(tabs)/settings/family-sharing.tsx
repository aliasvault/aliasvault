import { apiErrorCodeOf } from '@aliasvault/client/api/errors/ApiRequestError';
import { SrpAuthService } from '@aliasvault/client/auth/SrpAuthService';
import { canAdministerGroup, describeMemberAccess, familySharingText, holdsManifestKey, ownUserIdIn, roleLabel, sharingErrorMessage } from '@aliasvault/client/sharing/FamilySharingView';
import { multiManifestRendering } from '@aliasvault/client/sharing/MultiManifestRendering';
import { SharingService } from '@aliasvault/client/sharing/SharingService';
import { CapabilityKeys } from '@aliasvault/models/webapi';
import { Ionicons } from '@expo/vector-icons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Redirect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, RefreshControl, StyleSheet, TouchableOpacity, View } from 'react-native';
import ContextMenu from 'react-native-context-menu-view';

import { folderRoute } from '@/utils/FolderRoute';
import { HapticsUtility } from '@/utils/HapticsUtility';

import { useColors } from '@/hooks/useColorScheme';
import { useLogout } from '@/hooks/useLogout';
import { useMinDurationLoading } from '@/hooks/useMinDurationLoading';
import { useVaultSync } from '@/hooks/useVaultSync';

import { FolderIcon } from '@/components/folders/FolderIcon';
import { SharedVaultModal } from '@/components/sharing/SharedVaultModal';
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
 * Family sharing screen: create a family's shared manifests, invite the members of that family to them, and answer the
 * invitations others sent.
 */
export default function FamilySharingScreen(): React.ReactNode {
  const colors = useColors();
  const webApi = useWebApi();
  const { t } = useTranslation();
  const router = useRouter();
  const { username } = useApp();
  const { logoutForced } = useLogout();
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
  const [pendingVaultCreate, setPendingVaultCreate] = useState<GroupInfo | null>(null);
  const [pendingVaultRename, setPendingVaultRename] = useState<{ group: GroupInfo; manifest: SharedManifestInfo } | null>(null);
  const [invitationNames, setInvitationNames] = useState<Record<string, string>>({});

  /**
   * Load the families, their shared manifests and the open invitations, plus the names this vault has for them.
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
      setError(familySharingText.errors.loadFailed);
    } finally {
      setIsLoading(false);
    }
  }, [webApi, sqliteClient, setIsLoading]);

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

    const code = apiErrorCodeOf(actionError);
    const knownError = sharingErrorMessage(code);
    if (knownError) {
      return knownError;
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
      throw new SharingOperationError(familySharingText.errors.vaultUpgradeRequired);
    }

    const knownError = sharingErrorMessage(result.apiErrorCode);
    const code = result.apiErrorCode ?? result.error;
    throw new SharingOperationError(knownError ?? (code ? `${fallback} [${code}]` : fallback));
  };

  /**
   * Create another shared manifest for the family picked in the create modal. The sync that follows pushes it to the server.
   * @param name - the new vault's name.
   */
  const createSharedVault = (name: string): Promise<void> => {
    const group = pendingVaultCreate;
    if (!group) {
      return Promise.resolve();
    }

    return run(async () => {
      await runSharingOperation('createSharedManifest', { groupId: group.groupId, name }, familySharingText.errors.createVaultFailed);
      await syncVault();
    }, familySharingText.errors.createVaultFailed);
  };

  /**
   * Rename a shared manifest, which only an administrator of the family may do. Every member fetches the name on their next sync.
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
   * Invite one member to one shared manifest.
   * @param group - the family the shared manifest belongs to.
   * @param manifest - the shared manifest.
   * @param member - the member being invited.
   */
  const inviteMember = (group: GroupInfo, manifest: SharedManifestInfo, member: GroupMemberInfo): Promise<void> => run(async () => {
    await runSharingOperation('inviteToSharedManifest', { groupId: group.groupId, manifestId: manifest.manifestId, userId: member.userId }, familySharingText.errors.inviteFailed);
    setNotice(familySharingText.invitationSent(member.username));
  }, familySharingText.errors.inviteFailed);

  /**
   * Accept an invitation. The sync that follows is what brings the shared manifest into this vault.
   * @param invitationId - the invitation to accept.
   */
  const acceptInvitation = (invitationId: string): Promise<void> => run(async () => {
    await SharingService.acceptInvitation(webApi, invitationId);
    await syncVault();
  }, familySharingText.errors.invitationGone);

  /**
   * What to call a shared manifest on screen.
   * @param manifest - the shared manifest.
   */
  const vaultLabel = (manifest: SharedManifestInfo): string => vaultNames[manifest.manifestId.toLowerCase()] ?? familySharingText.sharedVault;

  /**
   * Open the shared manifest's folder in the items tab.
   */
  const openVault = (manifest: SharedManifestInfo): void => {
    const folderId = manifest.manifestId.toLowerCase();
    router.push(folderRoute({ Id: folderId, ManifestId: folderId }));
  };

  /**
   * Ask before taking a member's access away, or before giving up one's own.
   */
  const confirmRemoval = (group: GroupInfo, manifest: SharedManifestInfo, member: GroupMemberInfo, isSelf: boolean): void => {
    const title = isSelf ? familySharingText.leaveVault : familySharingText.revoke;
    const message = isSelf
      ? familySharingText.leaveVaultConfirm(vaultLabel(manifest))
      : `${familySharingText.revokeAccessConfirm(member.username, vaultLabel(manifest))}\n\n${familySharingText.revokeAccessWarning}`;

    showConfirm(title, message, title, () => run(async () => {
      await SharingService.revokeAccess(webApi, group.groupId, manifest.manifestId, member.userId);
      await syncVault();
    }, familySharingText.errors.revokeAccessFailed), { confirmStyle: 'destructive' });
  };

  /**
   * Delete a shared manifest behind the native password prompt, whose unlock key answers the server's SRP challenge.
   * @param group - the group the shared manifest belongs to.
   * @param manifest - the shared manifest to delete.
   */
  const deleteSharedVault = async (group: GroupInfo, manifest: SharedManifestInfo): Promise<void> => {
    let unlockKey: string | null;
    try {
      unlockKey = await NativeVaultManager.showPasswordUnlockForKey(familySharingText.deleteVault, familySharingText.deleteVaultPasswordPrompt(vaultLabel(manifest)), t('common.delete'));
    } catch (err) {
      // Too many wrong passwords: the native layer cleared the vault, so log out.
      if (err && typeof err === 'object' && 'code' in err && err.code === 'MAX_ATTEMPTS_REACHED') {
        await logoutForced();
      }
      return;
    }

    if (!unlockKey) {
      return;
    }

    await run(async () => {
      try {
        await SharingService.deleteSharedManifest(webApi, group.groupId, manifest.manifestId, async challenge => {
          const passwordHash = await SrpAuthService.srpPasswordHash(unlockKey, challenge.encryptionType);
          return SrpAuthService.deriveClientProof(challenge.salt, challenge.srpIdentity, passwordHash, challenge.serverEphemeral);
        });
      } catch (deleteError) {
        // Local unlock key could mismatch what is actually stored on server (recent password change on other device), if so we show a incorrect password error.
        if (apiErrorCodeOf(deleteError) === 'PASSWORD_MISMATCH') {
          throw new SharingOperationError(t('common.errors.wrongPassword'));
        }

        throw deleteError;
      }

      await syncVault();
      setNotice(familySharingText.vaultDeleted);
    }, familySharingText.errors.deleteVaultFailed);
  };

  /**
   * Ask before deleting a shared manifest, then move on to the native master password prompt.
   */
  const confirmVaultDelete = (group: GroupInfo, manifest: SharedManifestInfo): void => {
    showConfirm(
      familySharingText.deleteVault,
      familySharingText.deleteVaultConfirm(vaultLabel(manifest)),
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
    try {
      await syncVault();
      await loadOverview();
    } finally {
      setIsRefreshing(false);
    }
  };

  const styles = StyleSheet.create({
    addButton: {
      alignItems: 'center',
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderStyle: 'dashed',
      borderWidth: 2,
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'center',
      paddingVertical: 12,
    },
    addButtonText: {
      color: colors.textMuted,
      fontSize: 14,
      fontWeight: '600',
    },
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
    invitationCard: {
      borderColor: colors.primary,
      borderWidth: 1.5,
    },
    invitationTitleRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
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
    moreButton: {
      alignItems: 'center',
      height: 44,
      justifyContent: 'center',
      marginRight: -10,
      marginVertical: -10,
      width: 44,
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
    vaultTitleRow: {
      alignItems: 'center',
      flex: 1,
      flexDirection: 'row',
      gap: 8,
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
   * One member of a family or of a shared manifest, with whatever can be done about them on the right.
   */
  const renderMemberRow = (member: GroupMemberInfo, isSelf: boolean, detail: string, action?: React.ReactNode): React.ReactNode => (
    <View key={member.userId} style={styles.memberRow}>
      <View style={styles.memberText}>
        <ThemedText style={styles.memberName} numberOfLines={1}>
          {member.username}{isSelf && ` (${familySharingText.you})`}
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

  /**
   * The vault's admin actions, behind a "more" button so the title row itself stays tappable.
   */
  const renderVaultMenu = (group: GroupInfo, manifest: SharedManifestInfo, canRename: boolean): React.ReactNode => {
    const renameAction = { title: t('items.folders.editFolder'), systemIcon: Platform.select({ ios: 'pencil', default: 'baseline_edit' }) };
    const deleteAction = { title: familySharingText.deleteVault, systemIcon: Platform.select({ ios: 'trash', default: 'baseline_delete' }), destructive: true };
    const actions = canRename ? [renameAction, deleteAction] : [deleteAction];

    return (
      <ContextMenu
        dropdownMenuMode
        disabled={busy}
        actions={actions}
        onPress={(event) => (actions[event.nativeEvent.index] === renameAction ? setPendingVaultRename({ group, manifest }) : confirmVaultDelete(group, manifest))}
      >
        <View style={[styles.moreButton, busy && styles.disabled]} accessible accessibilityRole="button" accessibilityLabel={t('common.settings')}>
          <Ionicons name={Platform.OS === 'ios' ? 'ellipsis-horizontal-circle' : 'ellipsis-vertical'} size={22} color={colors.textMuted} />
        </View>
      </ContextMenu>
    );
  };

  return (
    <ThemedContainer>
      <ThemedScrollView refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />}>
        <View style={styles.headerRow}>
          <ThemedText style={styles.headerText}>{familySharingText.description}</ThemedText>
          <View style={styles.betaBadge}>
            <ThemedText style={styles.betaBadgeText}>{familySharingText.beta}</ThemedText>
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
                <ThemedText style={styles.sectionTitle}>{familySharingText.invitations}</ThemedText>
                {receivedInvitations.map(invitation => (
                  <View key={invitation.id} style={[styles.card, styles.invitationCard]}>
                    <View style={styles.invitationTitleRow}>
                      <FolderIcon isShared size={20} color={colors.tint} />
                      <ThemedText style={styles.cardTitle} numberOfLines={1}>{invitationNames[invitation.id] ?? familySharingText.sharedVault}</ThemedText>
                    </View>
                    <ThemedText style={styles.mutedText}>{familySharingText.invitedBy(invitation.inviterUsername)}</ThemedText>
                    <View style={styles.buttonRow}>
                      {renderAction(familySharingText.accept, () => acceptInvitation(invitation.id))}
                      {renderAction(familySharingText.decline, () => run(() => SharingService.declineInvitation(webApi, invitation.id), familySharingText.errors.invitationGone), true)}
                    </View>
                  </View>
                ))}
              </View>
            )}

            {groups.length === 0 && receivedInvitations.length === 0 && !error && (
              <View style={styles.section}>
                <ThemedText style={styles.mutedText}>{familySharingText.notAvailable}</ThemedText>
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
                      <ThemedText style={styles.cardTitle}>{familySharingText.members} ({group.members.length})</ThemedText>
                      <Ionicons name={isRosterExpanded ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textMuted} />
                    </TouchableOpacity>
                    {isRosterExpanded && group.members.map(member => renderMemberRow(member, member.userId === myUserId, roleLabel(member)))}
                  </View>

                  {/* One card per shared manifest, each with the members who can open it. */}
                  <ThemedText style={styles.sectionTitle}>{familySharingText.sharedVaults}</ThemedText>
                  {group.manifests.length === 0 && (
                    <ThemedText style={styles.mutedText}>{canAdminister ? familySharingText.noSharedVaultAdmin : familySharingText.noSharedVaultMember}</ThemedText>
                  )}
                  {group.manifests.map(manifest => (
                    <View key={manifest.manifestId} style={styles.card}>
                      <View style={styles.cardHeader}>
                        {/* The shared manifest's folder exists in this vault once the manifest itself does. */}
                        {vaultNames[manifest.manifestId.toLowerCase()] !== undefined ? (
                          <TouchableOpacity style={styles.vaultTitleRow} onPress={() => openVault(manifest)} activeOpacity={0.6} hitSlop={{ top: 10, bottom: 10 }} accessibilityRole="link">
                            <FolderIcon isShared size={20} color={colors.tint} />
                            <ThemedText style={styles.cardTitle} numberOfLines={1}>{vaultLabel(manifest)}</ThemedText>
                            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                          </TouchableOpacity>
                        ) : (
                          <View style={styles.vaultTitleRow}>
                            <FolderIcon isShared size={20} color={colors.tint} />
                            <ThemedText style={styles.cardTitle} numberOfLines={1}>{vaultLabel(manifest)}</ThemedText>
                          </View>
                        )}
                        {/* Renaming encrypts the name with the folder's key, so it takes a member who holds it. */}
                        {canAdminister && renderVaultMenu(group, manifest, holdsManifestKey(manifest, myUserId))}
                      </View>

                      {/* Inviting somebody encrypts this folder's key for them, which an admin who holds no grant on it cannot do. */}
                      {canAdminister && !holdsManifestKey(manifest, myUserId) && (
                        <ThemedText style={styles.mutedText}>{familySharingText.cannotInviteWithoutAccess}</ThemedText>
                      )}

                      {group.members.map((member) => {
                        const access = describeMemberAccess(group, manifest, member, myUserId);
                        const invitation = access.invitation;

                        return renderMemberRow(member, access.isSelf, access.statusText, (
                          <>
                            {access.canLeave && renderAction(familySharingText.leaveVault, () => confirmRemoval(group, manifest, member, true), true)}
                            {access.canRevoke && renderAction(familySharingText.revoke, () => confirmRemoval(group, manifest, member, false), true)}
                            {access.canWithdraw && invitation && renderAction(familySharingText.withdraw, () => run(() => SharingService.withdrawInvitation(webApi, invitation.id), familySharingText.errors.invitationGone))}
                            {access.canInvite && renderAction(familySharingText.invite, () => inviteMember(group, manifest, member), false, access.isReadyForInvite)}
                          </>
                        ));
                      })}
                    </View>
                  ))}

                  {/* Creating another shared manifest. */}
                  {canAdminister && (
                    <TouchableOpacity style={[styles.addButton, busy && styles.disabled]} onPress={() => setPendingVaultCreate(group)} disabled={busy} activeOpacity={0.7}>
                      <MaterialIcons name="add" size={24} color={colors.textMuted} />
                      <ThemedText style={styles.addButtonText}>{familySharingText.createSharedVault}</ThemedText>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </>
        )}
      </ThemedScrollView>

      <SharedVaultModal
        isOpen={pendingVaultCreate !== null}
        onClose={() => setPendingVaultCreate(null)}
        onSave={createSharedVault}
        mode="create"
      />
      <SharedVaultModal
        isOpen={pendingVaultRename !== null}
        onClose={() => setPendingVaultRename(null)}
        onSave={renameSharedVault}
        initialName={pendingVaultRename ? vaultLabel(pendingVaultRename.manifest) : ''}
        mode="rename"
      />
    </ThemedContainer>
  );
}
