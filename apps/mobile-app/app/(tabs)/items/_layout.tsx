import { Stack } from 'expo-router';
import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import type { PrimaryRoute } from '@/hooks/usePaneStack';
import { useIsTwoPaneEnabled, useIsTwoPaneWindow, type ScreenParams } from '@/hooks/useTwoPane';

import FolderViewScreen from '@/app/(tabs)/items/folder/[manifestId]/[id]';
import { ItemsScreen } from '@/app/(tabs)/items/index';
import { FolderRouteTitle } from '@/components/folders/FolderRouteTitle';
import { ServerSyncIndicator } from '@/components/ServerSyncIndicator';
import { defaultHeaderOptions } from '@/components/themed/ThemedHeader';
import { TwoPaneLayout, twoPaneScreenLayout, usePrimaryRouteOptions } from '@/components/ui/TwoPaneLayout';

/**
 * Items layout.
 * @returns {React.ReactNode} The items layout component
 */
export default function ItemsLayout(): React.ReactNode {
  const { t } = useTranslation();
  const folderTitle = useCallback((params: ScreenParams): string => params.name || t('items.folders.folder'), [t]);
  // Folders show on the primary pane of a two-pane layout, on its own stack.
  const primaryRoutes = useMemo((): Record<string, PrimaryRoute> => ({ 'folder/[manifestId]/[id]': { screen: FolderViewScreen, title: folderTitle, headerTitle: FolderRouteTitle } }), [folderTitle]);
  const primaryRouteOptions = usePrimaryRouteOptions();
  const isTwoPane = useIsTwoPaneWindow();
  const isTwoPaneEnabled = useIsTwoPaneEnabled() === true;

  /*
   * A header that updates during a fold or a bar rail change loses its title view. So a folder route that was on the
   * stack on two panes, where it is the empty detail pane with a hidden title view over the plain title, keeps the plain
   * title once the window shows a single pane. A folder opened on a single pane has the title view.
   */
  const routesShownOnTwoPanes = useRef(new Set<string>());
  /**
   * Whether the folder route shows its title view; also records the routes on the stack on two panes.
   */
  const hasFolderTitleView = (routeKey: string): boolean => {
    if (isTwoPane) {
      routesShownOnTwoPanes.current.add(routeKey);
    }
    return isTwoPane || !isTwoPaneEnabled || !routesShownOnTwoPanes.current.has(routeKey);
  };

  return (
    <>
      <TwoPaneLayout path="/(tabs)/items" primary={<ItemsScreen />} primaryTitle={t('items.title')} primaryRoutes={primaryRoutes}>
        <Stack screenLayout={twoPaneScreenLayout}>
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
            options={({ route }) => ({
              title: folderTitle((route.params ?? {}) as ScreenParams),
              ...(hasFolderTitleView(route.key ?? '') && {
                /**
                 * Folder icon and name; hidden on two panes.
                 */
                headerTitle: (): React.ReactNode => <FolderRouteTitle params={(route.params ?? {}) as ScreenParams} isHidden={isTwoPane} />,
              }),
              headerBackTitle: t('items.title'),
              ...defaultHeaderOptions,
              ...primaryRouteOptions,
            })}
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
            options={{
              title: t('items.view.viewItemTitle'),
              headerBackTitle: t('items.title'),
              ...defaultHeaderOptions,
            }}
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
              title: t('emails.emailDetails'),
              ...defaultHeaderOptions,
              headerTransparent: false,
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
      </TwoPaneLayout>
      <ServerSyncIndicator />
    </>
  );
}