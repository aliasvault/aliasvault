import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform, Text } from 'react-native';

import { EmailsScreen } from '@/app/(tabs)/emails/index';
import { ServerSyncIndicator } from '@/components/ServerSyncIndicator';
import { defaultHeaderOptions } from '@/components/themed/ThemedHeader';
import { AndroidHeader } from '@/components/ui/AndroidHeader';
import { stackScreenLayout } from '@/components/ui/StackScreenLayout';
import { TwoPaneLayout } from '@/components/ui/TwoPaneLayout';

/**
 * Emails layout.
 */
export default function EmailsLayout(): React.ReactNode {
  const { t } = useTranslation();
  return (
    <>
      <TwoPaneLayout primary={<EmailsScreen />}>
        <Stack screenLayout={stackScreenLayout}>
          <Stack.Screen
            name="index"
            options={{
              title: t('emails.title'),
              headerShown: Platform.OS === 'android',
              /**
               * On Android, we use a custom header component that includes the AliasVault logo.
               * On iOS, we don't show the header as a custom collapsible header is used.
               * @returns {React.ReactNode} The header component
               */
              headerTitle: (): React.ReactNode => Platform.OS === 'android' ? <AndroidHeader title={t('emails.title')} /> : <Text>{t('emails.title')}</Text>,
              ...defaultHeaderOptions,
            }}
          />
          <Stack.Screen
            name="[id]"
            options={({ route }) => ({
              // The subject travels in the route so the header shows it before the email has loaded.
              title: (route.params as { subject?: string } | undefined)?.subject || t('emails.emailDetails'),
              ...defaultHeaderOptions,
              headerTransparent: false,
            })}
          />
        </Stack>
      </TwoPaneLayout>
      <ServerSyncIndicator />
    </>
  );
}