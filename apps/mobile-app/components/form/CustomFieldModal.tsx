import React, { useCallback, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View,
  StyleSheet,
  TextInput,
  ScrollView,
  TouchableOpacity,
} from 'react-native';

import type { FieldType } from '@/utils/dist/core/models/vault';
import { FieldTypes } from '@/utils/dist/core/models/vault';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';
import { ModalWrapper } from '@/components/common/ModalWrapper';

/**
 * Available field types for custom fields.
 */
const FIELD_TYPE_OPTIONS: { value: FieldType; labelKey: string }[] = [
  { value: FieldTypes.Text, labelKey: 'itemTypes.fieldTypes.text' },
  { value: FieldTypes.Password, labelKey: 'itemTypes.fieldTypes.password' },
  { value: FieldTypes.Hidden, labelKey: 'itemTypes.fieldTypes.hidden' },
  { value: FieldTypes.TextArea, labelKey: 'itemTypes.fieldTypes.textArea' },
  { value: FieldTypes.URL, labelKey: 'itemTypes.fieldTypes.url' },
  { value: FieldTypes.Email, labelKey: 'itemTypes.fieldTypes.email' },
  { value: FieldTypes.Phone, labelKey: 'itemTypes.fieldTypes.phone' },
  { value: FieldTypes.Number, labelKey: 'itemTypes.fieldTypes.number' },
  { value: FieldTypes.Date, labelKey: 'itemTypes.fieldTypes.date' },
];

type CustomFieldModalProps = {
  isOpen: boolean;
  /** Existing field values when editing, omitted when adding a new field */
  initialValues?: { label: string; fieldType: FieldType };
  onClose: () => void;
  onSubmit: (label: string, fieldType: FieldType) => void;
};

/**
 * Modal for creating and editing a custom field. Both the label and the field
 * type can be changed, so an existing field is edited through the same form
 * that created it.
 */
export const CustomFieldModal: React.FC<CustomFieldModalProps> = ({
  isOpen,
  initialValues,
  onClose,
  onSubmit,
}) => {
  const { t } = useTranslation();
  const colors = useColors();
  const isEditMode = initialValues !== undefined;
  const [label, setLabel] = useState('');
  const [fieldType, setFieldType] = useState<FieldType>(FieldTypes.Text);

  /**
   * Reset the form to the field being edited (or to defaults) whenever the modal opens.
   */
  useLayoutEffect(() => {
    if (isOpen) {
      setLabel(initialValues?.label ?? '');
      setFieldType(initialValues?.fieldType ?? FieldTypes.Text);
    }
  }, [isOpen, initialValues]);

  /**
   * Submit the form and close the modal.
   */
  const handleSubmit = useCallback((): void => {
    if (!label.trim()) {
      return;
    }

    onSubmit(label.trim(), fieldType);
    onClose();
  }, [label, fieldType, onSubmit, onClose]);

  const styles = StyleSheet.create({
    buttons: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 16,
    },
    button: {
      alignItems: 'center',
      borderRadius: 8,
      flex: 1,
      paddingVertical: 12,
    },
    buttonPrimary: {
      backgroundColor: colors.primary,
    },
    buttonSecondary: {
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderWidth: 1,
    },
    buttonText: {
      fontWeight: '600',
    },
    buttonTextPrimary: {
      color: colors.primarySurfaceText,
    },
    buttonTextSecondary: {
      color: colors.text,
    },
    input: {
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      color: colors.text,
      fontSize: 16,
      marginBottom: 16,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    inputLabel: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 8,
    },
    fieldTypeChip: {
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 16,
      borderWidth: 1,
      marginRight: 8,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    fieldTypeChipSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    fieldTypeChipText: {
      color: colors.text,
      fontSize: 14,
    },
    fieldTypeChipTextSelected: {
      color: colors.primarySurfaceText,
    },
    fieldTypeContainer: {
      flexDirection: 'row',
      paddingBottom: 16,
    },
    fieldTypeScrollView: {
      marginBottom: 0,
    },
  });

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? t('itemTypes.editCustomField') : t('itemTypes.addCustomField')}
      keyboardAvoiding
      showHeaderBorder={false}
      showFooterBorder={false}
    >
      <ThemedText style={styles.inputLabel}>
        {t('itemTypes.fieldLabel')}
      </ThemedText>
      <TextInput
        style={styles.input}
        value={label}
        onChangeText={setLabel}
        onSubmitEditing={handleSubmit}
        placeholder={t('itemTypes.enterFieldName')}
        placeholderTextColor={colors.textMuted}
        returnKeyType="done"
        autoFocus={!isEditMode}
      />

      <ThemedText style={styles.inputLabel}>
        {t('itemTypes.fieldType')}
      </ThemedText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.fieldTypeScrollView}
        contentContainerStyle={styles.fieldTypeContainer}
      >
        {FIELD_TYPE_OPTIONS.map(option => (
          <TouchableOpacity
            key={option.value}
            style={[
              styles.fieldTypeChip,
              fieldType === option.value && styles.fieldTypeChipSelected,
            ]}
            onPress={() => setFieldType(option.value)}
            activeOpacity={0.7}
          >
            <ThemedText
              style={[
                styles.fieldTypeChipText,
                fieldType === option.value && styles.fieldTypeChipTextSelected,
              ]}
            >
              {t(option.labelKey)}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.button, styles.buttonSecondary]}
          onPress={onClose}
          activeOpacity={0.7}
        >
          <ThemedText style={[styles.buttonText, styles.buttonTextSecondary]}>
            {t('common.cancel')}
          </ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.button,
            styles.buttonPrimary,
            !label.trim() && { opacity: 0.5 },
          ]}
          onPress={handleSubmit}
          disabled={!label.trim()}
          activeOpacity={0.7}
        >
          <ThemedText style={[styles.buttonText, styles.buttonTextPrimary]}>
            {isEditMode ? t('common.save') : t('common.add')}
          </ThemedText>
        </TouchableOpacity>
      </View>
    </ModalWrapper>
  );
};
