import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import type { Item } from '@/utils/dist/core/models/vault';
import { getFieldValue, FieldKey } from '@/utils/dist/core/models/vault';

import { useColors } from '@/hooks/useColorScheme';

import FormInputCopyToClipboard from '@/components/form/FormInputCopyToClipboard';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';

type LoginFieldsProps = {
  item: Item;
};

/**
 * Login fields component.
 */
export const LoginFields: React.FC<LoginFieldsProps> = ({ item }) : React.ReactNode => {
  const { t } = useTranslation();
  const colors = useColors();
  const email = getFieldValue(item, FieldKey.LoginEmail)?.trim();
  const username = getFieldValue(item, FieldKey.LoginUsername)?.trim();
  const password = getFieldValue(item, FieldKey.LoginPassword)?.trim();

  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  const hasLoginCredentials = email || username || password || item.HasPasskey;

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

  return (
    <ThemedView style={styles.section}>
      <ThemedText type="subtitle">{t('credentials.loginCredentials')}</ThemedText>
      {email && (
        <FormInputCopyToClipboard
          label={t('credentials.email')}
          value={email}
        />
      )}
      {username && (
        <FormInputCopyToClipboard
          label={t('credentials.username')}
          value={username}
        />
      )}
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
      {password && (
        <FormInputCopyToClipboard
          label={t('credentials.password')}
          value={password}
          type="password"
        />
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