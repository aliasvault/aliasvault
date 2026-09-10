import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
} from 'react-native';

import type { FieldType, SystemFieldDefinition } from '@/utils/dist/core/models/vault';
import { FieldCategories } from '@/utils/dist/core/models/vault';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';
import { RobustPressable } from '@/components/ui/RobustPressable';

import { CustomFieldModal } from './CustomFieldModal';

/**
 * Configuration for an optional section (not field-based).
 */
export type OptionalSection = {
  /** Unique key for this section */
  key: string;
  /** Whether this section is currently visible */
  isVisible: boolean;
  /** Callback to add/show this section */
  onAdd: () => void;
};

/**
 * Callbacks for adding custom fields.
 */
type AddFieldMenuCallbacks = {
  /** Callback when a system field is added */
  onAddSystemField: (fieldKey: string) => void;
  /** Callback when a custom field is added */
  onAddCustomField: (label: string, fieldType: FieldType) => void;
};

type AddFieldMenuProps = {
  /**
   * Optional system fields for the current item type.
   * These are fields with ShowByDefault: false that can be added via the menu.
   */
  optionalSystemFields: SystemFieldDefinition[];
  /**
   * Field keys that are currently visible (either have a value or were manually added).
   */
  visibleFieldKeys: Set<string>;
  /**
   * Optional sections (like 2FA, Attachments) that are not field-based.
   */
  optionalSections: OptionalSection[];
  /**
   * Callbacks for adding fields.
   */
  callbacks: AddFieldMenuCallbacks;
};

/**
 * Menu option for internal use.
 */
type MenuOption = {
  key: string;
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  action: () => void;
};

/**
 * Get icon for a field category.
 */
const getFieldIcon = (category: string): keyof typeof MaterialIcons.glyphMap => {
  switch (category) {
    case FieldCategories.Notes:
      return 'description';
    case FieldCategories.Login:
      return 'vpn-key';
    case FieldCategories.Alias:
      return 'person';
    case FieldCategories.Card:
      return 'credit-card';
    default:
      return 'add';
  }
};

/**
 * Get icon for optional sections.
 */
const getSectionIcon = (key: string): keyof typeof MaterialIcons.glyphMap => {
  switch (key) {
    case '2fa':
      return 'lock';
    case 'attachments':
      return 'attach-file';
    default:
      return 'add';
  }
};

/**
 * A dropdown menu for adding optional fields and sections to an item.
 * Dynamically determines which options to show based on system field registry
 * and current field visibility.
 */
export const AddFieldMenu: React.FC<AddFieldMenuProps> = ({
  optionalSystemFields,
  visibleFieldKeys,
  optionalSections,
  callbacks,
}) => {
  const { t } = useTranslation();
  const colors = useColors();
  const [isOpen, setIsOpen] = useState(false);
  const [showCustomFieldModal, setShowCustomFieldModal] = useState(false);

  const styles = StyleSheet.create({
    addButton: {
      alignItems: 'center',
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderStyle: 'dashed',
      borderWidth: 2,
      flexDirection: 'row',
      justifyContent: 'center',
      paddingVertical: 12,
    },
    addButtonText: {
      color: colors.textMuted,
      fontSize: 14,
      fontWeight: '600',
      marginLeft: 8,
    },
    menuContainer: {
      backgroundColor: colors.background,
      borderColor: colors.accentBorder,
      borderRadius: 12,
      borderWidth: 1,
    },
    menuOption: {
      alignItems: 'center',
      borderBottomColor: colors.accentBorder,
      borderBottomWidth: 1,
      flexDirection: 'row',
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    menuOptionIcon: {
      marginRight: 12,
    },
    menuOptionText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '500',
    },
    modalOverlay: {
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      flex: 1,
      justifyContent: 'flex-end',
      paddingBottom: 40,
      paddingHorizontal: 20,
    },
  });

  /**
   * Handle adding a system field and closing menu.
   */
  const handleAddSystemField = useCallback((fieldKey: string): void => {
    callbacks.onAddSystemField(fieldKey);
    setIsOpen(false);
  }, [callbacks]);

  /**
   * Handle adding an optional section and closing menu.
   */
  const handleAddSection = useCallback((onAdd: () => void): void => {
    onAdd();
    setIsOpen(false);
  }, []);

  /**
   * Handle opening the custom field modal.
   */
  const handleOpenCustomFieldModal = useCallback((): void => {
    setShowCustomFieldModal(true);
    setIsOpen(false);
  }, []);

  /**
   * Build menu options based on optional system fields and sections.
   */
  const menuOptions = useMemo((): MenuOption[] => {
    const options: MenuOption[] = [];

    // Add optional system fields that are not currently visible
    optionalSystemFields.forEach(field => {
      if (!visibleFieldKeys.has(field.FieldKey)) {
        options.push({
          key: field.FieldKey,
          label: t(`fieldLabels.${field.FieldKey}`, { defaultValue: field.FieldKey }),
          icon: getFieldIcon(field.Category),
          action: (): void => handleAddSystemField(field.FieldKey),
        });
      }
    });

    // Add optional sections that are not currently visible
    optionalSections.forEach(section => {
      if (!section.isVisible) {
        options.push({
          key: section.key,
          label: t(`common.${section.key === '2fa' ? 'twoFactorAuthentication' : section.key}`),
          icon: getSectionIcon(section.key),
          action: (): void => handleAddSection(section.onAdd),
        });
      }
    });

    return options;
  }, [optionalSystemFields, visibleFieldKeys, optionalSections, t, handleAddSystemField, handleAddSection]);

  return (
    <>
      <RobustPressable
        style={styles.addButton}
        onPress={() => setIsOpen(true)}
      >
        <MaterialIcons name="add" size={24} color={colors.textMuted} />
        <ThemedText style={styles.addButtonText}>
          {t('itemTypes.addField')}
        </ThemedText>
      </RobustPressable>

      {/* Main Menu Modal - Action sheet style, slides from bottom */}
      <Modal
        visible={isOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsOpen(false)}
      >
        <TouchableWithoutFeedback onPress={() => setIsOpen(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.menuContainer}>
                {menuOptions.map((option, index) => (
                  <TouchableOpacity
                    key={option.key}
                    style={[
                      styles.menuOption,
                      index === menuOptions.length - 1 && menuOptions.length > 0 && { borderBottomWidth: 1 },
                    ]}
                    onPress={option.action}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons
                      name={option.icon}
                      size={24}
                      color={colors.textMuted}
                      style={styles.menuOptionIcon}
                    />
                    <ThemedText style={styles.menuOptionText}>{option.label}</ThemedText>
                  </TouchableOpacity>
                ))}
                {/* Custom field option - always available */}
                <TouchableOpacity
                  style={[styles.menuOption, { borderBottomWidth: 0 }]}
                  onPress={handleOpenCustomFieldModal}
                  activeOpacity={0.7}
                >
                  <MaterialIcons
                    name="add-circle-outline"
                    size={24}
                    color={colors.textMuted}
                    style={styles.menuOptionIcon}
                  />
                  <ThemedText style={styles.menuOptionText}>
                    {t('itemTypes.addCustomField')}
                  </ThemedText>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Custom Field Modal - Uses ModalWrapper for centered dialog */}
      <CustomFieldModal
        isOpen={showCustomFieldModal}
        onClose={() => setShowCustomFieldModal(false)}
        onSubmit={callbacks.onAddCustomField}
      />
    </>
  );
};
