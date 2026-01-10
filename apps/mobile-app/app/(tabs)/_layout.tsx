import { Tabs, router } from 'expo-router';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';

import emitter from '@/utils/EventEmitter';

import { useColors } from '@/hooks/useColorScheme';

import { ServerSyncIndicator } from '@/components/ServerSyncIndicator';
import { ThemedText } from '@/components/themed/ThemedText';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { IconSymbolName } from '@/components/ui/IconSymbolName';
import TabBarBackground from '@/components/ui/TabBarBackground';
import { useApp } from '@/context/AppContext';
import { useDb } from '@/context/DbContext';

/**
 * This is the main layout for the app. It is used to navigate between the tabs.
 */
export default function TabLayout() : React.ReactNode {
  const colors = useColors();
  const authContext = useApp();
  const dbContext = useDb();
  const { t } = useTranslation();

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

  const styles = StyleSheet.create({
    iconContainer: {
      position: 'relative',
    },
    iconNotificationContainer: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 8,
      height: 16,
      justifyContent: 'center',
      position: 'absolute',
      right: -4,
      top: -4,
      width: 16,
    },
    iconNotificationText: {
      color: colors.primarySurfaceText,
      fontSize: 10,
      fontWeight: '600',
      lineHeight: 16,
      textAlign: 'center',
    },
  });

  return (
    <>
      <Tabs
        screenListeners={{
          /**
           * Listener for the tab press event.
           * @param {Object} e - The event object.
           * @param {string} e.target - The target pathname.
           */
          tabPress: (e) => {
            const targetPathname = (e.target as string).split('-')[0];
            emitter.emit('tabPress', targetPathname);
          },
        }}
        screenOptions={{
          tabBarActiveTintColor: colors.tint,
          headerShown: false,
          tabBarBackground: TabBarBackground,
          tabBarStyle: Platform.select({
            ios: {
              position: 'absolute',
            },
            android: {
              backgroundColor: colors.tabBarBackground,
            },
            default: {},
          }),
        }}>
        <Tabs.Screen
          name="items"
          options={{
            title: t('navigation.vault'),
            /**
             * Icon for the vault tab.
             */
            tabBarIcon: ({ color }) => <IconSymbol size={28} name={IconSymbolName.Key} color={color} />,
          }}
        />
        <Tabs.Screen
          name="emails"
          options={{
            title: t('navigation.emails'),
            /**
             * Icon for the emails tab.
             */
            tabBarIcon: ({ color }) => <IconSymbol size={28} name={IconSymbolName.Envelope} color={color} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: t('navigation.settings'),
            /**
             * Icon for the settings tab.
             */
            tabBarIcon: ({ color }) => (
              <View style={styles.iconContainer}>
                <IconSymbol size={28} name={IconSymbolName.Gear} color={color} />
                {authContext.shouldShowAutofillReminder && (
                  <View style={styles.iconNotificationContainer}>
                    <ThemedText style={styles.iconNotificationText}>1</ThemedText>
                  </View>
                )}
              </View>
            )
          }}
        />
      </Tabs>

      {/* Floating sync indicator - visible on all tabs */}
      <ServerSyncIndicator />
    </>
  );
}