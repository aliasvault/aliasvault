import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import ContextMenu from 'react-native-context-menu-view';

import { ThemedText } from '@/components/themed/ThemedText';
import { useColors } from '@/hooks/useColorScheme';
import { hasCustomTotpParameters, totpParametersFrom, type TotpAdvancedValues } from '@aliasvault/client/items/OtpAuthUri';
import { TOTP_SUPPORTED_ALGORITHMS, TOTP_SUPPORTED_DIGITS } from '@aliasvault/models/vault';

type TotpSettingsButtonProps = {
  isOpen: boolean;
  onToggle: () => void;
};

/**
 * Gear icon in the secret key label row that shows or hides the TOTP parameter fields.
 */
export const TotpSettingsButton: React.FC<TotpSettingsButtonProps> = ({ isOpen, onToggle }) => {
  const { t } = useTranslation();
  const colors = useColors();
  return (
    <TouchableOpacity onPress={onToggle} style={{ padding: 4 }} accessibilityRole="button" accessibilityLabel={t('settings.advancedOptions')} accessibilityState={{ expanded: isOpen }} testID="totp-settings">
      <Ionicons name="settings-outline" size={20} color={isOpen ? colors.primary : colors.textMuted} />
    </TouchableOpacity>
  );
};

type TotpAdvancedFieldsProps = {
  values: TotpAdvancedValues;
  onChange: (values: TotpAdvancedValues) => void;
  isOpen: boolean;
  onOpen: () => void;
};

/**
 * The TOTP parameters under the secret key: one compact row when opened, else a summary when they differ from the defaults.
 */
export const TotpAdvancedFields: React.FC<TotpAdvancedFieldsProps> = ({ values, onChange, isOpen, onOpen }) => {
  const { t } = useTranslation();
  const colors = useColors();

  const styles = useMemo(() => StyleSheet.create({
    cell: {
      flex: 1,
    },
    field: {
      alignItems: 'center',
      backgroundColor: colors.background,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      flexDirection: 'row',
      height: 40,
      justifyContent: 'space-between',
      paddingHorizontal: 10,
    },
    fieldText: {
      color: colors.text,
      fontSize: 14,
    },
    label: {
      color: colors.textMuted,
      fontSize: 12,
      marginBottom: 4,
    },
    row: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 8,
    },
    summary: {
      color: colors.textMuted,
      fontSize: 12,
      marginTop: 6,
    },
  }), [colors]);

  if (!isOpen) {
    const parameters = totpParametersFrom(values);
    if (!hasCustomTotpParameters(parameters)) {
      return null;
    }
    return (
      <TouchableOpacity onPress={onOpen} testID="totp-parameters">
        <ThemedText style={styles.summary}>
          {t('totp.parameterSummary', { algorithm: parameters.Algorithm, digits: parameters.Digits, period: parameters.Period })}
        </ThemedText>
      </TouchableOpacity>
    );
  }

  /**
   * A field that opens a native dropdown with the options.
   */
  const renderDropdown = <T extends string | number>(label: string, options: readonly T[], selected: T, onSelect: (value: T) => void): React.ReactNode => (
    <View style={styles.cell}>
      <ThemedText style={styles.label}>{label}</ThemedText>
      <ContextMenu dropdownMenuMode actions={options.map(option => ({ title: String(option), selected: option === selected }))} onPress={(event) => onSelect(options[event.nativeEvent.index])}>
        <View style={styles.field} accessible accessibilityRole="button" accessibilityLabel={label}>
          <ThemedText style={styles.fieldText}>{selected}</ThemedText>
          <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
        </View>
      </ContextMenu>
    </View>
  );

  return (
    <View style={styles.row}>
      {renderDropdown(t('totp.algorithm'), TOTP_SUPPORTED_ALGORITHMS, values.algorithm as typeof TOTP_SUPPORTED_ALGORITHMS[number], algorithm => onChange({ ...values, algorithm }))}
      {renderDropdown(t('totp.digits'), TOTP_SUPPORTED_DIGITS, values.digits as typeof TOTP_SUPPORTED_DIGITS[number], digits => onChange({ ...values, digits }))}
      <View style={styles.cell}>
        <ThemedText style={styles.label}>{t('totp.period')}</ThemedText>
        <TextInput
          style={[styles.field, styles.fieldText]}
          value={values.period}
          onChangeText={period => onChange({ ...values, period: period.replace(/[^0-9]/g, '') })}
          keyboardType="number-pad"
          maxLength={3}
        />
      </View>
    </View>
  );
};
