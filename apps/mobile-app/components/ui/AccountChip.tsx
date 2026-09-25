import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';
import { useAuth } from '@/context/AuthContext';

import { Avatar } from './Avatar';

type AccountChipProps = {
  style?: StyleProp<ViewStyle>;
};

/**
 * Compact pill with the avatar and username of the logged in account.
 */
export function AccountChip({ style }: AccountChipProps): React.ReactNode {
  const colors = useColors();
  const { username } = useAuth();

  const styles = StyleSheet.create({
    chip: {
      alignItems: 'center',
      alignSelf: 'center',
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 999,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 8,
      maxWidth: '100%',
      paddingLeft: 4,
      paddingRight: 14,
      paddingVertical: 4,
    },
    username: {
      color: colors.text,
      flexShrink: 1,
      fontSize: 15,
      fontWeight: '500',
    },
  });

  return (
    <View style={[styles.chip, style]}>
      <Avatar size={28} />
      <ThemedText style={styles.username} numberOfLines={1}>{username}</ThemedText>
    </View>
  );
}
