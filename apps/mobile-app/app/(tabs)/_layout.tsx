import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import emitter from '@/utils/EventEmitter';

import { useColors } from '@/hooks/useColorScheme';
import { useForegroundSync } from '@/hooks/useForegroundSync';
import { useIsTwoPaneEnabled } from '@/hooks/useTwoPane';

import { useApp } from '@/context/AppContext';
import { useDb } from '@/context/DbContext';

/**
 * This is the main layout for the app. It is used to navigate between the tabs.
 * The tab bar is the system one (UITabBarController on iOS, Material bottom navigation on Android).
 */
export default function TabLayout() : React.ReactNode {
  const colors = useColors();
  const authContext = useApp();
  const dbContext = useDb();
  const { t } = useTranslation();

  useForegroundSync();
  const twoPaneEnabled = useIsTwoPaneEnabled();

  // Check if user is authenticated and database is available
  const isFullyInitialized = authContext.isInitialized && dbContext.dbInitialized;
  const isAuthenticated = authContext.isLoggedIn;
  const isDatabaseAvailable = dbContext.dbAvailable;
  const requireLoginOrUnlock = isFullyInitialized && (!isAuthenticated || !isDatabaseAvailable);

  /**
   * Authentication redirects are now handled globally in AppContext
   * This effect is kept for legacy support but can be removed in the future
   */
  useEffect(() => {
    if (requireLoginOrUnlock) {
      // Small delay to let global auth listener handle it first
      const timer = setTimeout(() => {
        router.replace('/login');
      }, 200);
      return () : void => clearTimeout(timer);
    }
  }, [requireLoginOrUnlock]);

  if (!isFullyInitialized || requireLoginOrUnlock || twoPaneEnabled === undefined) {
    return null;
  }

  return (
    <NativeTabs
      tintColor={colors.tint}
      badgeBackgroundColor={colors.primary}
      backgroundColor={Platform.OS === 'android' ? colors.tabBarBackground : undefined}
      iconColor={Platform.OS === 'android' ? { default: colors.tabIconDefault, selected: colors.tabIconSelected } : undefined}
      labelStyle={Platform.OS === 'android' ? { default: { color: colors.tabIconDefault }, selected: { color: colors.tabIconSelected } } : undefined}
      indicatorColor={colors.primary + '20'}
      rippleColor={colors.primary + '20'}
      screenListeners={({ navigation, route }) => ({
        /**
         * Listener for the tab press event: tells the tab's root screen, and pops the tab's stack when the focused tab
         * is tapped again.
         */
        tabPress: (): void => {
          emitter.emit('tabPress', route.name);
          const stack = navigation.getState().routes.find((entry: { key: string }) => entry.key === route.key)?.state;
          if (navigation.isFocused() && stack?.key && (stack.index ?? 0) > 0) {
            navigation.dispatch({ type: 'POP_TO_TOP', target: stack.key });
          }
        },
      })}
    >
      <NativeTabs.Trigger name="items" testID="tab-items">
        <NativeTabs.Trigger.Icon sf="key.fill" src={<NativeTabs.Trigger.VectorIcon family={MaterialIcons} name="key" />} />
        <NativeTabs.Trigger.Label>{t('navigation.vault')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="emails" testID="tab-emails">
        <NativeTabs.Trigger.Icon sf="envelope.fill" src={<NativeTabs.Trigger.VectorIcon family={MaterialIcons} name="mail" />} />
        <NativeTabs.Trigger.Label>{t('emails.title')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings" testID="tab-settings">
        <NativeTabs.Trigger.Icon sf="gear" src={<NativeTabs.Trigger.VectorIcon family={MaterialIcons} name="settings" />} />
        <NativeTabs.Trigger.Label>{t('common.settings')}</NativeTabs.Trigger.Label>
        {authContext.shouldShowAutofillReminder && <NativeTabs.Trigger.Badge>1</NativeTabs.Trigger.Badge>}
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
