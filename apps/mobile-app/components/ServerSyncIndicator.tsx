import { Ionicons } from '@expo/vector-icons';
import React, { useState, useEffect, useRef } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { useVaultSync } from '@/hooks/useVaultSync';

import { ThemedText } from '@/components/themed/ThemedText';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { useApp } from '@/context/AppContext';
import { useDb } from '@/context/DbContext';

/**
 * Minimum time (ms) to show the syncing indicator.
 * Prevents flickering when sync completes quickly.
 */
const MIN_SYNC_DISPLAY_TIME = 1500;

/**
 * Floating sync status indicator component.
 * Displays sync state badges for offline mode, syncing, uploading, and pending sync.
 *
 * Priority order (highest to lowest):
 * 1. Offline (amber) - network unavailable
 * 2. Syncing (green spinner) - downloading new vault from server (minimum 1.5s display)
 * 3. Uploading (blue spinner) - uploading local changes to server
 * 4. Pending (blue icon) - local changes waiting to be uploaded, tappable to retry
 * 5. Hidden - when synced
 */
export function ServerSyncIndicator(): React.ReactNode {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const app = useApp();
  const dbContext = useDb();
  const { syncVault } = useVaultSync();
  const [isRetrying, setIsRetrying] = useState(false);

  // Track syncing state with minimum display time
  const [showSyncing, setShowSyncing] = useState(false);
  const syncStartTimeRef = useRef<number | null>(null);

  /**
   * Handle syncing state changes with minimum display time.
   * When syncing starts, show indicator immediately.
   * When syncing ends, wait until minimum time has passed.
   */
  useEffect(() => {
    if (dbContext.isSyncing) {
      // Sync started - show immediately and record start time
      setShowSyncing(true);
      syncStartTimeRef.current = Date.now();
    } else if (syncStartTimeRef.current !== null) {
      // Sync ended - wait for minimum display time
      const elapsed = Date.now() - syncStartTimeRef.current;
      const remaining = MIN_SYNC_DISPLAY_TIME - elapsed;

      if (remaining > 0) {
        const timer = setTimeout(() => {
          setShowSyncing(false);
          syncStartTimeRef.current = null;
        }, remaining);
        return () => clearTimeout(timer);
      } else {
        setShowSyncing(false);
        syncStartTimeRef.current = null;
      }
    }
  }, [dbContext.isSyncing]);

  // Only show when logged in AND vault is unlocked (dbAvailable)
  if (!app.isLoggedIn || !dbContext.dbAvailable) {
    return null;
  }

  /**
   * Handle tap to force sync retry.
   */
  const handleRetry = async (): Promise<void> => {
    if (isRetrying) {
      return;
    }

    setIsRetrying(true);
    dbContext.setIsSyncing(true);

    try {
      await syncVault({
        onSuccess: async () => {
          await dbContext.refreshSyncState();
          if (dbContext.isOffline) {
            // We were offline but now succeeded
            Toast.show({
              type: 'success',
              text1: t('sync.backOnline'),
              position: 'bottom',
            });
          }
          setIsRetrying(false);
        },
        onOffline: () => {
          Toast.show({
            type: 'error',
            text1: t('sync.stillOffline'),
            position: 'bottom',
          });
          setIsRetrying(false);
        },
        onError: (error: string) => {
          Toast.show({
            type: 'error',
            text1: t('sync.syncFailed'),
            text2: error,
            position: 'bottom',
          });
          setIsRetrying(false);
        },
      });
    } catch {
      setIsRetrying(false);
    } finally {
      dbContext.setIsSyncing(false);
      await dbContext.refreshSyncState();
    }
  };

  const styles = StyleSheet.create({
    container: {
      alignItems: 'center',
      borderRadius: 24,
      bottom: insets.bottom + 60,
      elevation: 4,
      flexDirection: 'row',
      gap: 6,
      left: 16,
      paddingHorizontal: 14,
      paddingVertical: 10,
      position: 'absolute',
      shadowColor: colors.black,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 3.84,
      zIndex: 999,
    },
    offline: {
      backgroundColor: colors.warningBackground,
    },
    syncing: {
      backgroundColor: colors.successBackground,
    },
    pending: {
      backgroundColor: colors.infoBackground,
    },
    text: {
      fontSize: 13,
      fontWeight: '600',
    },
    offlineText: {
      color: colors.warning,
    },
    syncingText: {
      color: colors.success,
    },
    pendingText: {
      color: colors.info,
    },
    badge: {
      backgroundColor: colors.destructive,
      borderRadius: 4,
      height: 8,
      width: 8,
      position: 'absolute',
      right: -2,
      top: -2,
    },
  });

  // Priority 1: Offline indicator (tappable to retry)
  // Shows offline status with badge dot if there are pending changes
  if (dbContext.isOffline) {
    return (
      <RobustPressable
        style={[styles.container, styles.offline]}
        onPress={handleRetry}
        disabled={isRetrying}
        testID="sync-indicator-offline"
      >
        <View>
          {isRetrying ? (
            <ActivityIndicator size="small" color={colors.warning} />
          ) : (
            <>
              <Ionicons name="cloud-offline" size={18} color={colors.warning} />
              {dbContext.isDirty && (
                <View style={styles.badge} />
              )}
            </>
          )}
        </View>
        <ThemedText style={[styles.text, styles.offlineText]}>
          {t('sync.offline')}
        </ThemedText>
      </RobustPressable>
    );
  }

  // Priority 2: Syncing indicator (not tappable, shows progress)
  // Uses showSyncing which has minimum display time to prevent flickering
  if (showSyncing) {
    return (
      <View style={[styles.container, styles.syncing]} testID="sync-indicator-syncing">
        <ActivityIndicator size="small" color={colors.success ?? '#16a34a'} />
        <ThemedText style={[styles.text, styles.syncingText]}>
          {t('sync.syncing')}
        </ThemedText>
      </View>
    );
  }

  // Priority 3: Uploading indicator (not tappable, shows progress)
  if (dbContext.isUploading) {
    return (
      <View style={[styles.container, styles.pending]} testID="sync-indicator-uploading">
        <ActivityIndicator size="small" color={colors.info} />
        <ThemedText style={[styles.text, styles.pendingText]}>
          {t('sync.syncing')}
        </ThemedText>
      </View>
    );
  }

  // Priority 4: Pending indicator (tappable to force sync)
  if (dbContext.isDirty) {
    return (
      <RobustPressable
        style={[styles.container, styles.pending]}
        onPress={handleRetry}
        disabled={isRetrying}
        testID="sync-indicator-pending"
      >
        {isRetrying ? (
          <ActivityIndicator size="small" color={colors.info} />
        ) : (
          <Ionicons name="cloud-upload" size={18} color={colors.info} />
        )}
        <ThemedText style={[styles.text, styles.pendingText]}>
          {t('sync.pending')}
        </ThemedText>
      </RobustPressable>
    );
  }

  // Synced - no indicator needed
  return null;
}
