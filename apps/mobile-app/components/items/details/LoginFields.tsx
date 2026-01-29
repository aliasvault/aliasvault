import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import type { Item, ItemField } from '@/utils/dist/core/models/vault';
import { FieldKey } from '@/utils/dist/core/models/vault';

import { useColors } from '@/hooks/useColorScheme';

import FieldBlock from '@/components/items/details/FieldBlock';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';

type LoginFieldsProps = {
  item: Item;
};

/**
 * Login fields component.
 * Now uses FieldBlock for automatic field type handling and history support.
 */
export const LoginFields: React.FC<LoginFieldsProps> = ({ item }) : React.ReactNode => {
  const { t } = useTranslation();
  const colors = useColors();

  // Get login-related fields from the item
  const loginFields = item.Fields.filter(
    (field: ItemField) =>
      field.FieldKey === FieldKey.LoginEmail ||
      field.FieldKey === FieldKey.LoginUsername ||
      field.FieldKey === FieldKey.LoginPassword
  );

  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  const hasLoginCredentials = loginFields.length > 0 || item.HasPasskey;

  if (!hasLoginCredentials) {
    return null;
  }

  const passkeyStyles = StyleSheet.create({
    container: {
      backgroundColor: colors.accentBackground,
      borderRadius: 8,
      marginTop: 8,
      padding: 12,
    },
    contentRow: {
      alignItems: 'flex-start',
      flexDirection: 'row',
    },
    icon: {
      marginRight: 8,
      marginTop: 2,
    },
    infoContainer: {
      flex: 1,
    },
    label: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 4,
    },
    metadataRow: {
      marginBottom: 4,
    },
    metadataLabel: {
      color: colors.textMuted,
      fontSize: 12,
    },
    metadataValue: {
      color: colors.text,
      fontSize: 12,
    },
    helpText: {
      color: colors.textMuted,
      fontSize: 11,
      marginTop: 4,
    },
  });

  // Sort login fields: email first, then username, then password
  const sortedLoginFields = [...loginFields].sort((a, b) => {
    const order: Record<string, number> = {
      [FieldKey.LoginEmail]: 0,
      [FieldKey.LoginUsername]: 1,
      [FieldKey.LoginPassword]: 2
    };
    const aOrder = order[a.FieldKey] ?? 99;
    const bOrder = order[b.FieldKey] ?? 99;
    return aOrder - bOrder;
  });

  return (
    <ThemedView style={styles.section}>
      <ThemedText type="subtitle">{t('items.loginCredentials')}</ThemedText>

      {/* Render login fields using FieldBlock */}
      {sortedLoginFields.map((field: ItemField) => (
        <FieldBlock
          key={field.FieldKey}
          field={field}
          itemId={item.Id}
        />
      ))}

      {/* Passkey display */}
      {item.HasPasskey && (
        <View style={passkeyStyles.container}>
          <View style={passkeyStyles.contentRow}>
            <MaterialIcons
              name="vpn-key"
              size={20}
              color={colors.textMuted}
              style={passkeyStyles.icon}
            />
            <View style={passkeyStyles.infoContainer}>
              <ThemedText style={passkeyStyles.label}>
                {t('passkeys.passkey')}
              </ThemedText>
              <ThemedText style={passkeyStyles.helpText}>
                {t('passkeys.helpText')}
              </ThemedText>
            </View>
          </View>
        </View>
      )}
    </ThemedView>
  );
};

const styles = {
  section: {
    paddingTop: 16,
    gap: 8,
  },
};