import { decryptEmailList } from '@aliasvault/client/email/EmailDecryption';
import { deleteEmails } from '@aliasvault/client/email/EmailDeletion';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useNavigation, type Href } from 'expo-router';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Platform, View, RefreshControl, Animated, TouchableOpacity, ActivityIndicator, type FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { toast } from 'sonner-native';

import emitter from '@/utils/EventEmitter';
import { HapticsUtility } from '@/utils/HapticsUtility';
import { isServerUnreachable } from '@/utils/ServerReachability';

import { useColors } from '@/hooks/useColorScheme';
import { useListSelection } from '@/hooks/useListSelection';
import { useMinDurationLoading } from '@/hooks/useMinDurationLoading';
import { useRailSideBleed } from '@/hooks/useRailSideFlush';
import { useScrollSelectedIntoFlatList } from '@/hooks/useScrollSelectedIntoView';
import { isPathSelected } from '@/hooks/useTwoPane';
import { useVaultSync } from '@/hooks/useVaultSync';

import { ListMenu } from '@/components/common/ListMenu';
import { SELECTION_BAR_SPACE, SelectionBar, SelectionBarButton } from '@/components/common/SelectionBar';
import { EmailCard } from '@/components/EmailCard';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedText } from '@/components/themed/ThemedText';
import { CollapsibleHeader, useCollapsibleHeaderHeight, useCollapsibleHeaderScroll } from '@/components/ui/CollapsibleHeader';
import { SkeletonLoader } from '@/components/ui/SkeletonLoader';
import { TitleContainer } from '@/components/ui/TitleContainer';
import { TwoPaneRoot } from '@/components/ui/TwoPaneLayout';
import { useDb } from '@/context/DbContext';
import { useDialog } from '@/context/DialogContext';
import { useWebApi } from '@/context/WebApiContext';

import type { InboxResponse, MailboxEmail } from '@aliasvault/models/webapi';

/**
 * What the selection keeps of an email: its id.
 */
const emailIdOf = (email: MailboxEmail): number => email.id;

/**
 * The selection key of an email id.
 */
const emailKey = (id: number): string => String(id);

/**
 * The list key of an email.
 */
const emailRowKey = (email: MailboxEmail): string => emailKey(email.id);

/**
 * The detail route of an email.
 */
const emailRoute = (email: MailboxEmail): Href => ({ pathname: '/(tabs)/emails/[id]', params: { id: String(email.id) } });

/** Most extra pages the two-pane list loads to find the email shown next to it. */
const MAX_PAGES_TO_FIND_SELECTED = 10;

/**
 * Emails screen.
 */
