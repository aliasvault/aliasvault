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

import { useColors } from '@/hooks/useColorScheme';
import { ModalWrapper } from '@/components/common/ModalWrapper';

type Folder = {
  Id: string;
  Name: string;
  ParentFolderId: string | null;
  Weight: number;
};

type FolderTreeNode = Folder & {
  children: FolderTreeNode[];
  depth: number;
  path: string[];
  indentedName: string;
};

interface IFolderSelectorModalProps {
  folders: Folder[];
  selectedFolderId: string | null | undefined;
  onFolderChange: (folderId: string | null) => void;
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
  selectedFolderId,
  onFolderChange,
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const colors = useColors();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  /**
   * Build a hierarchical tree from flat array of folders.
   */
  const buildFolderTree = useCallback((folders: Folder[]): FolderTreeNode[] => {
    const folderMap = new Map<string, FolderTreeNode>();

    // Initialize all folders as tree nodes
    folders.forEach(folder => {
      folderMap.set(folder.Id, {
        ...folder,
        children: [],
        depth: 0,
        path: [],
        indentedName: folder.Name,
      });
    });

    // Build the tree structure
    const rootFolders: FolderTreeNode[] = [];

    folders.forEach(folder => {
      const node = folderMap.get(folder.Id)!;

      if (!folder.ParentFolderId) {
        // Root folder
        node.depth = 0;
        node.path = [folder.Id];
        node.indentedName = folder.Name;
        rootFolders.push(node);
      } else {
        // Child folder
        const parent = folderMap.get(folder.ParentFolderId);
        if (parent) {
          node.depth = parent.depth + 1;
          node.path = [...parent.path, folder.Id];
          node.indentedName = '  '.repeat(node.depth) + folder.Name;
          parent.children.push(node);
        } else {
          // Parent not found - treat as root
          node.depth = 0;
          node.path = [folder.Id];
          node.indentedName = folder.Name;
          rootFolders.push(node);
        }
      }
    });

    // Sort folders by Weight and Name
    const sortFolders = (nodes: FolderTreeNode[]): void => {
      nodes.sort((a, b) => {
        if (a.Weight !== b.Weight) {
          return (a.Weight || 0) - (b.Weight || 0);
        }
        return a.Name.localeCompare(b.Name);
      });
      nodes.forEach(node => sortFolders(node.children));
    };

    sortFolders(rootFolders);
    return rootFolders;
  }, []);

  /**
   * Get folder ID path from root to specified folder.
   */
  const getFolderIdPath = useCallback((folderId: string, folders: Folder[]): string[] => {
    const path: string[] = [];
    let currentId: string | null = folderId;
    let iterations = 0;

    while (currentId && iterations < 5) {
      const folder = folders.find(f => f.Id === currentId);
      if (!folder) break;
      path.unshift(folder.Id);
      currentId = folder.ParentFolderId || null;
      iterations++;
    }

    return path;
  }, []);

  /**
   * Toggle folder expand/collapse.
   */
  const toggleFolder = useCallback((folderId: string): void => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  /**
   * Auto-expand folders when selected folder changes.
   */
  useEffect(() => {
    if (selectedFolderId && folders.length > 0) {
      const fullPath = getFolderIdPath(selectedFolderId, folders);
      if (fullPath.length > 0) {
        // Expand all folders in the path including the selected folder
        setExpandedFolders(new Set(fullPath));
      }
    } else {
      setExpandedFolders(new Set());
    }
  }, [selectedFolderId, folders, getFolderIdPath]);

  const folderTree = useMemo(() => buildFolderTree(folders), [folders, buildFolderTree]);

  /**
   * Handle folder selection.
   */
  const handleSelectFolder = useCallback((folderId: string | null): void => {
    onFolderChange(folderId);
    onClose();
  }, [onFolderChange, onClose]);

  const styles = StyleSheet.create({
    chevronButton: {
      padding: 4,
      marginLeft: 8,
      borderRadius: 4,
    },
    closeButton: {
      padding: 4,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    folderIcon: {
      marginLeft: 8,
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
    const isExpanded = expandedFolders.has(node.Id);
    const hasChildren = node.children.length > 0;
    const isSelected = selectedFolderId === node.Id;

    return (
      <View key={node.Id}>
        <TouchableOpacity
          style={[
            styles.folderOption,
            isSelected && styles.folderOptionActive,
          ]}
          onPress={() => handleSelectFolder(node.Id)}
          activeOpacity={0.7}
        >
          {/* Indentation */}
          <View style={{ width: depth * 20 }} />

          {/* Expand/collapse chevron */}
          {hasChildren ? (
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                toggleFolder(node.Id);
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
            <View style={{ width: 18, marginLeft: 8 }} />
          )}

          {/* Folder icon */}
          <MaterialIcons
            name="folder"
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
  }, [expandedFolders, selectedFolderId, handleSelectFolder, toggleFolder, colors, styles]);

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
