import { Ionicons } from '@expo/vector-icons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, StyleSheet, TextInput, Modal, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { useDialog } from '@/context/DialogContext';
import { useColors } from '@/hooks/useColorScheme';
import NativeVaultManager from '@/specs/NativeVaultManager';
import type { TotpCode } from '@/utils/dist/core/models/vault';
import { parseOtpAuthUri } from '@/utils/TotpUtility';

type TotpFormData = {
  name: string;
  secretKey: string;
}

type TotpEditorProps = {
  totpCodes: TotpCode[];
  onTotpCodesChange: (totpCodes: TotpCode[]) => void;
  originalTotpCodeIds: string[];
  /** Called when the add button in the header is pressed */
  onAddPress?: () => void;
  /** Ref callback to expose the showAddForm function to parent */
  showAddFormRef?: React.MutableRefObject<(() => void) | null>;
  /** Item display name for QR code generation (issuer) */
  itemDisplayName?: string;
  /** Item username/email for QR code generation (account name) */
  itemUsername?: string;
}

/**
 * Component for editing TOTP codes for a credential.
 */
export const TotpEditor: React.FC<TotpEditorProps> = ({
  totpCodes,
  onTotpCodesChange,
  originalTotpCodeIds,
  showAddFormRef,
  itemDisplayName,
  itemUsername
}) => {
  const { t } = useTranslation();
  const colors = useColors();
  const { showConfirm, showAlert } = useDialog();
  const [isAddChoiceModalVisible, setIsAddChoiceModalVisible] = useState(false);
  const [isAddFormVisible, setIsAddFormVisible] = useState(false);
  const [formData, setFormData] = useState<TotpFormData>({ name: '', secretKey: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [showNameField, setShowNameField] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingTotpCode, setEditingTotpCode] = useState<TotpCode | null>(null);
  const [editName, setEditName] = useState('');
  const [showEditNameField, setShowEditNameField] = useState(false);
  const [editSecret, setEditSecret] = useState('');
  const [showQrCode, setShowQrCode] = useState(false);
  const hasLaunchedScanner = React.useRef(false);

  /**
   * Shows the add choice modal (scan QR code or enter manually)
   */
  const showAddChoiceModal = (): void => {
    setIsAddChoiceModalVisible(true);
  };

  /**
   * Hides the add choice modal
   */
  const hideAddChoiceModal = (): void => {
    setIsAddChoiceModalVisible(false);
  };

  /**
   * Shows the manual entry form
   */
  const showManualEntryForm = (): void => {
    hideAddChoiceModal();
    setFormData({ name: '', secretKey: '' });
    setFormError(null);
    setShowNameField(false);
    setIsAddFormVisible(true);
  };

  /**
   * Launches the QR code scanner for TOTP
   */
  const launchQRScanner = React.useCallback(async (): Promise<void> => {
    // Prevent multiple scanner launches
    if (hasLaunchedScanner.current) {
      return;
    }

    hasLaunchedScanner.current = true;

    // Hide modal and wait for animation to complete
    hideAddChoiceModal();

    // Wait for modal dismiss animation to complete
    await new Promise(resolve => setTimeout(resolve, 350));

    try {
      // Scan QR code with otpauth:// prefix filter
      const scannedData = await NativeVaultManager.scanQRCode(['otpauth://'], t('totp.scanQrCode'));

      if (scannedData) {
        // Parse the otpauth:// URL
        const parsed = parseOtpAuthUri(scannedData);
        if (parsed && parsed.type === 'totp') {
          const secretKey = parsed.secret.replace(/\s/g, '').replace(/=+$/, '');
          const name = parsed.label || '';

          const newTotpCode: TotpCode = {
            Id: crypto.randomUUID().toUpperCase(),
            Name: name,
            SecretKey: secretKey,
            ItemId: '' // Will be set when saving the item
          };

          const updatedTotpCodes = [...totpCodes, newTotpCode];
          onTotpCodesChange(updatedTotpCodes);
        } else {
          showAlert(t('common.error'), t('totp.errors.scanFailed'));
        }
      }
      // If scannedData is null, user cancelled - just close without error
    } catch (error) {
      console.error('QR scan error:', error);
      showAlert(t('common.error'), t('totp.errors.scanFailed'));
    } finally {
      // Reset the ref to allow future scans
      hasLaunchedScanner.current = false;
    }
  }, [totpCodes, onTotpCodesChange, t, showAlert]);

  // Expose showAddChoiceModal to parent via ref
  React.useEffect(() => {
    if (showAddFormRef) {
      showAddFormRef.current = showAddChoiceModal;
    }
    return () => {
      if (showAddFormRef) {
        showAddFormRef.current = null;
      }
    };
  }, [showAddFormRef]);

  /**
   * Sanitizes the secret key by extracting it from a TOTP URI if needed
   */
  const sanitizeSecretKey = (secretKeyInput: string, nameInput: string): { secretKey: string, name: string } => {
    let secretKey = secretKeyInput.trim();
    let name = nameInput.trim();

    // Check if it's a TOTP URI
    if (secretKey.toLowerCase().startsWith('otpauth://totp/')) {
      const parsed = parseOtpAuthUri(secretKey);
      if (!parsed || parsed.type !== 'totp') {
        throw new Error(t('totp.errors.invalidSecretKey'));
      }
      secretKey = parsed.secret;
      // If name is empty, use the label from the URI
      if (!name && parsed.label) {
        name = parsed.label;
      }
    }

    // Remove spaces from the secret key
    secretKey = secretKey.replace(/\s/g, '');

    // Validate the secret key format (base32)
    if (!/^[A-Z2-7]+=*$/i.test(secretKey)) {
      throw new Error(t('totp.errors.invalidSecretKey'));
    }

    // Name is optional; keep it blank when none was provided or derived.
    return { secretKey, name };
  };

  /**
   * Hides the add form
   */
  const hideAddForm = (): void => {
    setIsAddFormVisible(false);
    setFormData({ name: '', secretKey: '' });
    setFormError(null);
    setShowNameField(false);
  };

  /**
   * Hides the optional name field again and clears any entered value
   */
  const hideNameField = (): void => {
    setFormData({ ...formData, name: '' });
    setShowNameField(false);
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
    showConfirm(
      t('common.deleteItemConfirmTitle'),
      t('common.deleteItemConfirmDescription'),
      t('common.delete'),
      () => confirmDeleteTotpCode(totpCode),
      { confirmStyle: 'destructive' }
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

  /**
   * Shows the edit modal for a TOTP code
   */
  const showEditModal = (totpCode: TotpCode): void => {
    setEditingTotpCode(totpCode);
    // Only reveal the name field when a name was actually set.
    setEditName(totpCode.Name);
    setShowEditNameField(!!totpCode.Name);
    setEditSecret(totpCode.SecretKey);
    setShowQrCode(false);
    setIsEditModalOpen(true);
  };

  /**
   * Closes the edit modal
   */
  const closeEditModal = (): void => {
    setIsEditModalOpen(false);
    setEditingTotpCode(null);
    setEditName('');
    setShowEditNameField(false);
    setEditSecret('');
    setShowQrCode(false);
  };

  /**
   * Hides the edit name field again and clears any entered value so the code
   * falls back to the default name on save.
   */
  const hideEditNameField = (): void => {
    setEditName('');
    setShowEditNameField(false);
  };

  /**
   * Saves the edited TOTP code
   */
  const saveEditedTotpCode = (): void => {
    if (!editingTotpCode) {
      return;
    }

    // The name is optional; store it as-is (blank when the user left it empty).
    const finalName = editName.trim();

    const updatedTotpCodes = totpCodes.map(tc =>
      tc.Id === editingTotpCode.Id
        ? { ...tc, Name: finalName, SecretKey: editSecret }
        : tc
    );

    onTotpCodesChange(updatedTotpCodes);
    closeEditModal();
  };

  /**
   * Toggles the QR code visibility in the edit modal
   */
  const toggleQrCode = (): void => {
    setShowQrCode(!showQrCode);
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
    actionButtons: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
    },
    deleteButton: {
      padding: 4,
    },
    editButton: {
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
    addNameLink: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '600',
      marginTop: 16,
    },
    nameLabelRow: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    removeNameButton: {
      marginTop: 12,
      padding: 4,
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
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
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
    qrCodeContainer: {
      alignItems: 'center',
      backgroundColor: 'white',
      borderRadius: 8,
      marginTop: 16,
      marginBottom: 16,
      padding: 16,
      alignSelf: 'center',
    },
    choiceButton: {
      alignItems: 'center',
      backgroundColor: colors.background,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 12,
      justifyContent: 'center',
      marginTop: 12,
      padding: 16,
    },
    choiceButtonText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
    },
    dividerContainer: {
      alignItems: 'center',
      flexDirection: 'row',
      marginTop: 20,
      marginBottom: 8,
    },
    dividerLine: {
      backgroundColor: colors.accentBorder,
      flex: 1,
      height: 1,
    },
    dividerText: {
      color: colors.textMuted,
      fontSize: 14,
      marginHorizontal: 12,
    },
  });

  return (
    <View>
      {/* Show inline add button only if parent is not handling it via showAddFormRef */}
      {!showAddFormRef && !hasActiveTotpCodes && (
        <TouchableOpacity
          style={styles.addButton}
          onPress={showAddChoiceModal}
        >
          <Ionicons name="add" size={24} color={colors.background} />
        </TouchableOpacity>
      )}

      {!showAddFormRef && hasActiveTotpCodes && (
        <TouchableOpacity
          style={styles.addButtonCompact}
          onPress={showAddChoiceModal}
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
                  {totpCode.Name || t('totp.defaultName')}
                </ThemedText>
                <ThemedText style={styles.saveToViewText}>
                  {t('totp.saveToViewCode')}
                </ThemedText>
              </View>
              <View style={styles.actionButtons}>
                <TouchableOpacity
                  style={styles.editButton}
                  onPress={() => showEditModal(totpCode)}
                >
                  <Ionicons name="pencil-outline" size={20} color={colors.textMuted} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => initiateTotpDelete(totpCode)}
                >
                  <Ionicons name="trash" size={20} color={colors.destructive} />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Add Choice Modal (Scan or Enter Manually) */}
      <Modal
        visible={isAddChoiceModalVisible}
        transparent
        animationType="fade"
        onRequestClose={hideAddChoiceModal}
      >
        <TouchableOpacity
          style={styles.modalContainer}
          activeOpacity={1}
          onPress={hideAddChoiceModal}
        >
          <View style={styles.modalContent}>
            <TouchableOpacity activeOpacity={1}>
              <View style={styles.modalHeader}>
                <ThemedText style={styles.modalTitle}>
                  {t('totp.addCode')}
                </ThemedText>
                <TouchableOpacity
                  style={styles.modalCloseButton}
                  onPress={hideAddChoiceModal}
                >
                  <MaterialIcons name="close" size={24} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              {/* Scan QR Code Button */}
              <TouchableOpacity
                style={styles.choiceButton}
                onPress={launchQRScanner}
              >
                <MaterialIcons name="qr-code-scanner" size={24} color={colors.primary} />
                <ThemedText style={styles.choiceButtonText}>
                  {t('totp.scanQrCode')}
                </ThemedText>
              </TouchableOpacity>

              {/* Divider with "or" */}
              <View style={styles.dividerContainer}>
                <View style={styles.dividerLine} />
                <ThemedText style={styles.dividerText}>{t('common.or')}</ThemedText>
                <View style={styles.dividerLine} />
              </View>

              {/* Enter Manually Button */}
              <TouchableOpacity
                style={styles.choiceButton}
                onPress={showManualEntryForm}
              >
                <MaterialIcons name="keyboard" size={24} color={colors.textMuted} />
                <ThemedText style={styles.choiceButtonText}>
                  {t('totp.enterManually')}
                </ThemedText>
              </TouchableOpacity>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Add TOTP Modal */}
      <Modal
        visible={isAddFormVisible}
        transparent
        animationType="fade"
        onRequestClose={hideAddForm}
      >
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior="padding"
          keyboardVerticalOffset={Platform.OS === 'android' ? 20 : 0}
        >
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
                  {t('totp.secretKey')}
                </ThemedText>
                <TextInput
                  style={[styles.input, formError && styles.inputError]}
                  placeholderTextColor={colors.textMuted}
                  value={formData.secretKey}
                  onChangeText={(text) => setFormData({ ...formData, secretKey: text })}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  autoFocus
                  multiline
                />

                {formError && (
                  <ThemedText style={styles.errorText}>
                    {formError}
                  </ThemedText>
                )}

                {/* Name is optional and hidden by default; revealed on demand since most codes don't need one. */}
                {showNameField ? (
                  <>
                    <View style={styles.nameLabelRow}>
                      <ThemedText style={styles.label}>
                        {t('totp.nameOptional')}
                      </ThemedText>
                      <TouchableOpacity style={styles.removeNameButton} onPress={hideNameField}>
                        <MaterialIcons name="close" size={18} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                    <TextInput
                      style={styles.input}
                      placeholder={t('totp.nameOptional')}
                      placeholderTextColor={colors.textMuted}
                      value={formData.name}
                      onChangeText={(text) => setFormData({ ...formData, name: text })}
                      autoCapitalize="words"
                      autoFocus
                    />
                  </>
                ) : (
                  <TouchableOpacity onPress={() => setShowNameField(true)}>
                    <ThemedText style={styles.addNameLink}>
                      {t('totp.addName')}
                    </ThemedText>
                  </TouchableOpacity>
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
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit TOTP Modal */}
      <Modal
        visible={isEditModalOpen}
        transparent
        animationType="fade"
        onRequestClose={closeEditModal}
      >
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior="padding"
          keyboardVerticalOffset={Platform.OS === 'android' ? 20 : 0}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={closeEditModal}
          />
          <View style={styles.modalContent}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.modalHeader}>
                <ThemedText style={styles.modalTitle}>
                  {t('common.edit')}
                </ThemedText>
                <TouchableOpacity
                  style={styles.modalCloseButton}
                  onPress={closeEditModal}
                >
                  <MaterialIcons name="close" size={24} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              {editingTotpCode && (
                <View>
                  <View style={styles.label}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <ThemedText style={styles.label}>
                        {t('totp.secretKey')}
                      </ThemedText>
                      <TouchableOpacity
                        onPress={toggleQrCode}
                        style={{ padding: 4 }}
                      >
                        <Ionicons name="qr-code-outline" size={20} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                  </View>
                  <TextInput
                    style={[styles.input, { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }]}
                    placeholder={t('totp.secretKey')}
                    placeholderTextColor={colors.textMuted}
                    value={editSecret}
                    onChangeText={setEditSecret}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    multiline
                  />

                  {/* Name is optional; hidden by default unless a custom name was set. */}
                  {showEditNameField ? (
                    <>
                      <View style={styles.nameLabelRow}>
                        <ThemedText style={styles.label}>
                          {t('totp.nameOptional')}
                        </ThemedText>
                        <TouchableOpacity style={styles.removeNameButton} onPress={hideEditNameField}>
                          <MaterialIcons name="close" size={18} color={colors.textMuted} />
                        </TouchableOpacity>
                      </View>
                      <TextInput
                        style={styles.input}
                        placeholder={t('totp.nameOptional')}
                        placeholderTextColor={colors.textMuted}
                        value={editName}
                        onChangeText={setEditName}
                        autoCapitalize="words"
                        autoFocus
                      />
                    </>
                  ) : (
                    <TouchableOpacity onPress={() => setShowEditNameField(true)}>
                      <ThemedText style={styles.addNameLink}>
                        {t('totp.addName')}
                      </ThemedText>
                    </TouchableOpacity>
                  )}

                  {showQrCode && (
                    <View style={styles.qrCodeContainer}>
                      <QRCode
                        value={(() => {
                          const issuer = itemDisplayName || 'AliasVault';
                          const accountName = itemUsername || editingTotpCode.Name;
                          const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
                          return `otpauth://totp/${label}?secret=${editingTotpCode.SecretKey}&issuer=${encodeURIComponent(issuer)}`;
                        })()}
                        size={200}
                        backgroundColor="white"
                        color="black"
                      />
                    </View>
                  )}

                  <TouchableOpacity
                    style={[styles.modalSaveButton, { marginTop: 16 }]}
                    onPress={saveEditedTotpCode}
                  >
                    <ThemedText style={styles.modalSaveButtonText}>
                      {t('common.save')}
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};
