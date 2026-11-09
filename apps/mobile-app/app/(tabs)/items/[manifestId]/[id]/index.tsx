import { scopedKey, type ItemRef } from '@aliasvault/client/database/ItemRef';
import { FieldTypes, getFieldValue, FieldKey } from '@aliasvault/models/vault';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useVerticalBarEdgeIOS } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View, Text, StyleSheet, Linking, Platform, RefreshControl, Share, TouchableOpacity } from 'react-native';
import ContextMenu from 'react-native-context-menu-view';
import { toast } from 'sonner-native';

import { copyToClipboardWithExpiration } from '@/utils/ClipboardUtility';
import type { DisplayItem } from '@/utils/DisplayItem';
import emitter, { type ItemChangedEvent } from '@/utils/EventEmitter';
import { itemEditRoute } from '@/utils/ItemRoute';

import { useColors } from '@/hooks/useColorScheme';
import { useNavigationDebounce } from '@/hooks/useNavigationDebounce';
import { useVaultRefresh } from '@/hooks/useVaultRefresh';

import { FolderBreadcrumb } from '@/components/folders/FolderBreadcrumb';
import { AliasDetails } from '@/components/items/details/AliasDetails';
import { AttachmentSection } from '@/components/items/details/AttachmentSection';
import { CardDetails } from '@/components/items/details/CardDetails';
import { CustomFieldsSection } from '@/components/items/details/CustomFieldsSection';
import { EmailPreview } from '@/components/items/details/EmailPreview';
import { LoginFields } from '@/components/items/details/LoginFields';
import { NotesSection } from '@/components/items/details/NotesSection';
import { TotpSection } from '@/components/items/details/TotpSection';
import { ItemIcon } from '@/components/items/ItemIcon';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { useDb } from '@/context/DbContext';
import { LocalPreferencesService } from '@/services/LocalPreferencesService';

import type { NativeSyntheticEvent } from 'react-native';
import type { ContextMenuOnPressNativeEvent } from 'react-native-context-menu-view';

/**
 * Empty header background for the iPhone Duo rail pose.
 */
const noHeaderBackground = (): null => null;

/**
 * Item details screen.
 */
