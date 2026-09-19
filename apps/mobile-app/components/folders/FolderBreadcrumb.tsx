import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import { getFolderIdPath, getFolderPath } from '@aliasvault/client/items/FolderUtils';
import { useColors } from '@/hooks/useColorScheme';
import { useDb } from '@/context/DbContext';
import { folderRoute } from '@/utils/FolderRoute';

import type { Folder, FolderRef } from '@aliasvault/client/database/repositories/FolderRepository';

type Breadcrumb = {
  name: string;
  id: string;
};

type FolderBreadcrumbProps = {
  /**
   * The current folder to show breadcrumbs for.
   * If null/undefined, no breadcrumbs are shown.
   */
  folder: FolderRef | null | undefined;
  /**
   * Optional root label for the first breadcrumb.
   * Defaults to 'items.title' translation key.
   */
  rootLabel?: string;
  /**
   * Whether to exclude the current folder from breadcrumbs.
   * Useful when the folder name is already shown in the header.
   * Defaults to false.
   */
  excludeCurrentFolder?: boolean;
  /**
   * The vault's folders, when the caller already holds them to avoid doing a separate query.
   */
  folders?: Folder[];
};

/**
 * Displays a breadcrumb navigation trail for folder hierarchy.
 * Shows the path to the current location, with optional exclusion of current folder.
 * Example: "Items > Work > Projects > Client A"
 */
export const FolderBreadcrumb: React.FC<FolderBreadcrumbProps> = ({
  folder,
  rootLabel,
  excludeCurrentFolder = false,
  folders,
}) => {
  const { t } = useTranslation();
  const router = useRouter();
  const dbContext = useDb();
  const colors = useColors();
  const [loadedFolders, setLoadedFolders] = useState<Folder[]>([]);
  const folderId = folder?.Id ?? null;
  const manifestId = folder?.ManifestId ?? null;

  /**
   * Load the folders this trail is built from, unless the caller already passed them in.
   */
  useEffect(() => {
    const loadFolders = async () => {
      if (folders || !folderId || !dbContext?.sqliteClient) {
        return;
      }

      try {
        setLoadedFolders(await dbContext.sqliteClient.folders.getAll());
      } catch (error) {
        console.error('[FolderBreadcrumb] Error loading folders:', error);
        setLoadedFolders([]);
      }
    };

    loadFolders();
  }, [folders, folderId, dbContext?.sqliteClient]);

  /**
   * Build the breadcrumb trail for the current folder.
   * Optionally excludes the current folder (to avoid duplication with page title).
   */
  const breadcrumbs = useMemo((): Breadcrumb[] => {
    const allFolders = folders ?? loadedFolders;
    if (!folderId || !manifestId || allFolders.length === 0) {
      return [];
    }

    const ref = { Id: folderId, ManifestId: manifestId };
    const folderNames = getFolderPath(ref, allFolders);
    const folderIds = getFolderIdPath(ref, allFolders);
    const fullPath = folderNames.map((name, index) => ({ name, id: folderIds[index] }));

    // If requested, exclude the current folder from breadcrumbs
    return excludeCurrentFolder ? fullPath.slice(0, -1) : fullPath;
  }, [folders, loadedFolders, folderId, manifestId, excludeCurrentFolder]);

  /**
   * Handle breadcrumb navigation. Every folder on the trail shares the current folder's manifest.
   */
  const handleBreadcrumbClick = useCallback((crumbId: string) => {
    if (manifestId) {
      router.dismissTo(folderRoute({ Id: crumbId, ManifestId: manifestId }));
    }
  }, [router, manifestId]);

  /**
   * Handle root breadcrumb click (navigate to items list).
   */
  const handleRootClick = useCallback(() => {
    router.dismissTo('/(tabs)/items');
  }, [router]);

  /*
   * Don't render anything if:
   * 1. No folder provided (item is at root level) - saves UI space
   */
  if (!folderId) {
    return null;
  }

  const rootLabelText = rootLabel ?? t('items.title');

  const styles = StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      marginBottom: 12,
      paddingHorizontal: 2,
    },
    rootButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingVertical: 4,
      paddingHorizontal: 4,
      borderRadius: 4,
    },
    rootText: {
      fontSize: 13,
      color: colors.textMuted,
      fontWeight: '500',
    },
    chevron: {
      marginHorizontal: 2,
      color: colors.textMuted,
    },
    breadcrumbButton: {
      paddingVertical: 4,
      paddingHorizontal: 4,
      borderRadius: 4,
    },
    breadcrumbText: {
      fontSize: 13,
      color: colors.textMuted,
    },
  });

  return (
    <View style={styles.container}>
      {/* Root breadcrumb (Items) */}
      <TouchableOpacity
        onPress={handleRootClick}
        style={styles.rootButton}
        activeOpacity={0.6}
      >
        <MaterialIcons name="home" size={14} color={colors.textMuted} />
        <Text style={styles.rootText}>{rootLabelText}</Text>
      </TouchableOpacity>

      {/* Folder breadcrumbs */}
      {breadcrumbs.map((crumb) => (
        <React.Fragment key={crumb.id}>
          <MaterialIcons
            name="chevron-right"
            size={14}
            style={styles.chevron}
          />
          <TouchableOpacity
            onPress={() => handleBreadcrumbClick(crumb.id)}
            style={styles.breadcrumbButton}
            activeOpacity={0.6}
          >
            <Text
              style={styles.breadcrumbText}
              numberOfLines={1}
              ellipsizeMode="middle"
            >
              {crumb.name}
            </Text>
          </TouchableOpacity>
        </React.Fragment>
      ))}
    </View>
  );
};

export default FolderBreadcrumb;
