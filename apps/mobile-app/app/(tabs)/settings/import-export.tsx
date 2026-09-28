import { Ionicons } from '@expo/vector-icons';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';

import { getExportDirectory } from '@/utils/FileUtility';
import { VaultUnlockHelper } from '@/utils/VaultUnlockHelper';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';

import LoadingOverlay from '@/components/LoadingOverlay';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { useDb } from '@/context/DbContext';
import { useDialog } from '@/context/DialogContext';

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

  /**
   * Show export confirmation dialog, then password verification.
   */
  const showExportConfirmation = (): void => {
    showConfirm(
      t('settings.exportConfirmTitle'),
      t('settings.exportWarning'),
      t('common.confirm'),
      async () => {
        try {
          /*
           * Request password authentication using native unlock screen
           * Only allow password method (no biometric or PIN) for sensitive export operation
           */
          const authenticated = await VaultUnlockHelper.authenticateForAction(
            t('settings.exportConfirmTitle'),
            t('settings.passwordConfirm.exportDescription'),
            ['password'], // Only allow password authentication
            t('common.confirm')
          );

          if (!authenticated) {
            // User cancelled or authentication failed
            return;
          }

          // Password verified, proceed with export
          await handleExport();
        } catch (error) {
          console.error('Authentication error during CSV export:', error);
          showAlert(t('common.error'), t('common.errors.unknownError'));
        }
      },
      { confirmStyle: 'destructive' }
    );
  };

  /**
   * Handle the CSV export.
   */
  const handleExport = async (): Promise<void> => {
    if (isExporting) {
      return;
    }

    setIsExporting(true);

    let file: File | null = null;
    try {
      const dateStr = new Date().toISOString().split('T')[0];

      if (!dbContext.sqliteClient) {
        throw new Error('Vault is not available');
      }
      const csvContent = await dbContext.sqliteClient.importExport.exportToCsv();

      const filename = `aliasvault-export-${dateStr}.csv`;
      const exportDir = getExportDirectory();
      if (!exportDir.exists) {
        exportDir.create({ intermediates: true });
      }

      file = new File(exportDir, filename);
      if (file.exists) {
        file.delete();
      }
      file.create();
      file.write(csvContent);

      // Share the file using the system share dialog
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          dialogTitle: filename,
          mimeType: 'text/csv',
        });
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

  const styles = StyleSheet.create({
    button: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 8,
      flexDirection: 'row',
      justifyContent: 'center',
      marginVertical: 8,
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
      marginBottom: 16,
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
        <LoadingOverlay status={t('settings.exporting')} />
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
              {t('settings.exportSectionDescription')}
            </ThemedText>

            <TouchableOpacity
              style={[styles.button, isExporting && styles.buttonDisabled]}
              onPress={() => showExportConfirmation()}
              disabled={isExporting}
            >
              <Ionicons name="document-text" size={20} color={colors.primarySurfaceText} />
              <ThemedText style={styles.buttonText}>
                {isExporting
                  ? (t('settings.exporting'))
                  : (t('settings.exportCsvButton'))
                }
              </ThemedText>
            </TouchableOpacity>
          </View>
        </ThemedScrollView>
      </ThemedContainer>
    </>
  );
}
