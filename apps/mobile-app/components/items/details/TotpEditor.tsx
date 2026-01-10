import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as OTPAuth from 'otpauth';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, StyleSheet, Alert, TextInput, Modal, TouchableOpacity, ScrollView } from 'react-native';

import type { TotpCode } from '@/utils/dist/core/models/vault';

import { useColors, useColorScheme } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { Ionicons } from '@expo/vector-icons';

type TotpFormData = {
  name: string;
  secretKey: string;
}

type TotpEditorProps = {
  totpCodes: TotpCode[];
  onTotpCodesChange: (totpCodes: TotpCode[]) => void;
  originalTotpCodeIds: string[];
}

/**
 * Component for editing TOTP codes for a credential.
 */
export const TotpEditor: React.FC<TotpEditorProps> = ({
  totpCodes,
  onTotpCodesChange,
  originalTotpCodeIds
}) => {
  const { t } = useTranslation();
  const colors = useColors();
  const colorScheme = useColorScheme();
  const [isAddFormVisible, setIsAddFormVisible] = useState(false);
  const [formData, setFormData] = useState<TotpFormData>({ name: '', secretKey: '' });
  const [formError, setFormError] = useState<string | null>(null);

  /**
   * Sanitizes the secret key by extracting it from a TOTP URI if needed
   */
  const sanitizeSecretKey = (secretKeyInput: string, nameInput: string): { secretKey: string, name: string } => {
    let secretKey = secretKeyInput.trim();
    let name = nameInput.trim();

    // Check if it's a TOTP URI
    if (secretKey.toLowerCase().startsWith('otpauth://totp/')) {
      try {
        const uri = OTPAuth.URI.parse(secretKey);
        if (uri instanceof OTPAuth.TOTP) {
          secretKey = uri.secret.base32;
          // If name is empty, use the label from the URI
          if (!name && uri.label) {
            name = uri.label;
          }
        }
      } catch {
        throw new Error(t('totp.errors.invalidSecretKey'));
      }
    }

    // Remove spaces from the secret key
    secretKey = secretKey.replace(/\s/g, '');

    // Validate the secret key format (base32)
    if (!/^[A-Z2-7]+=*$/i.test(secretKey)) {
      throw new Error(t('totp.errors.invalidSecretKey'));
    }

    return { secretKey, name: name || 'Authenticator' };
  };

  /**
   * Shows the add form
   */
  const showAddForm = (): void => {
    setFormData({ name: '', secretKey: '' });
    setFormError(null);
    setIsAddFormVisible(true);
  };

  /**
   * Hides the add form
   */
  const hideAddForm = (): void => {
    setIsAddFormVisible(false);
    setFormData({ name: '', secretKey: '' });
    setFormError(null);
  };

  /**
   * Handles adding a new TOTP code
   */
  const handleAddTotpCode = (): void => {
    setFormError(null);

    // Validate required fields
    if (!formData.secretKey) {
      setFormError(t('validation.required'));
      return;
    }

    try {
      // Sanitize the secret key
      const { secretKey, name } = sanitizeSecretKey(formData.secretKey, formData.name);

      // Create new TOTP code
      const newTotpCode: TotpCode = {
        Id: crypto.randomUUID().toUpperCase(),
        Name: name,
        SecretKey: secretKey,
        ItemId: '' // Will be set when saving the item
      };

      // Add to the list
      const updatedTotpCodes = [...totpCodes, newTotpCode];
      onTotpCodesChange(updatedTotpCodes);

      // Hide the form
      hideAddForm();
    } catch (error) {
      if (error instanceof Error) {
        setFormError(error.message);
      } else {
        setFormError(t('common.errors.unknownErrorTryAgain'));
      }
    }
  };

  /**
   * Initiates the delete process for a TOTP code
   */
  const initiateTotpDelete = (totpCode: TotpCode): void => {
    Alert.alert(
      t('common.deleteItemConfirmTitle'),
      t('common.deleteItemConfirmDescription'),
      [
        {
          text: t('common.cancel'),
          style: 'cancel'
        },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => confirmDeleteTotpCode(totpCode)
        }
      ]
    );
  };

  /**
   * Confirms deletion of a TOTP code
   */
  const confirmDeleteTotpCode = (totpCode: TotpCode): void => {
    // Check if this TOTP code was part of the original set
    const wasOriginal = originalTotpCodeIds.includes(totpCode.Id);

    let updatedTotpCodes: TotpCode[];
    if (wasOriginal) {
      // Mark as deleted (soft delete for syncing)
      updatedTotpCodes = totpCodes.map(tc =>
        tc.Id === totpCode.Id
          ? { ...tc, IsDeleted: true }
          : tc
      );
    } else {
      // Hard delete (remove from array)
      updatedTotpCodes = totpCodes.filter(tc => tc.Id !== totpCode.Id);
    }

    onTotpCodesChange(updatedTotpCodes);
  };

  // Filter out deleted TOTP codes for display
  const activeTotpCodes = totpCodes.filter(tc => !tc.IsDeleted);
  const hasActiveTotpCodes = activeTotpCodes.length > 0;

  const styles = StyleSheet.create({
    addButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 8,
      height: 35,
      justifyContent: 'center',
      marginTop: 8,
      width: '100%',
    },
    addButtonCompact: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 8,
      height: 35,
      justifyContent: 'center',
      width: 35,
    },
    addButtonText: {
      color: colors.primarySurfaceText,
      fontSize: 16,
      fontWeight: '600',
    },
    codeItem: {
      alignItems: 'center',
      backgroundColor: colors.background,
      borderRadius: 8,
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 8,
      padding: 12,
    },
    codeName: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    deleteButton: {
      padding: 4,
    },
    errorText: {
      color: colors.errorText,
      fontSize: 12,
      marginTop: 4,
    },
    header: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    helperText: {
      color: colors.textMuted,
      fontSize: 12,
      marginTop: 4,
    },
    input: {
      backgroundColor: colors.background,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      color: colors.text,
      fontSize: 14,
      marginTop: 8,
      padding: 12,
    },
    inputError: {
      borderColor: colors.errorBorder,
    },
    label: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
      marginTop: 12,
    },
    modalButtons: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 24,
    },
    modalCancelButton: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderRadius: 8,
      flex: 1,
      padding: 14,
    },
    modalCancelButtonText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
    },
    modalCloseButton: {
      padding: 4,
    },
    modalBackdrop: {
      flex: 1,
    },
    modalContainer: {
      backgroundColor: colorScheme === 'dark' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.5)',
      flex: 1,
      justifyContent: 'flex-end',
    },
    modalContent: {
      backgroundColor: colors.accentBackground,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      maxHeight: '90%',
      paddingTop: 20,
      paddingHorizontal: 20,
      paddingBottom: 20,
    },
    modalHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    modalSaveButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 8,
      flex: 1,
      padding: 14,
    },
    modalSaveButtonText: {
      color: colors.primarySurfaceText,
      fontSize: 16,
      fontWeight: '600',
    },
    modalTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '700',
    },
    saveToViewText: {
      color: colors.textMuted,
      fontSize: 12,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
    },
  });

  return (
    <View>
      <View style={styles.header}>
        {hasActiveTotpCodes && (
          <TouchableOpacity
            style={styles.addButtonCompact}
            onPress={showAddForm}
          >
          <Ionicons name="add" size={24} color={colors.background} />
        </TouchableOpacity>
        )}
      </View>

      {!hasActiveTotpCodes && (
        <TouchableOpacity
          style={styles.addButton}
          onPress={showAddForm}
        >
          <Ionicons name="add" size={24} color={colors.background} />
        </TouchableOpacity>
      )}

      {hasActiveTotpCodes && (
        <View>
          {activeTotpCodes.map(totpCode => (
            <View key={totpCode.Id} style={styles.codeItem}>
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.codeName}>
                  {totpCode.Name}
                </ThemedText>
                <ThemedText style={styles.saveToViewText}>
                  {t('totp.saveToViewCode')}
                </ThemedText>
              </View>
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => initiateTotpDelete(totpCode)}
              >
                <Ionicons name="trash" size={20} color={colors.errorText} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* Add TOTP Modal */}
      <Modal
        visible={isAddFormVisible}
        transparent
        animationType="fade"
        onRequestClose={hideAddForm}
      >
        <View style={styles.modalContainer}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={hideAddForm}
          />
          <View style={styles.modalContent}>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.modalHeader}>
                  <ThemedText style={styles.modalTitle}>
                    {t('totp.addCode')}
                  </ThemedText>
                  <TouchableOpacity
                    style={styles.modalCloseButton}
                    onPress={hideAddForm}
                  >
                    <MaterialIcons name="close" size={24} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>

                <ThemedText style={styles.helperText}>
                  {t('totp.instructions')}
                </ThemedText>

                <ThemedText style={styles.label}>
                  {t('totp.nameOptional')}
                </ThemedText>
                <TextInput
                  style={styles.input}
                  placeholder={t('totp.nameOptional')}
                  placeholderTextColor={colors.textMuted}
                  value={formData.name}
                  onChangeText={(text) => setFormData({ ...formData, name: text })}
                  autoCapitalize="words"
                />

                <ThemedText style={styles.label}>
                  {t('totp.secretKey')}
                </ThemedText>
                <TextInput
                  style={[styles.input, formError && styles.inputError]}
                  placeholderTextColor={colors.textMuted}
                  value={formData.secretKey}
                  onChangeText={(text) => setFormData({ ...formData, secretKey: text })}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  multiline
                />

                {formError && (
                  <ThemedText style={styles.errorText}>
                    {formError}
                  </ThemedText>
                )}

                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={styles.modalCancelButton}
                    onPress={hideAddForm}
                  >
                    <ThemedText style={styles.modalCancelButtonText}>
                      {t('common.cancel')}
                    </ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.modalSaveButton}
                    onPress={handleAddTotpCode}
                  >
                    <ThemedText style={styles.modalSaveButtonText}>
                      {t('common.save')}
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
        </View>
      </Modal>
    </View>
  );
};
