import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { StyleSheet, View, TouchableOpacity, Alert } from 'react-native';

import type { Credential } from '@/utils/dist/shared/models/vault';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';

import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { useDb } from '@/context/DbContext';

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
        // If invalid date, return a default date
        return '01/01/0001 00:00:00';
      }
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const year = date.getFullYear();
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      return `${month}/${day}/${year} ${hours}:${minutes}:${seconds}`;
    } catch {
      // Return default date if parsing fails
      return '01/01/0001 00:00:00';
    }
  };

  /**
   * Convert credentials to CSV format.
   */
  const credentialsToCsv = async (credentials: Credential[]): Promise<string> => {
    const records: ICredentialCsvRecord[] = [];

    // Get all credentials with their TOTP codes
    for (const credential of credentials) {
      // Get TOTP codes for this credential
      const totpCodes = await dbContext.sqliteClient?.getTotpCodesForCredential(credential.Id) ?? [];
      const totpSecret = totpCodes.length > 0 ? totpCodes[0].SecretKey : '';

      /*
       * For now, we'll use current date for CreatedAt/UpdatedAt since they're not available
       * in the Credential type. In a production scenario, we'd want to extend the
       * SqliteClient to fetch these fields.
       */
      const currentDate = formatDate(new Date().toISOString());

      const record: ICredentialCsvRecord = {
        Version: '1.5.0',
        Username: credential.Username ?? '',
        Notes: credential.Notes ?? '',
        CreatedAt: currentDate,
        UpdatedAt: currentDate,
        AliasGender: credential.Alias?.Gender ?? '',
        AliasFirstName: credential.Alias?.FirstName ?? '',
        AliasLastName: credential.Alias?.LastName ?? '',
        AliasNickName: credential.Alias?.NickName ?? '',
        AliasBirthDate: credential.Alias?.BirthDate ? formatDate(credential.Alias.BirthDate) : '01/01/0001 00:00:00',
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
   * Show export confirmation dialog.
   */
  const showExportConfirmation = (): void => {
    const warningMessage = t('settings.exportWarning');

    Alert.alert(
      t('settings.exportConfirmTitle'),
      warningMessage,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          style: 'destructive',
          /**
           * Handle export confirmation.
           */
          onPress: (): void => {
            handleExport();
          }
        },
      ]
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
      const credentials = await dbContext.sqliteClient?.getAllCredentials() ?? [];
      const csvContent = await credentialsToCsv(credentials);

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
      Alert.alert(
        t('common.error'),
        t('common.errors.unknownError')
      );
    } finally {
      setIsExporting(false);
    }
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1,
    },
    scrollContent: {
      paddingTop: 16,
      paddingBottom: 40,
    },
    section: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      marginTop: 16,
      marginHorizontal: 16,
      padding: 16,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 8,
      color: colors.text,
    },
    sectionDescription: {
      fontSize: 14,
      color: colors.textMuted,
      marginBottom: 16,
      lineHeight: 20,
    },
    button: {
      backgroundColor: colors.primary,
      borderRadius: 8,
      paddingVertical: 12,
      paddingHorizontal: 16,
      marginVertical: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
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
      padding: 12,
      marginTop: 8,
    },
    importNoteText: {
      fontSize: 14,
      color: colors.text,
      lineHeight: 20,
    },
  });

  return (
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
  );
}