import { MaterialIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { toast } from 'sonner-native';

import { type CredentialExchangeExportCounts } from '@/utils/CredentialExchange';
import { VaultUnlockHelper } from '@/utils/VaultUnlockHelper';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';

import LoadingOverlay from '@/components/LoadingOverlay';
import { ThemedButton } from '@/components/themed/ThemedButton';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { IconSymbolName } from '@/components/ui/IconSymbolName';
import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * Export the vault to another app on this device through the credential exchange standard.
 * @returns The screen component.
 */
export default function CredentialExchangeExportScreen(): React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const [counts, setCounts] = useState<CredentialExchangeExportCounts | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    /**
     * Load what an export would hold.
     */
    const load = async (): Promise<void> => {
      try {
        setCounts(await NativeVaultManager.credentialExchangeExportSummary());
      } catch (error) {
        console.error('Credential exchange export summary could not be loaded:', error);
      }
    };
    void load();
  }, []);

  /**
   * Verify the master password, then hand the vault to the app the user picks in the iOS sheet.
   */
  const startExport = async (): Promise<void> => {
    try {
      const authenticated = await VaultUnlockHelper.authenticateForAction(t('settings.exportConfirmTitle'), t('settings.passwordConfirm.exportDescription'), ['password'], t('common.confirm'));
      if (!authenticated) {
        return;
      }
      setIsExporting(true);
      await NativeVaultManager.credentialExchangeExport();
      toast.success(t('common.success'), { description: t('importExport.exportSuccessMessage') });
    } catch (error) {
      // Closing the iOS sheet rejects too, so a failed export only goes to the log; a finished one shows the toast above.
      console.error('Credential exchange export did not finish:', error);
    } finally {
      setIsExporting(false);
    }
  };

  const styles = StyleSheet.create({
    countIcon: {
      marginRight: 10,
    },
    countLabel: {
      color: colors.textMuted,
      flex: 1,
      fontSize: 15,
    },
    countRow: {
      alignItems: 'center',
      flexDirection: 'row',
      paddingVertical: 6,
    },
    countValue: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    counts: {
      marginBottom: 16,
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

  const iconProps = { size: 18, color: colors.textMuted, style: styles.countIcon };

  /**
   * Export count row indicator.
   */
  const countRow = (label: string, value: number, icon: React.ReactNode): React.ReactNode => (
    <View style={styles.countRow}>
      {icon}
      <ThemedText style={styles.countLabel}>{label}</ThemedText>
      <ThemedText style={styles.countValue}>{value}</ThemedText>
    </View>
  );

  return (
    <>
      {isExporting && <LoadingOverlay status={t('importExport.exportingVaultMessage')} />}
      <ThemedContainer>
        <ThemedScrollView>
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>{t('settings.credentialExchange.exportTitle')}</ThemedText>
            <ThemedText style={styles.sectionDescription}>{t('settings.credentialExchange.description')}</ThemedText>
            {counts && (
              <View style={styles.counts}>
                {countRow(t('items.title'), counts.itemCount, <IconSymbol name={IconSymbolName.Key} {...iconProps} />)}
                {countRow(t('common.passkeys'), counts.passkeyCount, <MaterialIcons name="vpn-key" {...iconProps} />)}
                {countRow(t('items.filters.totp'), counts.totpCount, <MaterialIcons name="access-time" {...iconProps} />)}
              </View>
            )}
            <ThemedButton title={t('settings.credentialExchange.exportTitle')} onPress={() => void startExport()} disabled={isExporting} testID="credential-exchange-export-button" />
          </View>
        </ThemedScrollView>
      </ThemedContainer>
    </>
  );
}
