import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import type { Folder } from '@/utils/db/repositories/FolderRepository';
import { useColors } from '@/hooks/useColorScheme';
import { useDb } from '@/context/DbContext';

type Breadcrumb = {
  name: string;
  id: string;
};

type FolderBreadcrumbProps = {
  /**
   * The ID of the current folder to show breadcrumbs for.
   * If null/undefined, no breadcrumbs are shown.
   */
  folderId: string | null | undefined;
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
};

/**
 * Get the full path of folder names from root to the specified folder.
 * @param folderId - The folder ID
 * @param folders - Flat array of all folders
 * @returns Array of folder names from root to current folder, or empty array if not found
 */
function getFolderPath(folderId: string | null, folders: Folder[]): string[] {
  if (!folderId) {
    return [];
  }

  const path: string[] = [];
  let currentId: string | null = folderId;
  let iterations = 0;

  // Build path by traversing up to root
  while (currentId && iterations < 5) {
    const folder = folders.find(f => f.Id === currentId);
    if (!folder) {
      break;
    }
    path.unshift(folder.Name); // Add to beginning of array
    currentId = folder.ParentFolderId;
    iterations++;
  }

  return path;
}

/**
 * Get the full path of folder IDs from root to the specified folder.
 * @param folderId - The folder ID
 * @param folders - Flat array of all folders
 * @returns Array of folder IDs from root to current folder, or empty array if not found
 */
function getFolderIdPath(folderId: string | null, folders: Folder[]): string[] {
  if (!folderId) {
    return [];
  }

  const path: string[] = [];
  let currentId: string | null = folderId;
  let iterations = 0;

  // Build path by traversing up to root
  while (currentId && iterations < 5) {
    const folder = folders.find(f => f.Id === currentId);
    if (!folder) {
      break;
    }
    path.unshift(folder.Id); // Add to beginning of array
    currentId = folder.ParentFolderId;
    iterations++;
  }

  return path;
}

/**
 * Displays a breadcrumb navigation trail for folder hierarchy.
 * Shows the path to the current location, with optional exclusion of current folder.
 * Example: "Items > Work > Projects > Client A"
 */
export const FolderBreadcrumb: React.FC<FolderBreadcrumbProps> = ({
  folderId,
  rootLabel,
  excludeCurrentFolder = false,
}) => {
  const { t } = useTranslation();
  const router = useRouter();
  const dbContext = useDb();
  const colors = useColors();
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);

  /**
   * Load breadcrumb trail based on current folder.
   * Optionally excludes the current folder (to avoid duplication with page title).
   */
  useEffect(() => {
    const loadBreadcrumbs = async () => {
      if (!folderId || !dbContext?.sqliteClient) {
        setBreadcrumbs([]);
        return;
      }

      try {
        const allFolders = await dbContext.sqliteClient.folders.getAll();
        const folderNames = getFolderPath(folderId, allFolders);
        const folderIds = getFolderIdPath(folderId, allFolders);

        let fullPath = folderNames.map((name, index) => ({name, id: folderIds[index]}));

        // If requested, exclude the current folder from breadcrumbs
        if (excludeCurrentFolder && fullPath.length > 0) {
          fullPath = fullPath.slice(0, -1); // Remove last item (current folder)
        }

        setBreadcrumbs(fullPath);
      } catch (error) {
        console.error('[FolderBreadcrumb] Error building breadcrumbs:', error);
        setBreadcrumbs([]);
      }
    };

    loadBreadcrumbs();
  }, [folderId, dbContext?.sqliteClient, excludeCurrentFolder]);

  /**
   * Handle breadcrumb navigation.
   */
  const handleBreadcrumbClick = useCallback((folderId: string) => {
    router.push(`/(tabs)/items/folder/${folderId}`);
  }, [router]);

  /**
   * Handle root breadcrumb click (navigate to items list).
   */
  const handleRootClick = useCallback(() => {
    router.push('/(tabs)/items');
  }, [router]);

  /*
   * Don't render anything if:
   * 1. No folderId provided (item is at root level) - saves UI space
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
