import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, View, TouchableOpacity } from 'react-native';

import { isCredentialExchangeAvailable } from '@/utils/CredentialExchange';

import { useColors } from '@/hooks/useColorScheme';
import { useNavigationDebounce } from '@/hooks/useNavigationDebounce';
import { useTranslation } from '@/hooks/useTranslation';

import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { SettingsHeader } from '@/components/ui/SettingsHeader';
import { useDialog } from '@/context/DialogContext';

/**
 * Import/Export settings screen.
 * @returns The Import/Export settings screen component.
 */
export default function ImportExportScreen(): React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const { showAlert } = useDialog();
  const router = useRouter();
  const navigate = useNavigationDebounce();

  const styles = StyleSheet.create({
    section: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      paddingHorizontal: 16,
      paddingVertical: 4,
    },
    optionRow: {
      alignItems: 'center',
      flexDirection: 'row',
      paddingVertical: 12,
    },
    optionRowIcon: {
      marginRight: 12,
      width: 24,
    },
    optionRowText: {
      color: colors.text,
      flex: 1,
      fontSize: 16,
    },
    optionSeparator: {
      backgroundColor: colors.accentBorder,
      height: StyleSheet.hairlineWidth,
      marginLeft: 36,
    },
    sectionTitle: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '600',
      marginBottom: 8,
      marginLeft: 16,
      marginTop: 20,
      textTransform: 'uppercase',
    },
  });

  return (
    <ThemedContainer>
      <ThemedScrollView>
        <SettingsHeader title={t('settings.importExport')} description={t('importExport.pageDescription')} icon="swap-horizontal" />
        {/* Import: both options only explain where the import starts */}
        <ThemedText style={styles.sectionTitle}>{t('settings.importSectionTitle')}</ThemedText>
        <View style={styles.section}>
          {isCredentialExchangeAvailable && (
            <>
              <TouchableOpacity
                style={styles.optionRow}
                onPress={() => showAlert(t('settings.credentialExchange.importTitle'), t('settings.credentialExchange.importInstructionsIos'))}
                testID="credential-exchange-import-link"
              >
                <View style={styles.optionRowIcon}>
                  <Ionicons name="phone-portrait-outline" size={20} color={colors.text} />
                </View>
                <ThemedText style={styles.optionRowText}>{t('settings.credentialExchange.importTitle')}</ThemedText>
                <Ionicons name="information-circle-outline" size={20} color={colors.textMuted} />
              </TouchableOpacity>
              <View style={styles.optionSeparator} />
            </>
          )}
          <TouchableOpacity style={styles.optionRow} onPress={() => showAlert(t('settings.importFromFileTitle'), t('settings.importWebNote'))} testID="import-from-file-link">
            <View style={styles.optionRowIcon}>
              <Ionicons name="document-text-outline" size={20} color={colors.text} />
            </View>
            <ThemedText style={styles.optionRowText}>{t('settings.importFromFileTitle')}</ThemedText>
            <Ionicons name="information-circle-outline" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <ThemedText style={styles.sectionTitle}>{t('settings.exportSectionTitle')}</ThemedText>
        <View style={styles.section}>
          {isCredentialExchangeAvailable && (
            <>
              <TouchableOpacity style={styles.optionRow} onPress={() => navigate(() => router.push('/(tabs)/settings/credential-exchange-export'))} testID="credential-exchange-export-link">
                <View style={styles.optionRowIcon}>
                  <Ionicons name="phone-portrait" size={20} color={colors.text} />
                </View>
                <ThemedText style={styles.optionRowText}>{t('settings.credentialExchange.exportTitle')}</ThemedText>
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              </TouchableOpacity>
              <View style={styles.optionSeparator} />
            </>
          )}
          <TouchableOpacity style={styles.optionRow} onPress={() => navigate(() => router.push('/(tabs)/settings/export-file'))} testID="export-file-link">
            <View style={styles.optionRowIcon}>
              <Ionicons name="document-text" size={20} color={colors.text} />
            </View>
            <ThemedText style={styles.optionRowText}>{t('settings.exportToFileTitle')}</ThemedText>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </ThemedScrollView>
    </ThemedContainer>
  );
}
