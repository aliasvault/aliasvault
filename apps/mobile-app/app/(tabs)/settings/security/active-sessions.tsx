import * as Haptics from 'expo-haptics';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, TouchableOpacity, Alert, RefreshControl, Platform } from 'react-native';
import Toast from 'react-native-toast-message';

import type { RefreshToken } from '@/utils/dist/core/models/webapi';

import { useColors } from '@/hooks/useColorScheme';
import { useMinDurationLoading } from '@/hooks/useMinDurationLoading';

import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { SkeletonLoader } from '@/components/ui/SkeletonLoader';
import { useWebApi } from '@/context/WebApiContext';
/**
 * Active sessions screen.
 */
export default function ActiveSessionsScreen() : React.ReactNode {
  const colors = useColors();
  const webApi = useWebApi();
  const { t } = useTranslation();

  const [refreshTokens, setRefreshTokens] = useState<RefreshToken[]>([]);
  const [isLoading, setIsLoading] = useMinDurationLoading(true, 200);
  const [isRefreshing, setIsRefreshing] = useMinDurationLoading(false, 200);

  const styles = StyleSheet.create({
    detailText: {
      color: colors.textMuted,
      fontSize: 14,
      marginBottom: 4,
    },
    deviceName: {
      color: colors.text,
      flex: 1,
      flexWrap: 'wrap',
      fontSize: 16,
      fontWeight: '600',
    },
    emptyState: {
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    },
    emptyStateText: {
      color: colors.textMuted,
      fontSize: 16,
      textAlign: 'center',
    },
    headerText: {
      color: colors.textMuted,
      fontSize: 13,
    },
    revokeButton: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '600',
      marginLeft: 8,
    },
    section: {
      marginTop: 20,
      overflow: 'hidden',
    },
    sessionDetails: {
      marginBottom: 8,
    },
    sessionHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    sessionItem: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      marginBottom: 16,
      padding: 16,
      paddingBottom: 2,
    },
  });

  /**
   * Load the active sessions from the server.
   */
  const loadSessions = useCallback(async () : Promise<void> => {
    try {
      setIsLoading(true);
      const response = await webApi.getActiveSessions();
      setRefreshTokens(response);
    } catch {
      Alert.alert(t('common.error'), t('settings.securitySettings.activeSessions.failedToLoad'));
    } finally {
      setIsLoading(false);
    }
  }, [webApi, setIsLoading, setRefreshTokens, t]);

  /**
   * Handle the revoke session action.
   */
  const handleRevokeSession = async (sessionId: string) : Promise<void> => {
    Alert.alert(
      t('settings.securitySettings.activeSessions.revokeSession'),
      t('settings.securitySettings.activeSessions.revokeConfirmation'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.securitySettings.activeSessions.revoke'),
          style: 'destructive',
          /**
           * Revoke the session and refresh the sessions.
           */
          onPress: async () : Promise<void> => {
            try {
              await webApi.revokeSession(sessionId);
              await loadSessions();

              // Show success toast
              Toast.show({
                text1: t('settings.securitySettings.activeSessions.sessionRevoked'),
                type: 'success',
                position: 'bottom',
              });
            } catch {
              // Show error toast
              Toast.show({
                text1: t('settings.securitySettings.activeSessions.failedToRevoke'),
                type: 'error',
                position: 'bottom',
              });
            }
          },
        },
      ]
    );
  };

  /**
   * Refresh the sessions on pull to refresh.
   */
  const onRefresh = async () : Promise<void> => {
    // Trigger haptic feedback when pull-to-refresh is activated
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    setIsRefreshing(true);
    await loadSessions();
    setIsRefreshing(false);
  };

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  /**
   * Format date to yyyy-mm-dd hh:mm format.
   * @param date - The date to format
   * @returns The formatted date string
   */
  const formatDate = (date: string) : string => {
    const dateObject = new Date(date);
    return dateObject.toISOString().slice(0, 16).replace('T', ' ');
  };

  return (
    <ThemedContainer>
      <ThemedScrollView
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      >
        <ThemedText style={styles.headerText}>
          {t('settings.securitySettings.activeSessions.headerText')}
        </ThemedText>
        <View style={styles.section}>
          {isLoading ? (
            <SkeletonLoader count={1} height={100} parts={3} />
          ) : refreshTokens.length === 0 ? (
            <View style={styles.emptyState}>
              <ThemedText style={styles.emptyStateText}>{t('settings.securitySettings.activeSessions.noSessions')}</ThemedText>
            </View>
          ) : (
            refreshTokens.map((item) => (
              <View key={item.id} style={styles.sessionItem}>
                <View style={styles.sessionHeader}>
                  <ThemedText style={styles.deviceName} numberOfLines={2}>{item.deviceIdentifier}</ThemedText>
                  <TouchableOpacity onPress={() => handleRevokeSession(item.id)}>
                    <ThemedText style={styles.revokeButton}>{t('settings.securitySettings.activeSessions.revoke')}</ThemedText>
                  </TouchableOpacity>
                </View>
                <View style={styles.sessionDetails}>
                  <ThemedText style={styles.detailText}>{t('settings.securitySettings.activeSessions.lastActive')}: {formatDate(item.createdAt)}</ThemedText>
                  <ThemedText style={styles.detailText}>{t('settings.securitySettings.activeSessions.expires')}: {formatDate(item.expireDate)}</ThemedText>
                </View>
              </View>
            ))
          )}
        </View>
      </ThemedScrollView>
    </ThemedContainer>
  );
}