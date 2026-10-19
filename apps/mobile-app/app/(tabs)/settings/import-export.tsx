import { AvexExportService } from '@aliasvault/client/transfer/export/AvexExportService';
import { AvuxExportService } from '@aliasvault/client/transfer/export/AvuxExportService';
import { VAULT_EXPORT_MIME_TYPES, vaultExportFileName, type VaultExportFormat } from '@aliasvault/client/transfer/export/VaultExportFile';
import { Ionicons } from '@expo/vector-icons';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';

import { getExportDirectory } from '@/utils/FileUtility';
import { VaultUnlockHelper } from '@/utils/VaultUnlockHelper';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';

import { ExportPasswordModal } from '@/components/common/ExportPasswordModal';
import LoadingOverlay from '@/components/LoadingOverlay';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { useDb } from '@/context/DbContext';
import { useDialog } from '@/context/DialogContext';

/**
 * The unlock methods that may confirm an export. Only the master password: an export hands over the whole vault in
 * one go, so the device unlock (biometrics or PIN) alone is not enough.
 */
const EXPORT_AUTH_METHODS = ['password'];

/**
 * The export options, in the order they are shown.
 */
const EXPORT_FORMATS: { format: VaultExportFormat; titleKey: string; descriptionKey: string; buttonKey: string; icon: keyof typeof Ionicons.glyphMap; recommended: boolean }[] = [
  { format: 'avex', titleKey: 'importExport.exportAvexTitle', descriptionKey: 'importExport.exportAvexDescription', buttonKey: 'importExport.exportAvexButton', icon: 'lock-closed', recommended: true },
  { format: 'avux', titleKey: 'importExport.exportAvuxTitle', descriptionKey: 'importExport.exportAvuxDescription', buttonKey: 'importExport.exportAvuxButton', icon: 'archive', recommended: false },
  { format: 'csv', titleKey: 'importExport.exportCsvTitle', descriptionKey: 'importExport.exportCsvDescription', buttonKey: 'importExport.exportCsvButton', icon: 'document-text', recommended: false },
];

/**
 * Import/Export settings screen.
 * @returns The Import/Export settings screen component.
 */
