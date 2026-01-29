import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useRef, useState, useCallback } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, Animated, Platform, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApiUrl } from '@/utils/ApiUrlUtility';
import { AppInfo } from '@/utils/AppInfo';

import { useColors } from '@/hooks/useColorScheme';
import { useLogout } from '@/hooks/useLogout';
import { useMinDurationLoading } from '@/hooks/useMinDurationLoading';
import { useTranslation } from '@/hooks/useTranslation';

import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedText } from '@/components/themed/ThemedText';
import { CollapsibleHeader } from '@/components/ui/CollapsibleHeader';
import { InlineSkeletonLoader } from '@/components/ui/InlineSkeletonLoader';
import { TitleContainer } from '@/components/ui/TitleContainer';
import { UsernameDisplay } from '@/components/ui/UsernameDisplay';
import { useApp } from '@/context/AppContext';
import { useDialog } from '@/context/DialogContext';

/**
 * Settings screen.
 */
export default function SettingsScreen() : React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const { showAlert, showConfirm } = useDialog();
  const insets = useSafeAreaInsets();
  const { getAuthMethodDisplayKey, shouldShowAutofillReminder } = useApp();
  const { getAutoLockTimeout, getClipboardClearTimeout } = useApp();
  const { logoutUserInitiated } = useLogout();
  const { loadApiUrl, getDisplayUrl } = useApiUrl();
  const scrollY = useRef(new Animated.Value(0)).current;
  const scrollViewRef = useRef<ScrollView>(null);
  const [autoLockDisplay, setAutoLockDisplay] = useState<string>('');
  const [clipboardClearDisplay, setClipboardClearDisplay] = useState<string>('');
  const [authMethodDisplay, setAuthMethodDisplay] = useState<string>('');
  const [isFirstLoad, setIsFirstLoad] = useMinDurationLoading(true, 100);

  useFocusEffect(
    useCallback(() => {
      /**
       * Load the auto-lock display.
       */
      const loadAutoLockDisplay = async () : Promise<void> => {
        const autoLockTimeout = await getAutoLockTimeout();
        let display = t('common.never');

        if (autoLockTimeout === 5) {
          display = t('settings.autoLockOptions.5seconds');
        } else if (autoLockTimeout === 30) {
          display = t('settings.autoLockOptions.30seconds');
        } else if (autoLockTimeout === 60) {
          display = t('settings.autoLockOptions.1minute');
        } else if (autoLockTimeout === 900) {
          display = t('settings.autoLockOptions.15minutes');
        } else if (autoLockTimeout === 1800) {
          display = t('settings.autoLockOptions.30minutes');
        } else if (autoLockTimeout === 3600) {
          display = t('settings.autoLockOptions.1hour');
        } else if (autoLockTimeout === 14400) {
          display = t('settings.autoLockOptions.4hours');
        } else if (autoLockTimeout === 28800) {
          display = t('settings.autoLockOptions.8hours');
        }

        setAutoLockDisplay(display);
      };

      /**
       * Load the clipboard clear display.
       */
      const loadClipboardClearDisplay = async () : Promise<void> => {
        const clipboardTimeout = await getClipboardClearTimeout();
        let display = t('common.never');

        if (clipboardTimeout === 5) {
          display = t('settings.clipboardClearOptions.5seconds');
        } else if (clipboardTimeout === 10) {
          display = t('settings.clipboardClearOptions.10seconds');
        } else if (clipboardTimeout === 15) {
          display = t('settings.clipboardClearOptions.15seconds');
        } else if (clipboardTimeout === 30) {
          display = t('settings.clipboardClearOptions.30seconds');
        }

        setClipboardClearDisplay(display);
      };

      /**
       * Load the auth method display.
       */
      const loadAuthMethodDisplay = async () : Promise<void> => {
        const authMethodKey = await getAuthMethodDisplayKey();
        setAuthMethodDisplay(t(authMethodKey));
      };

      /**
       * Load all settings data.
       */
      const loadData = async () : Promise<void> => {
        await Promise.all([loadAutoLockDisplay(), loadClipboardClearDisplay(), loadAuthMethodDisplay(), loadApiUrl()]);
        setIsFirstLoad(false);
      };

      loadData();
    }, [getAutoLockTimeout, getAuthMethodDisplayKey, setIsFirstLoad, loadApiUrl, getClipboardClearTimeout, t])
  );

  /**
   * Handle the vault unlock press.
   */
  const handleVaultUnlockPress = () : void => {
    router.push('/(tabs)/settings/vault-unlock');
  };

  /**
   * Handle the auto-lock press.
   */
  const handleAutoLockPress = () : void => {
    router.push('/(tabs)/settings/auto-lock');
  };

  /**
   * Handle the iOS autofill press.
   */
  const handleIosAutofillPress = () : void => {
    router.push('/(tabs)/settings/ios-autofill');
  };

  /**
   * Handle the Android autofill press.
   */
  const handleAndroidAutofillPress = () : void => {
    router.push('/(tabs)/settings/android-autofill');
  };

  /**
   * Handle the identity generator settings press.
   */
  const handleIdentityGeneratorPress = () : void => {
    router.push('/(tabs)/settings/identity-generator');
  };

  /**
   * Handle the password generator settings press.
   */
  const handlePasswordGeneratorPress = () : void => {
    router.push('/(tabs)/settings/password-generator');
  };

  /**
   * Handle the clipboard clear settings press.
   */
  const handleClipboardClearPress = () : void => {
    router.push('/(tabs)/settings/clipboard-clear');
  };

  /**
   * Handle the language settings press.
   */
  const handleLanguagePress = (): void => {
    const isIOS = Platform.OS === 'ios';

    showConfirm(
      t('settings.language'),
      t('settings.languageSystemMessage'),
      t('settings.openSettings'),
      async (): Promise<void> => {
        if (isIOS) {
          // Open iOS Settings app
          await Linking.openURL('app-settings:');
        } else {
          // Fallback to general locale settings
          try {
            await Linking.openSettings();
            return;
          } catch (error) {
            console.warn('Failed to open general locale settings:', error);
          }

          // Fallback to general settings
          try {
            await Linking.openSettings();
            return;
          } catch (error) {
            console.warn('Failed to open general settings:', error);
          }

          // Final fallback - show manual instructions
          showAlert(
            t('common.error') ?? 'Error',
            'Unable to open device settings. Please manually navigate to the app settings and change the language.'
          );
        }
      },
      { cancelText: t('common.cancel') }
    );
  };

  const styles = StyleSheet.create({
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
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
      width: 56,
    },
    scrollContent: {
      paddingBottom: 80,
      paddingTop: Platform.OS === 'ios' ? 42 : 16,
    },
    scrollView: {
      flex: 1,
    },
    section: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      marginTop: 20,
      overflow: 'hidden',
    },
    separator: {
      backgroundColor: colors.accentBorder,
      height: StyleSheet.hairlineWidth,
      marginLeft: 52,
    },
    settingItem: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      flexDirection: 'row',
      paddingHorizontal: 16,
      paddingVertical: 6,
    },
    settingItemBadge: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 8,
      height: 16,
      justifyContent: 'center',
      marginRight: 8,
      width: 16,
    },
    settingItemBadgeText: {
      color: colors.primarySurfaceText,
      fontSize: 10,
      fontWeight: '600',
      lineHeight: 16,
      textAlign: 'center',
    },
    settingItemContent: {
      alignItems: 'center',
      flex: 1,
      flexDirection: 'row',
      paddingVertical: 10,
    },
    settingItemIcon: {
      alignItems: 'center',
      height: 24,
      justifyContent: 'center',
      marginRight: 12,
      width: 24,
    },
    settingItemText: {
      color: colors.text,
      flex: 1,
      fontSize: 16,
    },
    settingItemValue: {
      color: colors.textMuted,
      fontSize: 16,
      marginRight: 8,
    },
    skeletonLoader: {
      marginRight: 8,
    },
    versionContainer: {
      alignItems: 'center',
      marginTop: 20,
      paddingBottom: 16,
    },
    versionText: {
      color: colors.textMuted,
      fontSize: 14,
      textAlign: 'center',
    },
  });

  return (
    <ThemedContainer testID="settings-screen">
      <CollapsibleHeader
        title={t('settings.title')}
        scrollY={scrollY}
        showNavigationHeader={false}
      />
      <Animated.ScrollView
        ref={scrollViewRef}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
        scrollEventThrottle={16}
        contentContainerStyle={styles.scrollContent}
        scrollIndicatorInsets={{ bottom: 40 }}
        style={styles.scrollView}
      >
        <TitleContainer title={t('settings.title')} />
        <UsernameDisplay />
        <View style={styles.section}>
          {Platform.OS === 'ios' && (
            <>
              <TouchableOpacity
                style={styles.settingItem}
                onPress={handleIosAutofillPress}
              >
                <View style={styles.settingItemIcon}>
                  <Ionicons name="key-outline" size={20} color={colors.text} />
                </View>
                <View style={styles.settingItemContent}>
                  <ThemedText style={styles.settingItemText}>{t('settings.autofill')}</ThemedText>
                  {shouldShowAutofillReminder && (
                    <View style={styles.settingItemBadge}>
                      <ThemedText style={styles.settingItemBadgeText}>1</ThemedText>
                    </View>
                  )}
                  <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                </View>
              </TouchableOpacity>
              <View style={styles.separator} />
            </>
          )}
          {Platform.OS === 'android' && (
            <>
              <TouchableOpacity
                style={styles.settingItem}
                onPress={handleAndroidAutofillPress}
              >
                <View style={styles.settingItemIcon}>
                  <Ionicons name="key-outline" size={20} color={colors.text} />
                </View>
                <View style={styles.settingItemContent}>
                  <ThemedText style={styles.settingItemText}>{t('settings.autofill')}</ThemedText>
                  {shouldShowAutofillReminder && (
                    <View style={styles.settingItemBadge}>
                      <ThemedText style={styles.settingItemBadgeText}>1</ThemedText>
                    </View>
                  )}
                  <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                </View>
              </TouchableOpacity>
              <View style={styles.separator} />
            </>
          )}
          <TouchableOpacity
            style={styles.settingItem}
            onPress={handleVaultUnlockPress}
          >
            <View style={styles.settingItemIcon}>
              <Ionicons name="lock-closed" size={20} color={colors.text} />
            </View>
            <View style={styles.settingItemContent}>
              <ThemedText style={styles.settingItemText}>{t('settings.vaultUnlock')}</ThemedText>
              {isFirstLoad ? (
                <InlineSkeletonLoader width={100} style={styles.skeletonLoader} />
              ) : (
                <ThemedText style={styles.settingItemValue}>{authMethodDisplay}</ThemedText>
              )}
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </View>
          </TouchableOpacity>
          <View style={styles.separator} />
          <TouchableOpacity
            style={styles.settingItem}
            onPress={handleAutoLockPress}
          >
            <View style={styles.settingItemIcon}>
              <Ionicons name="timer-outline" size={20} color={colors.text} />
            </View>
            <View style={styles.settingItemContent}>
              <ThemedText style={styles.settingItemText}>{t('settings.autoLock')}</ThemedText>
              {isFirstLoad ? (
                <InlineSkeletonLoader width={80} style={styles.skeletonLoader} />
              ) : (
                <ThemedText style={styles.settingItemValue}>{autoLockDisplay}</ThemedText>
              )}
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </View>
          </TouchableOpacity>
          <View style={styles.separator} />
          <TouchableOpacity
            style={styles.settingItem}
            onPress={handleClipboardClearPress}
          >
            <View style={styles.settingItemIcon}>
              <Ionicons name="clipboard-outline" size={20} color={colors.text} />
            </View>
            <View style={styles.settingItemContent}>
              <ThemedText style={styles.settingItemText}>{t('settings.clipboardClear')}</ThemedText>
              {isFirstLoad ? (
                <InlineSkeletonLoader width={80} style={styles.skeletonLoader} />
              ) : (
                <ThemedText style={styles.settingItemValue}>{clipboardClearDisplay}</ThemedText>
              )}
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </View>
          </TouchableOpacity>
          <View style={styles.separator} />
          <TouchableOpacity
            style={styles.settingItem}
            onPress={handleLanguagePress}
          >
            <View style={styles.settingItemIcon}>
              <Ionicons name="language" size={20} color={colors.text} />
            </View>
            <View style={styles.settingItemContent}>
              <ThemedText style={styles.settingItemText}>{t('settings.language')}</ThemedText>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <TouchableOpacity
            style={styles.settingItem}
            onPress={handlePasswordGeneratorPress}
          >
            <View style={styles.settingItemIcon}>
              <Ionicons name="key-sharp" size={20} color={colors.text} />
            </View>
            <View style={styles.settingItemContent}>
              <ThemedText style={styles.settingItemText}>{t('settings.passwordGenerator')}</ThemedText>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </View>
          </TouchableOpacity>
          <View style={styles.separator} />
          <TouchableOpacity
            style={styles.settingItem}
            onPress={handleIdentityGeneratorPress}
          >
            <View style={styles.settingItemIcon}>
              <Ionicons name="person-outline" size={20} color={colors.text} />
            </View>
            <View style={styles.settingItemContent}>
              <ThemedText style={styles.settingItemText}>{t('settings.identityGenerator')}</ThemedText>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </View>
          </TouchableOpacity>
          <View style={styles.separator} />
          <TouchableOpacity
            style={styles.settingItem}
            onPress={() => router.push('/(tabs)/settings/import-export')}
          >
            <View style={styles.settingItemIcon}>
              <Ionicons name="swap-horizontal" size={20} color={colors.text} />
            </View>
            <View style={styles.settingItemContent}>
              <ThemedText style={styles.settingItemText}>{t('settings.importExport')}</ThemedText>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </View>
          </TouchableOpacity>
          <View style={styles.separator} />
          <TouchableOpacity
            testID="security-settings-link"
            style={styles.settingItem}
            onPress={() => router.push('/(tabs)/settings/security')}
          >
            <View style={styles.settingItemIcon}>
              <Ionicons name="shield-checkmark" size={20} color={colors.text} />
            </View>
            <View style={styles.settingItemContent}>
              <ThemedText style={styles.settingItemText}>{t('settings.security')}</ThemedText>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <TouchableOpacity
            style={styles.settingItem}
            onPress={logoutUserInitiated}
          >
            <View style={styles.settingItemIcon}>
              <Ionicons name="log-out" size={20} color={colors.primary} />
            </View>
            <View style={styles.settingItemContent}>
              <ThemedText style={[styles.settingItemText, { color: colors.primary }]}>{t('auth.logout')}</ThemedText>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.versionContainer}>
          <ThemedText style={styles.versionText}>{t('settings.appVersion', { version: AppInfo.VERSION, url: getDisplayUrl() })}</ThemedText>
        </View>
      </Animated.ScrollView>

      {/* Floating Action Button for QR Scanner - shown for testing both options */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/(tabs)/settings/qr-scanner')}
        activeOpacity={0.8}
      >
        <Ionicons name="qr-code-outline" size={32} color={colors.primarySurfaceText} />
      </TouchableOpacity>
    </ThemedContainer>
  );
}