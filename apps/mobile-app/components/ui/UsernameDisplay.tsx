import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';
import { useAuth } from '@/context/AuthContext';

import { Avatar } from './Avatar';

/**
 * Account card that shows the avatar with "Logged in as" above the username.
 */
export function UsernameDisplay(): React.ReactNode {
  const { t } = useTranslation();
  const colors = useColors();
  const { username } = useAuth();

  const styles = StyleSheet.create({
    card: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      flexDirection: 'row',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    textContainer: {
      flex: 1,
    },
    label: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    usernameText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
      lineHeight: 22,
    },
  });

  return (
    <View style={styles.card}>
      <Avatar size={44} />
      <View style={styles.textContainer}>
        <ThemedText style={styles.label}>{t('auth.loggedInAs')}</ThemedText>
        <ThemedText style={styles.usernameText} numberOfLines={1}>{username}</ThemedText>
      </View>
    </View>
  );
}
