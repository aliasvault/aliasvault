import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import emitter from '@/utils/EventEmitter';

import { useColors } from '@/hooks/useColorScheme';
import { useForegroundSync } from '@/hooks/useForegroundSync';

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

  if (!isFullyInitialized || requireLoginOrUnlock) {
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
      screenListeners={{
        /**
         * Listener for the tab press event.
         * @param {Object} e - The event object.
         * @param {string} e.target - The target route key.
         */
        tabPress: (e) => {
          const targetPathname = (e.target as string).split(/[-:]/)[0];
          emitter.emit('tabPress', targetPathname);
        },
      }}
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