export function EmailsScreen() : React.ReactNode {
  const { t } = useTranslation();
  const dbContext = useDb();
  const webApi = useWebApi();
  const colors = useColors();
  const navigation = useNavigation();
  const { syncVault } = useVaultSync();
  const { scroll: headerScroll, onScroll: onHeaderScroll } = useCollapsibleHeaderScroll();
  const flatListRef = useRef<FlatList<MailboxEmail>>(null);
  const [error, setError] = useState<string | null>(null);
  const [emails, setEmails] = useState<MailboxEmail[]>([]);
  const [isLoading, setIsLoading] = useMinDurationLoading(true, 200);
  const [isRefreshing, setIsRefreshing] = useMinDurationLoading(false, 200);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalRecords, setTotalRecords] = useState<number>(0);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const insets = useSafeAreaInsets();
  const headerHeight = useCollapsibleHeaderHeight();
  const railSideBleed = useRailSideBleed();
  const { showConfirm } = useDialog();
  const [showListMenu, setShowListMenu] = useState(false);
  const selection = useListSelection(emails, emailIdOf, emailKey);
  const { exit: exitSelection, toggle: toggleSelected, enter: enterSelection } = selection;

  const PAGE_SIZE = 50;

  /**
   * Load emails.
   */
  const loadEmails = useCallback(async (reset: boolean = true) : Promise<void> => {
    try {
      setError(null);

      if (!dbContext?.sqliteClient) {
        return;
      }

      // Check if we are in offline mode
      if (dbContext.isOffline) {
        setIsLoading(false);
        return;
      }

      try {
        // The server resolves the mailbox from the caller's active alias claims.
        const data = await webApi.get<InboxResponse>(`EmailBox?page=1&pageSize=${PAGE_SIZE}`);

        // Decrypt emails locally using private key associated with the email address
        const encryptionKeys = await dbContext.sqliteClient.encryptionKeys.getAll();

        // Decrypt emails locally using public/private key pairs
        const decryptedEmails = await decryptEmailList(data.mails, data.publicKeys, encryptionKeys);

        if (reset) {
          setEmails(decryptedEmails);
          setCurrentPage(data.currentPage);
          setTotalRecords(data.totalRecords);
        }
        setIsLoading(false);
      } catch {
        // An unreachable server puts the app in offline mode, like a vault sync does.
        if (await isServerUnreachable()) {
          await dbContext.setIsOffline(true);
          return;
        }

        /*
         * Suppress errors while vault has unsynced changes or if we're offline
         * Network errors during sync can trigger false positives
         */
        if (dbContext.shouldSuppressEmailErrors() || dbContext.isOffline) {
          setIsLoading(false);
          return;
        }

        // Show toast and throw error
        toast.error(t('common.errors.unknownError'));
        throw new Error(t('common.errors.unknownError'));
      } finally {
        setIsLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    }
  }, [dbContext, webApi, setIsLoading, t, PAGE_SIZE]);

  /**
   * Load more emails (next page).
   */
  const loadMoreEmails = useCallback(async () : Promise<void> => {
    if (isLoadingMore || !dbContext.sqliteClient || dbContext.isOffline) {
      return;
    }

    try {
      setIsLoadingMore(true);
      setError(null);

      const nextPage = currentPage + 1;

      const data = await webApi.get<InboxResponse>(`EmailBox?page=${nextPage}&pageSize=${PAGE_SIZE}`);

      // Decrypt emails locally
      const encryptionKeys = await dbContext.sqliteClient.encryptionKeys.getAll();
      const decryptedEmails = await decryptEmailList(data.mails, data.publicKeys, encryptionKeys);

      // Append to existing emails
      setEmails((prevEmails) => [...prevEmails, ...decryptedEmails]);
      setCurrentPage(data.currentPage);
      setTotalRecords(data.totalRecords);
    } catch (err) {
      if (await isServerUnreachable()) {
        await dbContext.setIsOffline(true);
        return;
      }

      setError(err instanceof Error ? err.message : t('common.error'));
      console.error('Failed to load more emails:', err);

      // Show toast for error
      toast.error(t('common.errors.unknownError'));
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, dbContext, webApi, currentPage, PAGE_SIZE, t]);

  useEffect(() => {
    const sub = emitter.addListener('tabPress', (routeName: string) => {
      if (routeName === 'emails' && navigation.isFocused()) {
        // Scroll to top
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      }
    });

    /*
     * Add listener for email refresh which other components can trigger,
     * e.g. the email delete event in email details screen.
     */
    const refreshSub = emitter.addListener('refreshEmails', () => {
      loadEmails();
    });

    return () : void => {
      sub.remove();
      refreshSub.remove();
    };
  }, [loadEmails, navigation]);

  /**
   * Load emails on mount.
   */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadEmails is async; setState only fires after data is fetched
    loadEmails();
  }, [loadEmails]);

  /**
   * Ask to delete emails, then delete them and drop them from the list.
   * @param ids - the emails to delete
   * @param title - the confirm dialog title
   * @param message - the confirm dialog message
   * @param successMessage - the toast text for the number of deleted emails
   * @param onDeleted - called once the emails are deleted
   */
  const confirmAndDelete = useCallback((ids: number[], title: string, message: string, successMessage: (deleted: number) => string, onDeleted?: () => void): void => {
    showConfirm(title, message, t('common.delete'), async () => {
      try {
        const deleted = await deleteEmails(webApi, ids);
        const deletedIds = new Set(deleted);
        const remaining = emails.filter(email => !deletedIds.has(email.id));
        if (remaining.length === 0) {
          // The loaded page is empty, so fetch again: the server may still have older emails.
          await loadEmails();
        } else {
          setEmails(remaining);
          setTotalRecords(current => Math.max(0, current - deleted.length));
        }
        toast.success(successMessage(deleted.length));
        onDeleted?.();
      } catch (err) {
        console.error('Failed to delete emails:', err);
        toast.error(t('common.errors.unknownError'));
      }
    }, { confirmStyle: 'destructive' });
  }, [showConfirm, webApi, t, emails, loadEmails]);

  /**
   * Delete the selected emails; selection mode ends once they are deleted.
   */
  const deleteSelectedEmails = useCallback((): void => {
    const count = selection.selection.length;
    confirmAndDelete(selection.selection, t('emails.home.bulkDeleteEmailTitle', { count }), t('emails.home.bulkDeleteEmailConfirmation', { count }), deleted => t('emails.home.bulkDeleteEmailSuccess', { count: deleted }), exitSelection);
  }, [selection.selection, confirmAndDelete, exitSelection, t]);

  /**
   * Delete one email from its context menu.
   */
  const deleteSingleEmail = useCallback((emailId: number): void => {
    confirmAndDelete([emailId], t('emails.deleteEmail'), t('emails.deleteEmailConfirm'), () => t('emails.modal.emailDeletedSuccess'));
  }, [confirmAndDelete, t]);

  /**
   * Turn selection mode on or off from the list menu.
   */
  const toggleSelectionMode = useCallback((): void => (selection.isActive ? exitSelection() : selection.enter()), [selection, exitSelection]);

  /**
   * Toggle one row from a tap or long-press.
   */
  const toggleEmail = useCallback((entry: MailboxEmail): void => toggleSelected(entry, false), [toggleSelected]);

  /**
   * Start selection mode with one row selected, from its context menu.
   */
  const selectFromMenu = useCallback((entry: MailboxEmail): void => enterSelection(entry), [enterSelection]);

  // When the primary pane appears (the phone is unfolded), scroll the email shown next to it into view once.
  const [isTargetSearchDone, setIsTargetSearchDone] = useState(false);
  const scrollSelected = useScrollSelectedIntoFlatList(flatListRef, { rows: emails, isLoaded: !isLoading && isTargetSearchDone, rowHref: emailRoute, rowKey: emailRowKey });
  const scrollTargetPath = scrollSelected.targetPath;

  // The email may sit on a later page than the first: load pages until it is in the list (bounded, it may be gone).
  const targetPagesLoadedRef = useRef(0);
  useEffect(() => {
    if (!scrollTargetPath || isTargetSearchDone || isLoading || isLoadingMore) {
      return;
    }
    const isInList = emails.some(email => isPathSelected(scrollTargetPath, emailRoute(email)));
    if (isInList || totalRecords <= emails.length || targetPagesLoadedRef.current >= MAX_PAGES_TO_FIND_SELECTED) {
      setIsTargetSearchDone(true);
      return;
    }
    targetPagesLoadedRef.current++;
    loadMoreEmails();
  }, [scrollTargetPath, isTargetSearchDone, isLoading, isLoadingMore, emails, totalRecords, loadMoreEmails]);

  /**
   * Header menu button on Android; iOS shows it next to the title.
   */
  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }
    navigation.setOptions({
      /**
       * List menu button.
       */
      headerRight: (): React.ReactNode => (
        <TouchableOpacity style={{ padding: 8, marginRight: 8 }} onPress={() => setShowListMenu(prev => !prev)} accessibilityLabel={t('common.moreOptions')}>
          <MaterialIcons name="more-vert" size={24} color={colors.text} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, colors.text, t]);

  /**
   * Refresh the emails on pull to refresh.
   */
  const onRefresh = useCallback(async () : Promise<void> => {
    // Trigger haptic feedback when pull-to-refresh is activated
    HapticsUtility.impact();
    exitSelection();

    setIsLoading(true);
    setIsRefreshing(true);
    if (dbContext.isOffline) {
      // Leaving offline mode reloads the emails through the mount effect.
      await syncVault();
    } else {
      await loadEmails();
    }
    setIsRefreshing(false);
    setIsLoading(false);
  }, [dbContext.isOffline, loadEmails, syncVault, setIsLoading, setIsRefreshing, exitSelection]);

  const styles = StyleSheet.create({
    centerContainer: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
    },
    container: {
      paddingHorizontal: 0,
    },
    contentContainer: {
      flexGrow: 1,
      paddingHorizontal: 14,
      paddingBottom: (Platform.OS === 'ios' ? insets.bottom + 16 : 10) + (selection.isActive ? SELECTION_BAR_SPACE : 0),
      paddingTop: Platform.OS === 'ios' ? headerHeight + 12 : 16,
    },
    emptyText: {
      color: colors.textMuted,
      opacity: 0.7,
      textAlign: 'center',
    },
    errorContainer: {
      paddingVertical: 16,
    },
    errorText: {
      color: colors.errorText,
      textAlign: 'center',
    },
    loadingContainer: {
      flex: 1,
    },
    loadMoreButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 8,
      justifyContent: 'center',
      opacity: 1,
      paddingVertical: 12,
    },
    loadMoreButtonDisabled: {
      opacity: 0.5,
    },
    loadMoreButtonText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '600',
    },
    loadMoreSpinner: {
      marginRight: 8,
    },
  });

  /**
   * Check if there are more emails to load.
   */
  const hasMoreEmails = totalRecords > emails.length;

  const showsEmails = !isLoading && !dbContext.isOffline;

  /**
   * The list header: the title, and an error, which sits inside the list so pull to refresh keeps working.
   */
  const listHeader = (
    <View onLayout={scrollSelected.onListHeaderLayout}>
      <TitleContainer
        title={t('emails.title')}
        right={(
          <TouchableOpacity style={{ padding: 8 }} onPress={() => setShowListMenu(prev => !prev)} accessibilityLabel={t('common.moreOptions')}>
            <MaterialIcons name="more-horiz" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      />
      {showsEmails && error && (
        <View style={styles.errorContainer}>
          <ThemedText style={styles.errorText}>{t('common.error')}: {error}</ThemedText>
        </View>
      )}
    </View>
  );

  /**
   * What the list shows without emails: the loading skeleton, the offline message or the empty message.
   */
  const renderEmpty = (): React.ReactElement | null => {
    if (isLoading) {
      return (
        <View style={styles.loadingContainer}>
          <SkeletonLoader count={3} height={120} parts={4} />
        </View>
      );
    }
    if (dbContext.isOffline) {
      return (
        <View style={styles.centerContainer}>
          <ThemedText style={styles.emptyText}>{t('emails.offlineMessage')}</ThemedText>
        </View>
      );
    }
    if (error) {
      return null;
    }
    return (
      <View style={styles.centerContainer}>
        <ThemedText style={styles.emptyText}>{t('emails.emptyMessage')}</ThemedText>
      </View>
    );
  };

  /**
   * The load more button below the emails.
   */
  const loadMoreButton = showsEmails && hasMoreEmails ? (
    <TouchableOpacity
      style={[styles.loadMoreButton, isLoadingMore && styles.loadMoreButtonDisabled]}
      onPress={loadMoreEmails}
      disabled={isLoadingMore}
      activeOpacity={0.7}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {isLoadingMore && (
          <ActivityIndicator
            size="small"
            color="#FFFFFF"
            style={styles.loadMoreSpinner}
          />
        )}
        <ThemedText style={styles.loadMoreButtonText}>
          {isLoadingMore
            ? t('common.loading')
            : t('emails.loadMore', { count: totalRecords - emails.length })}
        </ThemedText>
      </View>
    </TouchableOpacity>
  ) : null;

  return (
    <ThemedContainer style={styles.container} testID="emails-screen">
      <CollapsibleHeader
        title={t('emails.title')}
        scroll={headerScroll}
        showNavigationHeader={true}
      />
      <Animated.FlatList
        ref={flatListRef}
        key={scrollSelected.listKey}
        data={showsEmails ? emails : []}
        keyExtractor={emailRowKey}
        renderItem={({ item: email }) => (
          <EmailCard
            email={email}
            selectionMode={selection.isActive}
            isSelected={selection.isSelected(email)}
            onToggleSelect={toggleEmail}
            onSelectFromMenu={selectFromMenu}
            onDelete={deleteSingleEmail}
          />
        )}
        {...scrollSelected.listProps}
        removeClippedSubviews={false}
        onScroll={onHeaderScroll}
        scrollEventThrottle={16}
        style={railSideBleed.style}
        contentContainerStyle={[styles.contentContainer, railSideBleed.contentContainerStyle]}
        alwaysBounceVertical={true}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={renderEmpty() ?? undefined}
        ListFooterComponent={loadMoreButton ?? undefined}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
            progressViewOffset={Platform.OS === 'ios' ? insets.top : undefined}
          />
        }
      />
      {selection.isActive && (
        <SelectionBar count={selection.selection.length} visibleCount={emails.length} onSelectAll={selection.selectAll} onClose={exitSelection}>
          <SelectionBarButton icon="delete" label={t('common.delete')} onPress={deleteSelectedEmails} disabled={selection.selection.length === 0} danger testID="selection-delete" />
        </SelectionBar>
      )}
      <ListMenu
        visible={showListMenu}
        selection={emails.length > 0 || selection.isActive ? { isActive: selection.isActive, onToggle: toggleSelectionMode } : undefined}
        onClose={() => setShowListMenu(false)}
      />
    </ThemedContainer>
  );
}

/**
 * The emails tab's root route: the email list, or the empty detail pane of a two-pane layout, where the layout renders the list.
 */
export default function EmailsRoute(): React.ReactNode {
  const { t } = useTranslation();
  return <TwoPaneRoot placeholderIcon="mail-outline" placeholderMessage={t('emails.preview.selectEmailMessage')}><EmailsScreen /></TwoPaneRoot>;
}
