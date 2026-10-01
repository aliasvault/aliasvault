import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
} from 'react-native';

import { scopedKey } from '@aliasvault/client/database/ItemRef';
import { buildFolderTree, flattenFolderTree, getFolderIdPath, isSharedFolder, type FolderTreeNode } from '@aliasvault/client/items/FolderUtils';
import { useColors } from '@/hooks/useColorScheme';
import { ModalWrapper } from '@/components/common/ModalWrapper';
import { FolderIcon } from '@/components/folders/FolderIcon';

import type { Folder, FolderRef } from '@aliasvault/client/database/repositories/FolderRepository';

/** Indent per folder level. */
const FOLDER_INDENT = 24;

interface IFolderSelectorModalProps {
  folders: Folder[];
  selectedFolder: FolderRef | null | undefined;
  personalManifestId: string | null;
  onFolderChange: (folder: FolderRef | null) => void;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * FolderSelectorModal component
 *
 * A modal for selecting folders with a hierarchical tree view.
 * Features expand/collapse, auto-expansion, and visual indicators.
 */
export const FolderSelectorModal: React.FC<IFolderSelectorModalProps> = ({
  folders,
  selectedFolder,
  personalManifestId,
  onFolderChange,
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const colors = useColors();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const selectedFolderId = selectedFolder?.Id ?? null;
  const selectedManifestId = selectedFolder?.ManifestId ?? null;

  /**
   * Toggle folder expand/collapse.
   */
  const toggleFolder = useCallback((folderKey: string): void => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderKey)) {
        next.delete(folderKey);
      } else {
        next.add(folderKey);
      }
      return next;
    });
  }, []);

  /**
   * Auto-expand folders when selected folder changes.
   */
  useEffect(() => {
    if (selectedFolderId && selectedManifestId && folders.length > 0) {
      const fullPath = getFolderIdPath({ Id: selectedFolderId, ManifestId: selectedManifestId }, folders);
      if (fullPath.length > 0) {
        // Expand all folders in the path including the selected folder
        setExpandedFolders(new Set(fullPath.map(id => scopedKey(selectedManifestId, id))));
      }
    } else {
      setExpandedFolders(new Set());
    }
  }, [selectedFolderId, selectedManifestId, folders]);

  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);
  const visibleFolders = useMemo(() => flattenFolderTree(folderTree, expandedFolders), [folderTree, expandedFolders]);

  /**
   * Handle folder selection.
   */
  const handleSelectFolder = useCallback((folder: FolderRef | null): void => {
    onFolderChange(folder);
    onClose();
  }, [onFolderChange, onClose]);

  const styles = StyleSheet.create({
    chevronContainer: {
      alignItems: 'center',
      alignSelf: 'stretch',
      justifyContent: 'center',
      width: FOLDER_INDENT,
    },
    closeButton: {
      padding: 4,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    folderOption: {
      alignItems: 'center',
      borderRadius: 8,
      flexDirection: 'row',
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    folderRow: {
      alignItems: 'center',
      borderRadius: 8,
      flexDirection: 'row',
    },
    folderRowButton: {
      alignItems: 'center',
      flex: 1,
      flexDirection: 'row',
      paddingLeft: 4,
      paddingRight: 12,
      paddingVertical: 12,
    },
    folderOptionActive: {
      backgroundColor: colors.tint + '15',
    },
    folderOptionText: {
      color: colors.text,
      flex: 1,
      fontSize: 16,
      marginLeft: 8,
    },
    folderOptionTextActive: {
      color: colors.tint,
      fontWeight: '600',
    },
    modalContainer: {
      paddingVertical: 16,
    },
    modalHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    modalTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
    },
    optionsList: {
      maxHeight: 400,
    },
  });

  /**
   * Render one visible folder row; each level indents by one chevron slot.
   */
  const renderFolderRow = (node: FolderTreeNode): React.ReactNode => {
    const nodeKey = scopedKey(node.ManifestId, node.Id);
    const isExpanded = expandedFolders.has(nodeKey);
    const hasChildren = node.children.length > 0;
    const isSelected = selectedFolderId === node.Id && selectedManifestId === node.ManifestId;

    return (
      <View key={nodeKey} style={[styles.folderRow, isSelected && styles.folderOptionActive, { paddingLeft: 4 + node.depth * FOLDER_INDENT }]}>
        {hasChildren ? (
          <TouchableOpacity
            onPress={() => toggleFolder(nodeKey)}
            style={styles.chevronContainer}
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 0 }}
            accessibilityState={{ expanded: isExpanded }}
          >
            <MaterialIcons
              name="chevron-right"
              size={20}
              color={colors.textMuted}
              style={{ transform: [{ rotate: isExpanded ? '90deg' : '0deg' }] }}
            />
          </TouchableOpacity>
        ) : (
          <View style={styles.chevronContainer} />
        )}

        <TouchableOpacity
          style={styles.folderRowButton}
          onPress={() => handleSelectFolder({ Id: node.Id, ManifestId: node.ManifestId })}
          activeOpacity={0.7}
        >
          <FolderIcon
            isShared={isSharedFolder(node, personalManifestId)}
            size={22}
            color={isSelected ? colors.tint : colors.textMuted}
          />
          <Text style={[styles.folderOptionText, isSelected && styles.folderOptionTextActive]} numberOfLines={1}>
            {node.Name}
          </Text>
          {isSelected && (
            <MaterialIcons name="check" size={20} color={colors.tint} />
          )}
        </TouchableOpacity>
      </View>
    );
  };

  const modalContent = (
    <View style={styles.modalContainer}>
      <View style={styles.modalHeader}>
        <Text style={styles.modalTitle}>{t('items.folders.selectFolder')}</Text>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={onClose}
        >
          <MaterialIcons name="close" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.optionsList}>
        {/* No folder option */}
        <TouchableOpacity
          style={[
            styles.folderOption,
            !selectedFolderId && styles.folderOptionActive,
          ]}
          onPress={() => handleSelectFolder(null)}
        >
          <MaterialIcons
            name="inbox"
            size={22}
            color={!selectedFolderId ? colors.tint : colors.textMuted}
            style={{ marginLeft: 8 }}
          />
          <Text
            style={[
              styles.folderOptionText,
              !selectedFolderId && styles.folderOptionTextActive,
            ]}
          >
            —
          </Text>
          {!selectedFolderId && (
            <MaterialIcons name="check" size={20} color={colors.tint} />
          )}
        </TouchableOpacity>

        {/* Folder tree, one row per visible folder */}
        {visibleFolders.map(renderFolderRow)}
      </ScrollView>
    </View>
  );

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onClose}
      showHeaderBorder={false}
      showFooterBorder={false}
    >
      {modalContent}
    </ModalWrapper>
  );
};

export default FolderSelectorModal;