export default function ItemDetailsScreen() : React.ReactNode {
  const { id, manifestId } = useLocalSearchParams<{ manifestId: string; id: string }>();
  const [itemRef, setItemRef] = useState<ItemRef>({ Id: id, ManifestId: manifestId });
  const [item, setItem] = useState<DisplayItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const dbContext = useDb();
  const navigation = useNavigation();
  const colors = useColors();
  const verticalBarEdge = useVerticalBarEdgeIOS();
  const router = useRouter();
  const navigate = useNavigationDebounce();
  const { t } = useTranslation();

  /**
   * Handle the edit button press.
   */
  const handleEdit = useCallback(() : void => {
    navigate(() => router.push(itemEditRoute(itemRef)));
  }, [itemRef, router, navigate]);

  // Header button on Android. On iOS it is a native bar button item (the toolbar below), which the iPhone Duo bar rail picks up.
  useEffect(() => {
    if (Platform.OS === 'ios') {
      return;
    }
    navigation.setOptions({
      /**
       * Header right button.
       */
      headerRight: (): React.ReactNode => (
        <View style={styles.headerRightContainer}>
          <RobustPressable onPress={handleEdit} style={styles.headerRightButton}>
            <MaterialIcons name="edit" size={24} color={colors.primary} />
          </RobustPressable>
        </View>
      ),
    });
  }, [navigation, handleEdit, colors.primary]);

  /**
   * Load the item, returns false when it no longer exists.
   */
  const loadItem = useCallback(async () : Promise<boolean> => {
    if (!dbContext.dbAvailable) {
      return true;
    }

    try {
      const result = await dbContext.sqliteClient!.items.getById(itemRef);
      setItem(result);
      return result !== null;
    } catch (err) {
      console.error('Error loading item:', err);
      return true;
    } finally {
      setIsLoading(false);
    }
  }, [itemRef, dbContext.dbAvailable, dbContext.sqliteClient]);

  /**
   * Reload the item after a pull-to-refresh sync, leaving the screen when it was deleted elsewhere.
   */
  const reloadAfterSync = useCallback(async () : Promise<void> => {
    if (!await loadItem()) {
      router.back();
    }
  }, [loadItem, router]);

  const { refreshing, onRefresh } = useVaultRefresh(reloadAfterSync);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadItem is async; setState only fires after data is fetched
    loadItem();

    // Add listener for item changes
    const itemChangedSub = emitter.addListener('itemChanged', async (change?: ItemChangedEvent) => {
      if (!change || scopedKey(change.previous.ManifestId, change.previous.Id) !== scopedKey(itemRef.ManifestId, itemRef.Id)) {
        return;
      }
      if (change.current && change.current.ManifestId !== itemRef.ManifestId) {
        // The edit moved the item to another manifest: follow it, which reloads.
        setItemRef(change.current);
        return;
      }
      await loadItem();
    });

    return () : void => {
      itemChangedSub.remove();
      toast.dismiss();
    };
  }, [itemRef, loadItem]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#f97316" />
      </View>
    );
  }

  if (!item) {
    return null;
  }

  // Extract URL fields for display
  const urlFields = item.Fields.filter(field => field.FieldType === FieldTypes.URL && field.Value);

  // Get email for EmailPreview
  const email = getFieldValue(item, FieldKey.LoginEmail);

  /**
   * Helper function to copy URL to clipboard with auto-clear
   */
  const copyUrlToClipboard = async (url: string): Promise<void> => {
    try {
      // Get clipboard clear timeout from settings
      const timeoutSeconds = await LocalPreferencesService.getClipboardClearTimeout();

      // Use centralized clipboard utility
      await copyToClipboardWithExpiration(url, timeoutSeconds);

      if (Platform.OS === 'ios') {
        toast.success(t('items.toasts.urlCopied'));
      }
    } catch (error) {
      console.error('Failed to copy URL to clipboard:', error);
    }
  };

  /**
   * Handles the context menu action for URLs
   */
  const handleUrlContextMenuAction = async (
    event: NativeSyntheticEvent<ContextMenuOnPressNativeEvent>,
    url: string
  ): Promise<void> => {
    const { name } = event.nativeEvent;

    switch (name) {
      case t('items.urlContextMenu.copyLink'):
        await copyUrlToClipboard(url);
        break;
      case t('items.urlContextMenu.openLink'):
        await Linking.openURL(url);
        break;
      case t('items.urlContextMenu.shareLink'):
        try {
          await Share.share({
            message: url,
            url: Platform.OS === 'ios' ? url : undefined,
          });
        } catch (error) {
          console.error('Failed to share URL:', error);
        }
        break;
    }
  };

  /**
   * Get context menu actions for URL
   */
  const getUrlMenuActions = (): {
    title: string;
    systemIcon: string;
  }[] => [
    {
      title: t('items.urlContextMenu.copyLink'),
      systemIcon: Platform.select({
        ios: 'doc.on.doc',
        android: 'baseline_content_copy',
        default: 'doc.on.doc',
      }),
    },
    {
      title: t('items.urlContextMenu.openLink'),
      systemIcon: Platform.select({
        ios: 'arrow.up.right.square',
        android: 'baseline_open_in_new',
        default: 'arrow.up.right.square',
      }),
    },
    {
      title: t('items.urlContextMenu.shareLink'),
      systemIcon: Platform.select({
        ios: 'square.and.arrow.up',
        android: 'baseline_share',
        default: 'square.and.arrow.up',
      }),
    },
  ];

  /**
   * Render all URL values from URL fields.
   */
  const renderUrls = (): React.ReactNode => {
    if (urlFields.length === 0) {
      return null;
    }

    return (
      <View style={styles.urlContainer}>
        {urlFields.flatMap((urlField) => {
          // Handle both single string and array of strings
          const urlValues = Array.isArray(urlField.Value) ? urlField.Value : [urlField.Value];

          return urlValues.map((urlValue, idx) => {
            const isValidUrl = /^https?:\/\//i.test(urlValue);
            const key = `${urlField.FieldKey}-${idx}`;

            return isValidUrl ? (
              <ContextMenu
                key={key}
                title={t('items.urlContextMenu.title')}
                actions={getUrlMenuActions()}
                onPress={(event) => handleUrlContextMenuAction(event, urlValue)}
                previewBackgroundColor={colors.accentBackground}
              >
                <View style={styles.urlContextWrapper}>
                  <TouchableOpacity
                    onPress={() => Linking.openURL(urlValue)}
                    onLongPress={() => {
                      // Ignore long press to prevent context menu long press from triggering the press.
                    }}
                    activeOpacity={0.7}
                    hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
                  >
                    <Text style={[styles.serviceUrl, { color: colors.primary }]}>
                      {urlValue}
                    </Text>
                  </TouchableOpacity>
                </View>
              </ContextMenu>
            ) : (
              <Text key={key} style={[styles.serviceUrl, { color: colors.textMuted }]}>
                {urlValue}
              </Text>
            );
          });
        })}
      </View>
    );
  };

  return (
    <ThemedContainer>
      {/* In the iPhone Duo rail pose the back and edit buttons live in the rail, so the top bar is dropped. */}
      <Stack.Screen options={verticalBarEdge === null ? { title: t('items.view.viewItemTitle') } : { title: '', headerShown: false, headerBackground: noHeaderBackground }} />
      {Platform.OS === 'ios' && (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon="pencil" onPress={handleEdit}>{t('common.edit')}</Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
      <ThemedScrollView
        contentContainerStyle={verticalBarEdge !== null ? styles.scrollContentNoHeader : undefined}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      >
        {/* Folder breadcrumb navigation */}
        <FolderBreadcrumb folder={item.FolderId ? { Id: item.FolderId, ManifestId: item.ManifestId } : null} />

        <ThemedView style={styles.header}>
          <ItemIcon item={item} style={styles.logo} />
          <View style={styles.headerText}>
            <ThemedText type="title" style={styles.serviceName}>
              {item.Name}
            </ThemedText>
            {renderUrls()}
          </View>
        </ThemedView>
        <EmailPreview email={email} manifestId={item.ManifestId} />
        <TotpSection item={item} />
        <LoginFields item={item} />
        <CardDetails item={item} />
        <AliasDetails item={item} />
        <NotesSection item={item} />
        <CustomFieldsSection item={item} />
        <AttachmentSection item={item} />
      </ThemedScrollView>
    </ThemedContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  headerRightButton: {
    padding: 10,
  },
  headerRightButtonPressed: {
    padding: 10,
    opacity: 0.8,
  },
  headerRightContainer: {
    flexDirection: 'row',
  },
  headerText: {
    flex: 1,
  },
  loadingContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  logo: {
    height: 48,
    width: 48,
  },
  scrollContentNoHeader: {
    paddingTop: 0,
  },
  serviceName: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  serviceUrl: {
    fontSize: 14,
  },
  urlContainer: {
    gap: 2,
  },
  urlContextWrapper: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginVertical: -6,
    marginHorizontal: -12,
  },
});