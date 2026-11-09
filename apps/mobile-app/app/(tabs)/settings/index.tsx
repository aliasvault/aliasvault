import { sharingText } from '@aliasvault/client/sharing/SharingView';
import { CapabilityKeys } from '@aliasvault/models/webapi';
import { useFocusEffect, useNavigation, type Href } from 'expo-router';
import { useRef, useState, useCallback, useEffect } from 'react';
import { StyleSheet, View, Animated, Platform, Linking, type LayoutChangeEvent, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppUnlockUtility } from '@/utils/AppUnlockUtility';
import emitter from '@/utils/EventEmitter';

import { useColors } from '@/hooks/useColorScheme';
import { useDeveloperToolsUnlock } from '@/hooks/useDeveloperToolsUnlock';
import { useLogout } from '@/hooks/useLogout';
import { useMinDurationLoading } from '@/hooks/useMinDurationLoading';
import { useNavigationDebounce } from '@/hooks/useNavigationDebounce';
import { usePaneRouter } from '@/hooks/usePaneRouter';
import { useScrollSelectedIntoScrollView } from '@/hooks/useScrollSelectedIntoView';
import { useTranslation } from '@/hooks/useTranslation';

import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedText } from '@/components/themed/ThemedText';
import { CollapsibleHeader, useCollapsibleHeaderHeight, useCollapsibleHeaderScroll } from '@/components/ui/CollapsibleHeader';
import { InlineSkeletonLoader } from '@/components/ui/InlineSkeletonLoader';
import { SettingsRow } from '@/components/ui/SettingsRow';
import { TitleContainer } from '@/components/ui/TitleContainer';
import { TwoPaneRoot } from '@/components/ui/TwoPaneLayout';
import { UsernameDisplay } from '@/components/ui/UsernameDisplay';
import { useApp } from '@/context/AppContext';
import { useCapabilities } from '@/context/CapabilityContext';
import { useDialog } from '@/context/DialogContext';
import { LocalPreferencesService } from '@/services/LocalPreferencesService';

/**
 * Settings screen.
 */