export default function ImportExportScreen(): React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const dbContext = useDb();
  const { showAlert, showConfirm } = useDialog();
  const [isExporting, setIsExporting] = useState(false);
  const [showExportPasswordModal, setShowExportPasswordModal] = useState(false);

  /**
   * Confirm the export, verify the master password, then export (or ask for the export password first for .avex).
   */
  const startExport = (format: VaultExportFormat): void => {
    const warning = format === 'avex' ? t('importExport.exportEncryptedWarningMessage') : t('settings.exportWarning');
    showConfirm(t('settings.exportConfirmTitle'), warning, t('common.confirm'), async () => {
      try {
        const authenticated = await VaultUnlockHelper.authenticateForAction(t('settings.exportConfirmTitle'), t('settings.passwordConfirm.exportDescription'), EXPORT_AUTH_METHODS, t('common.confirm'));
        if (!authenticated) {
          return;
        }

        if (format === 'avex') {
          setShowExportPasswordModal(true);
        } else {
          await runExport(format, null);
        }
      } catch (error) {
        console.error('Authentication error during vault export:', error);
        showAlert(t('common.error'), t('common.errors.unknownError'));
      }
    }, { confirmStyle: 'destructive' });
  };

  /**
   * The export bytes of a format, read from the vault.
   */
  const buildExport = async (format: VaultExportFormat, exportPassword: string | null): Promise<Uint8Array> => {
    const sqliteClient = dbContext.sqliteClient;
    if (!sqliteClient) {
      throw new Error('Vault is not available');
    }
    if (format === 'csv') {
      return sqliteClient.importExport.exportToCsv();
    }
    const avuxBytes = AvuxExportService.exportToAvux(await sqliteClient.importExport.getExportData());
    return format === 'avux' ? avuxBytes : AvexExportService.encryptToAvex(avuxBytes, exportPassword ?? '');
  };

  /**
   * Build the export, write it to a temporary file and hand it to the system share sheet.
   */
  const runExport = async (format: VaultExportFormat, exportPassword: string | null): Promise<void> => {
    if (isExporting) {
      return;
    }

    setIsExporting(true);

    let file: File | null = null;
    try {
      const bytes = await buildExport(format, exportPassword);

      const filename = vaultExportFileName(format);
      const exportDir = getExportDirectory();
      if (!exportDir.exists) {
        exportDir.create({ intermediates: true });
      }

      file = new File(exportDir, filename);
      if (file.exists) {
        file.delete();
      }
      file.create();
      file.write(bytes);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { dialogTitle: filename, mimeType: VAULT_EXPORT_MIME_TYPES[format] });
      }
    } catch (error) {
      console.error('Export error:', error);
      showAlert(t('common.error'), t('common.errors.unknownError'));
    } finally {
      // Cleanup temporary export file if it still exists.
      try {
        if (file?.exists) {
          file.delete();
        }
      } catch (error) {
        console.error('Error cleaning up export file:', error);
      }
      setIsExporting(false);
    }
  };

  /**
   * The export password was entered: create the .avex export.
   */
  const handleExportPasswordSubmitted = (exportPassword: string): void => {
    setShowExportPasswordModal(false);
    void runExport('avex', exportPassword);
  };

  const styles = StyleSheet.create({
    button: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 8,
      flexDirection: 'row',
      justifyContent: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    buttonText: {
      color: colors.primarySurfaceText,
      fontSize: 16,
      fontWeight: '600',
      marginLeft: 8,
    },
    exportOption: {
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      marginTop: 12,
      padding: 12,
    },
    exportOptionDescription: {
      color: colors.textMuted,
      fontSize: 14,
      lineHeight: 20,
      marginBottom: 12,
    },
    exportOptionHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      marginBottom: 4,
    },
    exportOptionRecommended: {
      backgroundColor: colors.tertiary + '20',
      borderColor: colors.tertiary,
      borderWidth: 2,
    },
    exportOptionTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
    },
    importNote: {
      backgroundColor: colors.tertiary + '20', // Use tertiary color with opacity
      borderRadius: 8,
      marginTop: 8,
      padding: 12,
    },
    importNoteText: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
    },
    recommendedBadge: {
      backgroundColor: colors.tertiary + '40',
      borderRadius: 4,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    recommendedBadgeText: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '600',
    },
    section: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      marginTop: 16,
      padding: 16,
    },
    sectionDescription: {
      color: colors.textMuted,
      fontSize: 14,
      lineHeight: 20,
      marginBottom: 4,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 8,
    },
  });

  return (
    <>
      {isExporting && (
        <LoadingOverlay status={t('importExport.exportingVaultMessage')} />
      )}
      <ThemedContainer>
        <ThemedScrollView>
          {/* Import Section */}
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>
              {t('settings.importSectionTitle')}
            </ThemedText>
            <ThemedText style={styles.sectionDescription}>
              {t('settings.importSectionDescription')}
            </ThemedText>
            <View style={styles.importNote}>
              <ThemedText style={styles.importNoteText}>
                {t('settings.importWebNote')}
              </ThemedText>
            </View>
          </View>

          {/* Export Section */}
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>
              {t('settings.exportSectionTitle')}
            </ThemedText>
            <ThemedText style={styles.sectionDescription}>
              {t('importExport.exportSectionDescription')}
            </ThemedText>

            {EXPORT_FORMATS.map(option => (
              <View key={option.format} style={[styles.exportOption, option.recommended && styles.exportOptionRecommended]}>
                <View style={styles.exportOptionHeader}>
                  <ThemedText style={styles.exportOptionTitle}>{t(option.titleKey)}</ThemedText>
                  {option.recommended && (
                    <View style={styles.recommendedBadge}>
                      <ThemedText style={styles.recommendedBadgeText}>{t('importExport.recommendedLabel')}</ThemedText>
                    </View>
                  )}
                </View>
                <ThemedText style={styles.exportOptionDescription}>{t(option.descriptionKey)}</ThemedText>
                <TouchableOpacity
                  style={[styles.button, isExporting && styles.buttonDisabled]}
                  onPress={() => startExport(option.format)}
                  disabled={isExporting}
                  testID={`export-${option.format}-button`}
                >
                  <Ionicons name={option.icon} size={20} color={colors.primarySurfaceText} />
                  <ThemedText style={styles.buttonText}>{t(option.buttonKey)}</ThemedText>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </ThemedScrollView>
      </ThemedContainer>

      <ExportPasswordModal isOpen={showExportPasswordModal} onClose={() => setShowExportPasswordModal(false)} onSubmit={handleExportPasswordSubmitted} />
    </>
  );
}
