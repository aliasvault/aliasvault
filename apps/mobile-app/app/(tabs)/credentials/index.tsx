import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, FlatList, TouchableOpacity, TextInput, RefreshControl, Platform, Animated, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import type { Credential } from '@/utils/dist/shared/models/vault';
import emitter from '@/utils/EventEmitter';

import { useColors } from '@/hooks/useColorScheme';
import { useMinDurationLoading } from '@/hooks/useMinDurationLoading';
import { useVaultMutate } from '@/hooks/useVaultMutate';
import { useVaultSync } from '@/hooks/useVaultSync';

import { CredentialCard } from '@/components/credentials/CredentialCard';
import { ServiceUrlNotice } from '@/components/credentials/ServiceUrlNotice';
import LoadingOverlay from '@/components/LoadingOverlay';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { AndroidHeader } from '@/components/ui/AndroidHeader';
import { CollapsibleHeader } from '@/components/ui/CollapsibleHeader';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { SkeletonLoader } from '@/components/ui/SkeletonLoader';
import { TitleContainer } from '@/components/ui/TitleContainer';
import { useAuth } from '@/context/AuthContext';
import { useDb } from '@/context/DbContext';
import { useWebApi } from '@/context/WebApiContext';

/**
 * Credentials screen.
 */
export default function CredentialsScreen() : React.ReactNode {
  const [searchQuery, setSearchQuery] = useState('');
  const { syncVault } = useVaultSync();
  const webApi = useWebApi();
  const colors = useColors();
  const { t } = useTranslation();
  const flatListRef = useRef<FlatList>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const navigation = useNavigation();
  const [isTabFocused, setIsTabFocused] = useState(false);
  const router = useRouter();
  const { serviceUrl: serviceUrlParam } = useLocalSearchParams<{ serviceUrl?: string }>();
  const [credentialsList, setCredentialsList] = useState<Credential[]>([]);
  const [isLoadingCredentials, setIsLoadingCredentials] = useMinDurationLoading(false, 200);
  const [refreshing, setRefreshing] = useMinDurationLoading(false, 200);
  const [serviceUrl, setServiceUrl] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const { executeVaultMutation, isLoading, syncStatus } = useVaultMutate();
  const [isSyncing, setIsSyncing] = useState(false);

  const authContext = useAuth();
  const dbContext = useDb();

  const isAuthenticated = authContext.isLoggedIn;
  const isDatabaseAvailable = dbContext.dbAvailable;

  /**
   * Load credentials.
   */
  const loadCredentials = useCallback(async () : Promise<void> => {
    try {
      const credentials = await dbContext.sqliteClient!.getAllCredentials();
      setCredentialsList(credentials);
      setIsLoadingCredentials(false);
    } catch (err) {
      // Error loading credentials, show error toast
      Toast.show({
        type: 'error',
        text1: t('credentials.errorLoadingCredentials'),
        text2: err instanceof Error ? err.message : 'Unknown error',
      });
      setIsLoadingCredentials(false);
    }
  }, [dbContext.sqliteClient, setIsLoadingCredentials, t]);

  useEffect(() => {
    const unsubscribeFocus = navigation.addListener('focus', () => {
      setIsTabFocused(true);
    });

    const unsubscribeBlur = navigation.addListener('blur', () => {
      setIsTabFocused(false);
    });

    const tabPressSub = emitter.addListener('tabPress', (routeName: string) => {
      if (routeName === 'credentials' && isTabFocused) {
        setSearchQuery(''); // Reset search
        setRefreshing(false); // Reset refreshing
        // Scroll to top
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      }
    });

    // Add listener for credential changes
    const credentialChangedSub = emitter.addListener('credentialChanged', async () => {
      await loadCredentials();
    });

    return () : void => {
      tabPressSub.remove();
      credentialChangedSub.remove();
      unsubscribeFocus();
      unsubscribeBlur();
    };
  }, [isTabFocused, loadCredentials, navigation, setRefreshing]);

  const onRefresh = useCallback(async () => {
    // Trigger haptic feedback when pull-to-refresh is activated
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else if (Platform.OS === 'android') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    setRefreshing(true);
    setIsLoadingCredentials(true);

    // Check if we are in offline mode, if so, we don't need to refresh the credentials
    const isOffline = authContext.isOffline;
    if (isOffline) {
      setRefreshing(false);
      setIsLoadingCredentials(false);
      return;
    }

    try {
      // Sync vault and load credentials
      await syncVault({
        /**
         * On success.
         */
        onSuccess: async (hasNewVault) => {
          // Calculate remaining time needed to reach minimum duration
          await loadCredentials();
          setIsLoadingCredentials(false);
          setRefreshing(false);
          setTimeout(() => {
            Toast.show({
              type: 'success',
              text1: hasNewVault ? t('credentials.vaultSyncedSuccessfully') : t('credentials.vaultUpToDate'),
              position: 'top',
              visibilityTime: 1200,
            });
          }, 200);
        },
        /**
         * On offline.
         */
        onOffline: () => {
          setRefreshing(false);
          setIsLoadingCredentials(false);
          authContext.setOfflineMode(true);
          setTimeout(() => {
            Toast.show({
              type: 'error',
              text1: t('credentials.offlineMessage'),
              position: 'bottom',
            });
          }, 200);
        },
        /**
         * On error.
         */
        onError: async (error) => {
          console.error('Error syncing vault:', error);
          setRefreshing(false);
          setIsLoadingCredentials(false);

          // Show modal with error message
          Alert.alert(t('common.error'), error);

          // Logout user
          await webApi.logout(error);
        },
        /**
         * On upgrade required.
         */
        onUpgradeRequired: () : void => {
          router.replace('/upgrade');
        },
      });
    } catch (err) {
      console.error('Error refreshing credentials:', err);
      setRefreshing(false);
      setIsLoadingCredentials(false);
      Toast.show({
        type: 'error',
        text1: t('credentials.vaultSyncFailed'),
        text2: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }, [syncVault, loadCredentials, setIsLoadingCredentials, setRefreshing, webApi, authContext, router, t]);

  useEffect(() => {
    if (!isAuthenticated || !isDatabaseAvailable) {
      return;
    }

    setIsLoadingCredentials(true);
    loadCredentials();
  }, [isAuthenticated, isDatabaseAvailable, loadCredentials, setIsLoadingCredentials]);

  const filteredCredentials = credentialsList.filter(credential => {
    const searchLower = searchQuery.toLowerCase();

    /**
     * We filter credentials by searching in the following fields:
     * - Service name
     * - Username
     * - Alias email
     * - Service URL
     * - Notes
     */
    const searchableFields = [
      credential.ServiceName?.toLowerCase(),
      credential.Username?.toLowerCase(),
      credential.Alias?.Email?.toLowerCase(),
      credential.ServiceUrl?.toLowerCase(),
      credential.Notes?.toLowerCase(),
    ];
    return searchableFields.some(field => field?.includes(searchLower));
  });

  const styles = StyleSheet.create({
    clearButton: {
      padding: 4,
      position: 'absolute',
      right: 8,
      top: 4,
    },
    clearButtonText: {
      color: colors.textMuted,
      fontSize: 20,
    },
    container: {
      paddingHorizontal: 0,
    },
    contentContainer: {
      paddingBottom: Platform.OS === 'ios' ? insets.bottom + 60 : 10,
      paddingHorizontal: 14,
      paddingTop: Platform.OS === 'ios' ? 42 : 16,
    },
    emptyText: {
      color: colors.textMuted,
      fontSize: 16,
      marginTop: 24,
      opacity: 0.7,
      textAlign: 'center',
    },
    fab: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 28,
      bottom: Platform.OS === 'ios' ? insets.bottom + 60 : 16,
      elevation: 4,
      height: 56,
      justifyContent: 'center',
      position: 'absolute',
      right: 16,
      shadowColor: colors.black,
      shadowOffset: {
        width: 0,
        height: 2,
      },
      shadowOpacity: 0.25,
      shadowRadius: 3.84,
      width: 56,
      zIndex: 1000,
    },
    fabIcon: {
      color: colors.primarySurfaceText,
      fontSize: 24,
    },
    searchContainer: {
      position: 'relative',
    },
    searchIcon: {
      left: 12,
      position: 'absolute',
      top: 11,
      zIndex: 1,
    },
    searchInput: {
      backgroundColor: colors.accentBackground,
      borderRadius: 8,
      color: colors.text,
      fontSize: 16,
      height: 40,
      lineHeight: 20,
      marginBottom: 16,
      paddingLeft: 40,
      paddingRight: Platform.OS === 'android' ? 40 : 12,
    },
    stepContainer: {
      flex: 1,
      gap: 8,
    },
  });

  // Set header buttons
  useEffect(() => {
    navigation.setOptions({
      /**
       * Define custom header which is shown on Android. iOS displays the custom CollapsibleHeader component instead.
       * @returns
       */
      headerTitle: (): React.ReactNode => Platform.OS === 'android' ? <AndroidHeader title={t('credentials.title')} /> : <Text>{t('credentials.title')}</Text>,
    });
  }, [navigation, t]);

  /**
   * Delete a credential.
   */
  const onCredentialDelete = useCallback(async (credentialId: string) : Promise<void> => {
    setIsSyncing(true);

    await executeVaultMutation(async () => {
      await dbContext.sqliteClient!.deleteCredentialById(credentialId);
      setIsSyncing(false);
    });

    // Refresh list after deletion with a small delay to ensure feedback is visible.
    await new Promise(resolve => setTimeout(resolve, 250));
    await loadCredentials();
  }, [dbContext.sqliteClient, executeVaultMutation, loadCredentials]);

  // Handle deep link parameters
  useFocusEffect(
    useCallback(() => {
      // Always check the current serviceUrlParam when screen comes into focus
      const currentServiceUrl = serviceUrlParam ? decodeURIComponent(serviceUrlParam) : null;
      setServiceUrl(currentServiceUrl);
    }, [serviceUrlParam])
  );

  return (
    <ThemedContainer style={styles.container}>
      {(isSyncing) && (
        <LoadingOverlay status={syncStatus} />
      )}
      <CollapsibleHeader
        title={t('credentials.title')}
        scrollY={scrollY}
        showNavigationHeader={true}
        alwaysVisible={true}
      />
      <RobustPressable
        style={styles.fab}
        onPress={() => {
          router.push('/(tabs)/credentials/add-edit');
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }}
      >
        <MaterialIcons name="add" style={styles.fabIcon} />
      </RobustPressable>
      <ThemedView style={styles.stepContainer}>
        <Animated.FlatList
          ref={flatListRef}
          data={isLoadingCredentials ? Array(4).fill(null) : filteredCredentials}
          keyExtractor={(item, index) => item?.Id ?? `skeleton-${index}`}
          keyboardShouldPersistTaps='handled'
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: true }
          )}
          scrollEventThrottle={16}
          contentContainerStyle={styles.contentContainer}
          scrollIndicatorInsets={{ bottom: 40 }}
          initialNumToRender={14}
          maxToRenderPerBatch={14}
          windowSize={7}
          removeClippedSubviews={false}
          ListHeaderComponent={
            <ThemedView>
              <TitleContainer title={t('credentials.title')} />
              {serviceUrl && (
                <ServiceUrlNotice
                  serviceUrl={serviceUrl}
                  onDismiss={() => setServiceUrl(null)}
                />
              )}
              <ThemedView style={styles.searchContainer}>
                <MaterialIcons
                  name="search"
                  size={20}
                  color={colors.textMuted}
                  style={styles.searchIcon}
                />
                <TextInput
                  style={styles.searchInput}
                  placeholder={t('credentials.searchPlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  value={searchQuery}
                  autoCorrect={false}
                  autoCapitalize="none"
                  multiline={false}
                  numberOfLines={1}
                  onChangeText={setSearchQuery}
                  clearButtonMode={Platform.OS === 'ios' ? 'while-editing' : 'never'}
                />
                {Platform.OS === 'android' && searchQuery.length > 0 && (
                  <TouchableOpacity
                    style={styles.clearButton}
                    onPress={() => setSearchQuery('')}
                  >
                    <ThemedText style={styles.clearButtonText}>×</ThemedText>
                  </TouchableOpacity>
                )}
              </ThemedView>
            </ThemedView>
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) =>
            isLoadingCredentials ? (
              <SkeletonLoader count={1} height={60} parts={2} />
            ) : (
              <CredentialCard credential={item} onCredentialDelete={onCredentialDelete} />
            )
          }
          ListEmptyComponent={
            !isLoadingCredentials ? (
              <Text style={styles.emptyText}>
                {searchQuery ? t('credentials.noMatchingCredentials') : t('credentials.noCredentialsFound')}
              </Text>
            ) : null
          }
        />
      </ThemedView>
      {isLoading && <LoadingOverlay status={syncStatus || t('credentials.deletingCredential')} />}
    </ThemedContainer>
  );
}