export function SettingsScreen() : React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const { showAlert, showConfirm } = useDialog();
  const { shouldShowAutofillReminder } = useApp();
  const { getAutoLockTimeout } = useApp();
  const hasCapability = useCapabilities();
  const { logoutUserInitiated } = useLogout();
  const navigate = useNavigationDebounce();
  const router = usePaneRouter();
  const insets = useSafeAreaInsets();
  const headerHeight = useCollapsibleHeaderHeight();
  // On iOS the tab bar floats over the content (the bottom inset includes it), on Android it takes its own space.
  const paddingBottom = Platform.OS === 'ios' ? insets.bottom + 16 : 16;
  const { scroll: headerScroll, onScroll: onHeaderScroll } = useCollapsibleHeaderScroll();
  const scrollViewRef = useRef<ScrollViewInstance>(null);
  // When the primary pane appears (the phone is unfolded), scroll the row of the page shown next to it into view once.
  const scrollIntoView = useScrollSelectedIntoScrollView(scrollViewRef);
  const navigation = useNavigation();
  const [autoLockDisplay, setAutoLockDisplay] = useState<string>('');
  const [clipboardClearDisplay, setClipboardClearDisplay] = useState<string>('');
  const [authMethodDisplay, setAuthMethodDisplay] = useState<string>('');
  const isSharingEnabled = hasCapability(CapabilityKeys.VaultSharing);
  const [isFirstLoad, setIsFirstLoad] = useMinDurationLoading(true, 100);
  const { isEnabled: isDeveloperToolsEnabled, refresh: refreshDeveloperTools } = useDeveloperToolsUnlock();

  useEffect(() => {
    const sub = emitter.addListener('tabPress', (routeName: string) => {
      if (routeName === 'settings' && navigation.isFocused()) {
        scrollViewRef.current?.scrollTo({ y: 0, animated: true });
      }
    });
    return (): void => sub.remove();
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      /**
       * Load the auto-lock display.
       */
      const loadAutoLockDisplay = async () : Promise<void> => {
        const autoLockTimeout = await getAutoLockTimeout();
        let display = t('common.never');

        if (autoLockTimeout === 5) {
          display = t('common.duration.5seconds');
        } else if (autoLockTimeout === 15) {
          display = t('common.duration.15seconds');
        } else if (autoLockTimeout === 30) {
          display = t('common.duration.30seconds');
        } else if (autoLockTimeout === 60) {
          display = t('settings.autoLockOptions.1minute');
        } else if (autoLockTimeout === 300) {
          display = t('settings.autoLockOptions.5minutes');
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
        } else if (autoLockTimeout === 86400) {
          display = t('settings.autoLockOptions.24hours');
        }

        setAutoLockDisplay(display);
      };

      /**
       * Load the clipboard clear display.
       */
      const loadClipboardClearDisplay = async () : Promise<void> => {
        const clipboardTimeout = await LocalPreferencesService.getClipboardClearTimeout();
        let display = t('common.never');

        if (clipboardTimeout === 5) {
          display = t('common.duration.5seconds');
        } else if (clipboardTimeout === 10) {
          display = t('settings.clipboardClearOptions.10seconds');
        } else if (clipboardTimeout === 15) {
          display = t('common.duration.15seconds');
        } else if (clipboardTimeout === 30) {
          display = t('common.duration.30seconds');
        }

        setClipboardClearDisplay(display);
      };

      /**
       * Load the auth method display.
       */
      const loadAuthMethodDisplay = async () : Promise<void> => {
        const authMethodKey = await AppUnlockUtility.getAuthMethodDisplayKey();
        setAuthMethodDisplay(t(authMethodKey));
      };

      /**
       * Load all settings data.
       */
      const loadData = async () : Promise<void> => {
        await Promise.all([loadAutoLockDisplay(), loadClipboardClearDisplay(), loadAuthMethodDisplay()]);
        setIsFirstLoad(false);
      };

      loadData();
      refreshDeveloperTools();
    }, [getAutoLockTimeout, setIsFirstLoad, refreshDeveloperTools, t])
  );

  /**
   * Handle the vault unlock press.
   */
  const handleVaultUnlockPress = () : void => {
    navigate(() => router.openDetail('/(tabs)/settings/vault-unlock'));
  };

  /**
   * Handle the auto-lock press.
   */
  const handleAutoLockPress = () : void => {
    navigate(() => router.openDetail('/(tabs)/settings/auto-lock'));
  };

  /**
   * Handle the iOS autofill press.
   */
  const handleIosAutofillPress = () : void => {
    navigate(() => router.openDetail('/(tabs)/settings/ios-autofill'));
  };

  /**
   * Handle the Android autofill press.
   */
  const handleAndroidAutofillPress = () : void => {
    navigate(() => router.openDetail('/(tabs)/settings/android-autofill'));
  };

  /**
   * Handle the identity generator settings press.
   */
  const handleIdentityGeneratorPress = () : void => {
    navigate(() => router.openDetail('/(tabs)/settings/identity-generator'));
  };

  /**
   * Handle the password generator settings press.
   */
  const handlePasswordGeneratorPress = () : void => {
    navigate(() => router.openDetail('/(tabs)/settings/password-generator'));
  };

  /**
   * Handle the clipboard clear settings press.
   */
  const handleClipboardClearPress = () : void => {
    navigate(() => router.openDetail('/(tabs)/settings/clipboard-clear'));
  };

  /**
   * Handle the advanced settings press.
   */
  const handleAdvancedPress = () : void => {
    navigate(() => router.openDetail('/(tabs)/settings/advanced'));
  };

  /**
   * Handle the about press.
   */
  const handleAboutPress = (): void => {
    navigate(() => router.openDetail('/(tabs)/settings/about'));
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
    accountSection: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      overflow: 'hidden',
    },
    groupSection: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      marginTop: 8,
      overflow: 'hidden',
    },
    groupTitle: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '600',
      marginLeft: 16,
      marginTop: 24,
      textTransform: 'uppercase',
    },
    scrollContent: {
      paddingBottom,
      paddingTop: Platform.OS === 'ios' ? headerHeight + 12 : 16,
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
    settingItemValue: {
      color: colors.textMuted,
      flexShrink: 1,
      fontSize: 16,
      marginRight: 8,
      maxWidth: '50%',
      textAlign: 'right',
    },
    skeletonLoader: {
      marginRight: 8,
    },
  });

  /**
   * The row's page: marks the row while that page shows next to the list, and scrolls to it when the pane appears.
   */
  const rowProps = (href: Href): { href: Href; onLayout?: (event: LayoutChangeEvent) => void } => ({ href, onLayout: scrollIntoView.onLayoutFor(href) });

  /**
   * The row's value, or a skeleton while the values load.
   */
  const valueOrSkeleton = (value: string, skeletonWidth: number): React.ReactNode => (isFirstLoad ? <InlineSkeletonLoader width={skeletonWidth} style={styles.skeletonLoader} /> : <ThemedText style={styles.settingItemValue}>{value}</ThemedText>);

  const autofillBadge = shouldShowAutofillReminder ? (
    <View style={styles.settingItemBadge}>
      <ThemedText style={styles.settingItemBadgeText}>1</ThemedText>
    </View>
  ) : undefined;

  return (
    <ThemedContainer testID="settings-screen">
      <CollapsibleHeader
        title={t('common.settings')}
        scroll={headerScroll}
        showNavigationHeader={false}
      />
      <Animated.ScrollView
        ref={scrollViewRef}
        onScroll={onHeaderScroll}
        scrollEventThrottle={16}
        contentContainerStyle={styles.scrollContent}
        style={styles.scrollView}
      >
        <TitleContainer title={t('common.settings')} />
        <View style={styles.accountSection}>
          <UsernameDisplay />
          <View style={styles.separator} />
          <SettingsRow testID="qr-scanner-link" icon="qr-code-outline" label={t('settings.qrScanner.scanningMessage')} {...rowProps('/(tabs)/settings/qr-scanner')} onPress={() => navigate(() => router.openDetail('/(tabs)/settings/qr-scanner'))} />
        </View>

        <ThemedText style={styles.groupTitle}>{t('settings.groups.autofill')}</ThemedText>
        <View style={styles.groupSection}>
          {Platform.OS === 'ios' && (
            <SettingsRow icon="key-outline" label={t('settings.autofill')} trailing={autofillBadge} {...rowProps('/(tabs)/settings/ios-autofill')} onPress={handleIosAutofillPress} />
          )}
          {Platform.OS === 'android' && (
            <SettingsRow icon="key-outline" label={t('settings.autofill')} trailing={autofillBadge} {...rowProps('/(tabs)/settings/android-autofill')} onPress={handleAndroidAutofillPress} />
          )}
        </View>

        <ThemedText style={styles.groupTitle}>{t('settings.security')}</ThemedText>
        <View style={styles.groupSection}>
          <SettingsRow icon="lock-closed" label={t('settings.vaultUnlock')} trailing={valueOrSkeleton(authMethodDisplay, 100)} {...rowProps('/(tabs)/settings/vault-unlock')} onPress={handleVaultUnlockPress} />
          <View style={styles.separator} />
          <SettingsRow icon="timer-outline" label={t('settings.autoLock')} trailing={valueOrSkeleton(autoLockDisplay, 80)} {...rowProps('/(tabs)/settings/auto-lock')} onPress={handleAutoLockPress} />
          <View style={styles.separator} />
          <SettingsRow icon="clipboard-outline" label={t('settings.clipboardClear')} trailing={valueOrSkeleton(clipboardClearDisplay, 80)} {...rowProps('/(tabs)/settings/clipboard-clear')} onPress={handleClipboardClearPress} />
          <View style={styles.separator} />
          <SettingsRow testID="security-settings-link" icon="shield-checkmark" label={t('settings.accountSecurity')} {...rowProps('/(tabs)/settings/security')} onPress={() => router.openDetail('/(tabs)/settings/security')} />
        </View>

        <ThemedText style={styles.groupTitle}>{t('settings.groups.generators')}</ThemedText>
        <View style={styles.groupSection}>
          <SettingsRow icon="key-sharp" label={t('settings.passwordGenerator')} {...rowProps('/(tabs)/settings/password-generator')} onPress={handlePasswordGeneratorPress} />
          <View style={styles.separator} />
          <SettingsRow icon="person-outline" label={t('settings.identityGenerator')} {...rowProps('/(tabs)/settings/identity-generator')} onPress={handleIdentityGeneratorPress} />
        </View>

        <ThemedText style={styles.groupTitle}>{t('navigation.vault')}</ThemedText>
        <View style={styles.groupSection}>
          {isSharingEnabled && (
            <>
              <SettingsRow testID="folder-sharing-link" icon="people-outline" label={sharingText.folderSharingTitle} {...rowProps('/(tabs)/settings/sharing')} onPress={() => router.openDetail('/(tabs)/settings/sharing')} />
              <View style={styles.separator} />
            </>
          )}
          <SettingsRow icon="swap-horizontal" label={t('settings.importExport')} {...rowProps('/(tabs)/settings/import-export')} onPress={() => router.openDetail('/(tabs)/settings/import-export')} />
        </View>

        <ThemedText style={styles.groupTitle}>{t('settings.groups.general')}</ThemedText>
        <View style={styles.groupSection}>
          <SettingsRow icon="language" label={t('settings.language')} onPress={handleLanguagePress} />
          <View style={styles.separator} />
          <SettingsRow testID="advanced-settings-link" icon="options-outline" label={t('settings.advancedOptions')} {...rowProps('/(tabs)/settings/advanced')} onPress={handleAdvancedPress} />
          <View style={styles.separator} />
          <SettingsRow testID="about-settings-link" icon="information-circle-outline" label={t('settings.about.title')} {...rowProps('/(tabs)/settings/about')} onPress={handleAboutPress} />
          <View style={styles.separator} />
          <SettingsRow icon="log-out" iconColor={colors.primary} label={t('common.logout')} labelColor={colors.primary} chevron={false} onPress={logoutUserInitiated} />
        </View>

        {isDeveloperToolsEnabled && (
          <View style={styles.section}>
            {/* Note: developer only screen, not required to be translated */}
            <SettingsRow icon="code-slash" iconColor={colors.red} label="Developer tools" labelColor={colors.red} {...rowProps('/(tabs)/settings/developer-tools')} onPress={() => navigate(() => router.openDetail('/(tabs)/settings/developer-tools'))} />
          </View>
        )}

      </Animated.ScrollView>

    </ThemedContainer>
  );
}

/**
 * The settings tab's root route: the settings list, or the empty detail pane of a two-pane layout, where the layout renders the list.
 */
export default function SettingsRoute(): React.ReactNode {
  const { t } = useTranslation();
  return <TwoPaneRoot placeholderIcon="settings" placeholderMessage={t('common.selectItemMessage')}><SettingsScreen /></TwoPaneRoot>;
}
