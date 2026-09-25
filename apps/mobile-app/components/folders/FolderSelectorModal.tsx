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
import { buildFolderTree, getFolderIdPath, isSharedFolder, type FolderTreeNode } from '@aliasvault/client/items/FolderUtils';
import { useColors } from '@/hooks/useColorScheme';
import { ModalWrapper } from '@/components/common/ModalWrapper';
import { FolderIcon } from '@/components/folders/FolderIcon';

import type { Folder, FolderRef } from '@aliasvault/client/database/repositories/FolderRepository';

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

  /**
   * Handle folder selection.
   */
  const handleSelectFolder = useCallback((folder: FolderRef | null): void => {
    onFolderChange(folder);
    onClose();
  }, [onFolderChange, onClose]);

  const styles = StyleSheet.create({
    chevronButton: {
      padding: 4,
      borderRadius: 4,
    },
    chevronContainer: {
      width: 26,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeButton: {
      padding: 4,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    folderIcon: {
      marginLeft: 4,
    },
    folderOption: {
      alignItems: 'center',
      borderRadius: 8,
      flexDirection: 'row',
      paddingHorizontal: 12,
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
   * Recursively render folder tree node.
   */
  const renderFolderNode = useCallback((node: FolderTreeNode, depth: number = 0): React.ReactNode => {
    const nodeKey = scopedKey(node.ManifestId, node.Id);
    const isExpanded = expandedFolders.has(nodeKey);
    const hasChildren = node.children.length > 0;
    const isSelected = selectedFolderId === node.Id && selectedManifestId === node.ManifestId;

    return (
      <View key={nodeKey}>
        <TouchableOpacity
          style={[
            styles.folderOption,
            isSelected && styles.folderOptionActive,
          ]}
          onPress={() => handleSelectFolder({ Id: node.Id, ManifestId: node.ManifestId })}
          activeOpacity={0.7}
        >
          {/* Indentation */}
          <View style={{ width: depth * 20 }} />

          {/* Expand/collapse chevron - fixed width container */}
          <View style={styles.chevronContainer}>
            {hasChildren ? (
              <TouchableOpacity
                onPress={(e) => {
                  e.stopPropagation();
                  toggleFolder(nodeKey);
                }}
                style={styles.chevronButton}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <MaterialIcons
                  name="chevron-right"
                  size={18}
                  color={colors.textMuted}
                  style={{
                    transform: [{ rotate: isExpanded ? '90deg' : '0deg' }],
                  }}
                />
              </TouchableOpacity>
            ) : (
              <View style={{ width: 18 }} />
            )}
          </View>

          {/* Folder icon */}
          <FolderIcon
            isShared={isSharedFolder(node, personalManifestId)}
            size={22}
            color={isSelected ? colors.tint : colors.textMuted}
            style={styles.folderIcon}
          />

          {/* Folder name */}
          <Text
            style={[
              styles.folderOptionText,
              isSelected && styles.folderOptionTextActive,
            ]}
            numberOfLines={1}
          >
            {node.Name}
          </Text>

          {/* Checkmark for selected folder */}
          {isSelected && (
            <MaterialIcons name="check" size={20} color={colors.tint} />
          )}
        </TouchableOpacity>

        {/* Render children if expanded */}
        {isExpanded && hasChildren && (
          <>
            {node.children.map(child => renderFolderNode(child, depth + 1))}
          </>
        )}
      </View>
    );
  }, [expandedFolders, selectedFolderId, selectedManifestId, personalManifestId, handleSelectFolder, toggleFolder, colors, styles]);

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

        {/* Folder tree (recursive rendering) */}
        {folderTree.map(node => renderFolderNode(node, 0))}
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
