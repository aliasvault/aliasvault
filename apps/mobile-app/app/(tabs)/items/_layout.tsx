import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import { defaultHeaderOptions } from '@/components/themed/ThemedHeader';

/**
 * Items layout.
 * @returns {React.ReactNode} The items layout component
 */
export default function ItemsLayout(): React.ReactNode {
  const { t } = useTranslation();

  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          title: t('items.title'),
          headerShown: Platform.OS === 'android',
          ...defaultHeaderOptions,
        }}
      />
      <Stack.Screen
        name="folder/[id]"
        options={{
          title: t('items.folders.folder'),
          headerBackTitle: t('items.title'),
          ...defaultHeaderOptions,
        }}
      />
      <Stack.Screen
        name="add-edit"
        options={{
          title: t('items.addItem'),
          presentation: Platform.OS === 'ios' ? 'modal' : 'card',
          ...defaultHeaderOptions,
        }}
      />
      <Stack.Screen
        name="add-edit-page"
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
        name="[id]"
        options={{
          title: t('items.itemDetails'),
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
  );
}