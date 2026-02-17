import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';

import type { Item } from '@/utils/dist/core/models/vault';
import { getFieldValue, itemToCredential } from '@/utils/dist/core/models/vault';

import { useColors } from '@/hooks/useColorScheme';
import { usePasswordConfirm } from '@/hooks/usePasswordConfirm';
import { useTranslation } from '@/hooks/useTranslation';

import LoadingOverlay from '@/components/LoadingOverlay';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { useDb } from '@/context/DbContext';
import { useDialog } from '@/context/DialogContext';

/**
 * CSV record for Credential objects (matching server format).
 */
interface ICredentialCsvRecord {
  Version: string;
  Username: string;
  Notes: string;
  CreatedAt: string;
  UpdatedAt: string;
  AliasGender: string;
  AliasFirstName: string;
  AliasLastName: string;
  AliasNickName: string;
  AliasBirthDate: string;
  AliasEmail: string;
  ServiceName: string;
  ServiceUrl: string;
  CurrentPassword: string;
  TwoFactorSecret: string;
}

/**
 * Import/Export settings screen.
 * @returns The Import/Export settings screen component.
 */
export default function ImportExportScreen(): React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const dbContext = useDb();
  const { showAlert, showConfirm } = useDialog();
  const { requestPasswordConfirm } = usePasswordConfirm();
  const [isExporting, setIsExporting] = useState(false);

  /**
   * Format date to match server format (MM/DD/YYYY HH:mm:ss).
   */
  const formatDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) {
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const year = now.getFullYear();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      return `${month}/${day}/${year} ${hours}:${minutes}:${seconds}`;
    }

    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) {
        // If invalid date, return empty string
        return '';
      }
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const year = date.getFullYear();
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      return `${month}/${day}/${year} ${hours}:${minutes}:${seconds}`;
    } catch {
      // Return empty string if parsing fails
      return '';
    }
  };

  /**
   * Convert items to CSV format.
   */
  const itemsToCsv = async (items: Item[]): Promise<string> => {
    const records: ICredentialCsvRecord[] = [];

    // Get all items with their TOTP codes
    for (const item of items) {
      // Get TOTP codes for this item
      const totpCodes = await dbContext.sqliteClient?.settings.getTotpCodesForItem(item.Id) ?? [];
      const totpSecret = totpCodes.length > 0 ? totpCodes[0].SecretKey : '';

      // Convert item to credential format for backward compatibility with CSV export
      const credential = itemToCredential(item);

      /*
       * Get nickname from item fields (not in Credential type but needed for CSV)
       * Note: AliasNickname is not a standard FieldKey, use string literal
       */
      const nickName = getFieldValue(item, 'alias.nickname') ?? '';

      const record: ICredentialCsvRecord = {
        Version: '1.5.0',
        Username: credential.Username ?? '',
        Notes: credential.Notes ?? '',
        CreatedAt: formatDate(item.CreatedAt),
        UpdatedAt: formatDate(item.UpdatedAt),
        AliasGender: credential.Alias?.Gender ?? '',
        AliasFirstName: credential.Alias?.FirstName ?? '',
        AliasLastName: credential.Alias?.LastName ?? '',
        AliasNickName: nickName,
        AliasBirthDate: credential.Alias?.BirthDate ? formatDate(credential.Alias.BirthDate) : '',
        AliasEmail: credential.Alias?.Email ?? '',
        ServiceName: credential.ServiceName ?? '',
        ServiceUrl: credential.ServiceUrl ?? '',
        CurrentPassword: credential.Password ?? '',
        TwoFactorSecret: totpSecret
      };

      records.push(record);
    }

    // Generate CSV header
    const headers = [
      'Version',
      'Username',
      'Notes',
      'CreatedAt',
      'UpdatedAt',
      'AliasGender',
      'AliasFirstName',
      'AliasLastName',
      'AliasNickName',
      'AliasBirthDate',
      'AliasEmail',
      'ServiceName',
      'ServiceUrl',
      'CurrentPassword',
      'TwoFactorSecret'
    ];

    /**
     * Escape CSV value.
     * @param {string} value - The value to escape.
     * @returns {string} The escaped value.
     */
    const escapeCsvValue = (value: string): string => {
      // If value contains comma, newline, or quote, wrap in quotes
      if (value.includes(',') || value.includes('\n') || value.includes('"') || value.includes('\r')) {
        // Escape quotes by doubling them and wrap in quotes
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    };

    // Generate CSV content
    const csvLines: string[] = [headers.join(',')];

    for (const record of records) {
      const values = [
        record.Version,
        escapeCsvValue(record.Username),
        escapeCsvValue(record.Notes),
        record.CreatedAt,
        record.UpdatedAt,
        record.AliasGender,
        record.AliasFirstName,
        record.AliasLastName,
        record.AliasNickName,
        record.AliasBirthDate,
        record.AliasEmail,
        escapeCsvValue(record.ServiceName),
        escapeCsvValue(record.ServiceUrl),
        escapeCsvValue(record.CurrentPassword),
        escapeCsvValue(record.TwoFactorSecret)
      ];
      csvLines.push(values.join(','));
    }

    return csvLines.join('\n');
  };

  /**
   * Show export confirmation dialog, then password verification.
   */
  const showExportConfirmation = (): void => {
    showConfirm(
      t('settings.exportConfirmTitle'),
      t('settings.exportWarning'),
      t('common.confirm'),
      async () => {
        // Request password confirmation via modal page
        const passwordHash = await requestPasswordConfirm({
          description: t('settings.passwordConfirm.exportDescription'),
        });

        if (!passwordHash) {
          // User cancelled
          return;
        }

        // Password verified, proceed with export
        await handleExport();
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

    /*
     * Note: when updating this CSV export logic, make sure to update the
     * unittest "ImportCredentialsFromAliasVaultMobileAppCsv" in the .NET solution as well.
     */

    setIsExporting(true);

    try {
      const dateStr = new Date().toISOString().split('T')[0];

      // Export as CSV
      const items = await dbContext.sqliteClient?.items.getAll() ?? [];
      const csvContent = await itemsToCsv(items);

      const filename = `aliasvault-export-${dateStr}.csv`;
      const downloadsDir = FileSystem.documentDirectory + 'Exports/';
      const filePath = downloadsDir + filename;

      // Ensure Exports directory exists
      const dirInfo = await FileSystem.getInfoAsync(downloadsDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(downloadsDir, { intermediates: true });
      }

      // Write CSV file
      await FileSystem.writeAsStringAsync(filePath, csvContent, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      // Share the file using the system share dialog
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(filePath, {
          dialogTitle: filename,
          mimeType: 'text/csv',
        });

        // Clean up the temporary file after sharing
        setTimeout(async () => {
          try {
            await FileSystem.deleteAsync(filePath, { idempotent: true });
          } catch (error) {
            console.error('Error cleaning up export file:', error);
          }
        }, 5000);
      }
    } catch (error) {
      console.error('Export error:', error);
      showAlert(t('common.error'), t('common.errors.unknownError'));
    } finally {
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
