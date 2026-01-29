import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, StyleSheet, Modal, TouchableWithoutFeedback, TouchableOpacity } from 'react-native';

import type { ItemType } from '@/utils/dist/core/models/vault';
import { ItemTypes } from '@/utils/dist/core/models/vault';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';
import { RobustPressable } from '@/components/ui/RobustPressable';

/**
 * Item type option configuration.
 */
type ItemTypeOption = {
  type: ItemType;
  titleKey: string;
  icon: keyof typeof MaterialIcons.glyphMap;
};

/**
 * Available item type options with icons.
 */
const ITEM_TYPE_OPTIONS: ItemTypeOption[] = [
  {
    type: ItemTypes.Login,
    titleKey: 'itemTypes.login.title',
    icon: 'vpn-key',
  },
  {
    type: ItemTypes.Alias,
    titleKey: 'itemTypes.alias.title',
    icon: 'person',
  },
  {
    type: ItemTypes.CreditCard,
    titleKey: 'itemTypes.creditCard.title',
    icon: 'credit-card',
  },
  {
    type: ItemTypes.Note,
    titleKey: 'itemTypes.note.title',
    icon: 'description',
  },
];

type ItemTypeSelectorProps = {
  selectedType: ItemType;
  isEditMode: boolean;
  onTypeChange: (type: ItemType) => void;
  onRegenerateAlias?: () => void;
};

/**
 * Item type selector component with dropdown menu.
 * Allows selecting between Login, Alias, CreditCard, and Note types.
 */
export const ItemTypeSelector: React.FC<ItemTypeSelectorProps> = ({
  selectedType,
  isEditMode,
  onTypeChange,
  onRegenerateAlias,
}) => {
  const { t } = useTranslation();
  const colors = useColors();
  const [showDropdown, setShowDropdown] = useState(false);

  const selectedTypeOption = ITEM_TYPE_OPTIONS.find(opt => opt.type === selectedType);

  const styles = StyleSheet.create({
    checkIcon: {
      marginLeft: 'auto',
    },
    container: {
      backgroundColor: colors.primary + '15',
      borderColor: colors.primary,
      borderRadius: 8,
      borderWidth: 1,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      marginBottom: 16,
    },
    dropdownContainer: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    dropdownIcon: {
      marginLeft: 8,
    },
    labelContainer: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    labelIcon: {
      marginRight: 8,
    },
    labelText: {
      color: colors.primary,
      fontWeight: '600',
      fontSize: 14,
    },
    modalContainer: {
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      flex: 1,
      justifyContent: 'center',
      padding: 20,
    },
    modalContent: {
      backgroundColor: colors.background,
      borderColor: colors.accentBorder,
      borderRadius: 12,
      borderWidth: 1,
    },
    optionButton: {
      alignItems: 'center',
      borderBottomColor: colors.accentBorder,
      borderBottomWidth: 1,
      flexDirection: 'row',
      paddingHorizontal: 16,
      paddingVertical: 16,
    },
    optionIcon: {
      marginRight: 12,
    },
    optionText: {
      color: colors.text,
      flex: 1,
      fontSize: 16,
      fontWeight: '500',
    },
    optionTextSelected: {
      color: colors.primary,
      fontWeight: '600',
    },
    regenerateButton: {
      backgroundColor: colors.primary + '20',
      borderRadius: 6,
      marginLeft: 8,
      padding: 8,
    },
  });

  return (
    <View style={styles.container}>
      <RobustPressable
        onPress={() => setShowDropdown(true)}
        style={styles.dropdownContainer}
      >
        <View style={styles.labelContainer}>
          {selectedTypeOption && (
            <MaterialIcons
              name={selectedTypeOption.icon}
              size={20}
              color={colors.primary}
              style={styles.labelIcon}
            />
          )}
          <ThemedText style={styles.labelText}>
            {isEditMode ? t('itemTypes.editing') : t('itemTypes.creating')}{' '}
            {selectedTypeOption ? t(selectedTypeOption.titleKey) : ''}
          </ThemedText>
        </View>
        <MaterialIcons
          name="keyboard-arrow-down"
          size={24}
          color={colors.primary}
          style={styles.dropdownIcon}
        />
      </RobustPressable>

      {/* Regenerate alias button - only for Alias type in create mode */}
      {selectedType === ItemTypes.Alias && !isEditMode && onRegenerateAlias && (
        <RobustPressable
          onPress={onRegenerateAlias}
          style={styles.regenerateButton}
        >
          <MaterialIcons name="refresh" size={20} color={colors.primary} />
        </RobustPressable>
      )}

      {/* Type Dropdown Modal */}
      <Modal
        visible={showDropdown}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDropdown(false)}
      >
        <TouchableWithoutFeedback onPress={() => setShowDropdown(false)}>
          <View style={styles.modalContainer}>
            <TouchableWithoutFeedback>
              <View style={styles.modalContent}>
                {ITEM_TYPE_OPTIONS.map((option, index) => (
                  <TouchableOpacity
                    key={option.type}
                    style={[
                      styles.optionButton,
                      index === ITEM_TYPE_OPTIONS.length - 1 && { borderBottomWidth: 0 },
                    ]}
                    onPress={() => {
                      onTypeChange(option.type);
                      setShowDropdown(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons
                      name={option.icon}
                      size={24}
                      color={selectedType === option.type ? colors.primary : colors.textMuted}
                      style={styles.optionIcon}
                    />
                    <ThemedText
                      style={[
                        styles.optionText,
                        selectedType === option.type && styles.optionTextSelected,
                      ]}
                    >
                      {t(option.titleKey)}
                    </ThemedText>
                    {selectedType === option.type && (
                      <MaterialIcons
                        name="check"
                        size={24}
                        color={colors.primary}
                        style={styles.checkIcon}
                      />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
};

export { ITEM_TYPE_OPTIONS };
export type { ItemTypeOption };
