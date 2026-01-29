import * as Haptics from 'expo-haptics';
import { useNavigation } from 'expo-router';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, ScrollView, RefreshControl, Animated , Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import type { MailboxBulkRequest, MailboxBulkResponse, MailboxEmail } from '@/utils/dist/core/models/webapi';
import EncryptionUtility from '@/utils/EncryptionUtility';
import emitter from '@/utils/EventEmitter';

import { useColors } from '@/hooks/useColorScheme';
import { useMinDurationLoading } from '@/hooks/useMinDurationLoading';

import { EmailCard } from '@/components/EmailCard';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedText } from '@/components/themed/ThemedText';
import { CollapsibleHeader } from '@/components/ui/CollapsibleHeader';
import { SkeletonLoader } from '@/components/ui/SkeletonLoader';
import { TitleContainer } from '@/components/ui/TitleContainer';
import { useDb } from '@/context/DbContext';
import { useWebApi } from '@/context/WebApiContext';

/**
 * Emails screen.
 */
export default function EmailsScreen() : React.ReactNode {
  const { t } = useTranslation();
  const dbContext = useDb();
  const webApi = useWebApi();
  const colors = useColors();
  const navigation = useNavigation();
  const scrollY = useRef(new Animated.Value(0)).current;
  const scrollViewRef = useRef<ScrollView>(null);
  const [error, setError] = useState<string | null>(null);
  const [emails, setEmails] = useState<MailboxEmail[]>([]);
  const [isLoading, setIsLoading] = useMinDurationLoading(true, 200);
  const [isRefreshing, setIsRefreshing] = useMinDurationLoading(false, 200);
  const [isTabFocused, setIsTabFocused] = useState(false);
  const insets = useSafeAreaInsets();

  /**
   * Load emails.
   */
  const loadEmails = useCallback(async () : Promise<void> => {
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

      // Get unique email addresses from all items
      const emailAddresses = await dbContext.sqliteClient.items.getAllEmailAddresses();

      try {
        // For now we only show the latest 50 emails. No pagination.
        const data = await webApi.post<MailboxBulkRequest, MailboxBulkResponse>('EmailBox/bulk', {
          addresses: emailAddresses,
          page: 1,
          pageSize: 50,
        });

        // Decrypt emails locally using private key associated with the email address
        const encryptionKeys = await dbContext.sqliteClient.getAllEncryptionKeys();

        // Decrypt emails locally using public/private key pairs
        const decryptedEmails = await EncryptionUtility.decryptEmailList(data.mails, encryptionKeys);

        setEmails(decryptedEmails);
        setIsLoading(false);
      } catch {
        /*
         * Suppress errors while vault has unsynced changes or if we're offline
         * Network errors during sync can trigger false positives
         */
        if (dbContext.shouldSuppressEmailErrors() || dbContext.isOffline) {
          setIsLoading(false);
          return;
        }

        // Show toast and throw error
        Toast.show({
          type: 'error',
          text1: t('common.errors.unknownError'),
          position: 'bottom',
        });
        throw new Error(t('common.errors.unknownError'));
      } finally {
        setIsLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    }
  }, [dbContext, webApi, setIsLoading, t]);

  useEffect(() => {
    const unsubscribeFocus = navigation.addListener('focus', () => {
      setIsTabFocused(true);
    });

    const unsubscribeBlur = navigation.addListener('blur', () => {
      setIsTabFocused(false);
    });

    const sub = emitter.addListener('tabPress', (routeName: string) => {
      if (routeName === 'emails' && isTabFocused) {
        // Scroll to top
        scrollViewRef.current?.scrollTo({ y: 0, animated: true });
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
      unsubscribeFocus();
      unsubscribeBlur();
      refreshSub.remove();
    };
  }, [isTabFocused, loadEmails, navigation]);

  /**
   * Load emails on mount.
   */
  useEffect(() => {
    loadEmails();
  }, [loadEmails]);

  /**
   * Refresh the emails on pull to refresh.
   */
  const onRefresh = useCallback(async () : Promise<void> => {
    // Trigger haptic feedback when pull-to-refresh is activated
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else if (Platform.OS === 'android') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    setIsLoading(true);
    setIsRefreshing(true);
    await loadEmails();
    setIsRefreshing(false);
    setIsLoading(false);
  }, [loadEmails, setIsLoading, setIsRefreshing]);

  const styles = StyleSheet.create({
    centerContainer: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
    },
    contentContainer: {
      paddingBottom: Platform.OS === 'ios' ? insets.bottom + 60 : 10,
      paddingTop: Platform.OS === 'ios' ? 42 : 16,
    },
    emptyText: {
      color: colors.textMuted,
      opacity: 0.7,
      textAlign: 'center',
    },
    errorText: {
      color: colors.errorText,
      textAlign: 'center',
    },
    loadingContainer: {
      flex: 1,
    },
  });

  /**
   * Render the content.
   */
  const renderContent = () : React.ReactNode => {
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
      return (
        <View style={styles.centerContainer}>
          <ThemedText style={styles.errorText}>{t('common.error')}: {error}</ThemedText>
        </View>
      );
    }

    if (emails.length === 0) {
      return (
        <View style={styles.centerContainer}>
          <ThemedText style={styles.emptyText}>
            {t('emails.emptyMessage')}
          </ThemedText>
        </View>
      );
    }

    return emails.map((email) => (
      <EmailCard key={email.id} email={email} />
    ));
  };

  return (
    <ThemedContainer testID="emails-screen">
      <CollapsibleHeader
        title={t('emails.title')}
        scrollY={scrollY}
        showNavigationHeader={true}
      />
      <Animated.ScrollView
        ref={scrollViewRef}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
        scrollEventThrottle={16}
        contentContainerStyle={styles.contentContainer}
        scrollIndicatorInsets={{ bottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      >
        <TitleContainer title={t('emails.title')} />
        {renderContent()}
      </Animated.ScrollView>
    </ThemedContainer>
  );
}
