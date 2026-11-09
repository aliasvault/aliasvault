import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import { ServerSyncIndicator } from '@/components/ServerSyncIndicator';
import { defaultHeaderOptions } from '@/components/themed/ThemedHeader';
import { stackScreenLayout } from '@/components/ui/StackScreenLayout';

/**
 * Items layout.
 * @returns {React.ReactNode} The items layout component
 */
export default function ItemsLayout(): React.ReactNode {
  const { t } = useTranslation();

  return (
    <>
      <Stack screenLayout={stackScreenLayout}>
        <Stack.Screen
          name="index"
          options={{
            title: t('items.title'),
            headerShown: Platform.OS === 'android',
            ...defaultHeaderOptions,
          }}
        />
        <Stack.Screen
          name="folder/[manifestId]/[id]"
          options={{
            title: t('items.folders.folder'),
            headerBackTitle: t('items.title'),
            ...defaultHeaderOptions,
          }}
        />
        <Stack.Screen
          name="add"
          options={{
            title: t('items.addItem'),
            presentation: Platform.OS === 'ios' ? 'modal' : 'card',
            ...defaultHeaderOptions,
          }}
        />
        <Stack.Screen
          name="add-page"
          options={{
            title: t('items.addItem'),
            ...defaultHeaderOptions,
          }}
        />
        <Stack.Screen
          name="autofill-item-created"
          options={{
            title: t('items.itemCreated'),
            presentation: Platform.OS === 'ios' ? 'modal' : 'card',
            ...defaultHeaderOptions,
          }}
        />
        <Stack.Screen
          name="autofill-open-app"
          options={{
            title: t('items.autofillOpenApp.title'),
            ...defaultHeaderOptions,
          }}
        />
        <Stack.Screen
          name="autofill-link-existing"
          options={{
            title: t('items.autofillLinkExisting.title'),
            ...defaultHeaderOptions,
          }}
        />
        <Stack.Screen
          name="autofill-url-added"
          options={{
            title: t('items.autofillUrlAdded.title'),
            presentation: Platform.OS === 'ios' ? 'modal' : 'card',
            ...defaultHeaderOptions,
          }}
        />
        <Stack.Screen
          name="[manifestId]/[id]/index"
          options={({ route }) => ({
            // The name travels in the route so the header shows it before the item has loaded.
            title: (route.params as { name?: string } | undefined)?.name || t('items.itemDetails'),
            headerBackTitle: t('items.title'),
            ...defaultHeaderOptions,
          })}
        />
        <Stack.Screen
          name="[manifestId]/[id]/edit"
          options={{
            title: t('items.editItem'),
            presentation: Platform.OS === 'ios' ? 'modal' : 'card',
            ...defaultHeaderOptions,
          }}
        />
        <Stack.Screen
          name="[manifestId]/[id]/edit-page"
          options={{
            title: t('items.editItem'),
            ...defaultHeaderOptions,
          }}
        />
        <Stack.Screen
          name="email/[id]"
          options={{
            title: t('items.emailPreview'),
          }}
        />
        <Stack.Screen
          name="deleted"
          options={{
            title: t('items.recentlyDeleted.title'),
            headerBackTitle: t('items.title'),
            ...defaultHeaderOptions,
          }}
        />
      </Stack>
      <ServerSyncIndicator />
    </>
  );
}