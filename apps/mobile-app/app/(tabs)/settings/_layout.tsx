import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform, Text } from 'react-native';

import { defaultHeaderOptions } from '@/components/themed/ThemedHeader';
import { AndroidHeader } from '@/components/ui/AndroidHeader';

/**
 * Settings layout.
 */
export default function SettingsLayout(): React.ReactNode {
  const { t } = useTranslation();

  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          title: t('settings.title'),
          headerShown: Platform.OS === 'android',
          /**
           * On Android, we use a custom header component that includes the AliasVault logo.
           * On iOS, we don't show the header as a custom collapsible header is used.
           * @returns {React.ReactNode} The header component
           */
          headerTitle: (): React.ReactNode => Platform.OS === 'android' ? <AndroidHeader title={t('settings.title')} /> : <Text>{t('settings.title')}</Text>,
          ...defaultHeaderOptions,
        }}
      />
      <Stack.Screen
        name="ios-autofill"
        options={{
          title: t('settings.autofill'),
          headerBackTitle: t('settings.title'),
          ...defaultHeaderOptions,
        }}
      />
      <Stack.Screen
        name="android-autofill"
        options={{
          title: t('settings.autofill'),
          headerBackTitle: t('settings.title'),
          ...defaultHeaderOptions,
        }}
      />
      <Stack.Screen
        name="vault-unlock"
        options={{
          title: t('settings.vaultUnlock'),
          headerBackTitle: t('settings.title'),
          ...defaultHeaderOptions,
        }}
      />
      <Stack.Screen
        name="auto-lock"
        options={{
          title: t('settings.autoLock'),
          headerBackTitle: t('settings.title'),
          ...defaultHeaderOptions,
        }}
      />
      <Stack.Screen
        name="clipboard-clear"
        options={{
          title: t('settings.clipboardClear'),
          headerBackTitle: t('settings.title'),
          ...defaultHeaderOptions,
        }}
      />
      <Stack.Screen
        name="password-generator"
        options={{
          title: t('settings.passwordGenerator'),
          headerBackTitle: t('settings.title'),
          ...defaultHeaderOptions,
        }}
      />
      <Stack.Screen
        name="identity-generator"
        options={{
          title: t('settings.identityGenerator'),
          headerBackTitle: t('settings.title'),
          ...defaultHeaderOptions,
        }}
      />
      <Stack.Screen
        name="identity-generator-language"
        options={{
          title: t('settings.identityGeneratorSettings.languageSection'),
          headerBackTitle: t('settings.identityGenerator'),
          ...defaultHeaderOptions,
        }}
      />
      <Stack.Screen
        name="import-export"
        options={{
          title: t('settings.importExport'),
          headerBackTitle: t('settings.title'),
          ...defaultHeaderOptions,
        }}
      />
      <Stack.Screen
        name="security/index"
        options={{
          title: t('settings.securitySettings.title'),
          headerBackTitle: t('settings.title'),
          ...defaultHeaderOptions,
        }}
      />
      <Stack.Screen
        name="security/change-password"
        options={{
          title: t('settings.securitySettings.changePassword.changePassword'),
          ...defaultHeaderOptions,
        }}
      />
      <Stack.Screen
        name="security/active-sessions"
        options={{
          title: t('settings.securitySettings.activeSessionsTitle'),
          ...defaultHeaderOptions,
        }}
      />
      <Stack.Screen
        name="security/auth-logs"
        options={{
          title: t('settings.securitySettings.recentAuthLogs'),
          ...defaultHeaderOptions,
        }}
      />
      <Stack.Screen
        name="security/delete-account"
        options={{
          title: t('settings.securitySettings.deleteAccountTitle'),
          ...defaultHeaderOptions,
        }}
      />
      <Stack.Screen
        name="qr-scanner"
        options={{
          title: t('settings.qrScanner.title'),
          ...defaultHeaderOptions,
        }}
      />
      <Stack.Screen
        name="mobile-unlock/[id]"
        options={{
          title: t('settings.qrScanner.mobileLogin.confirmTitle'),
          ...defaultHeaderOptions,
        }}
      />
      <Stack.Screen
        name="mobile-unlock/result"
        options={{
          title: t('common.success'),
          ...defaultHeaderOptions,
        }}
      />
    </Stack>
  );
}