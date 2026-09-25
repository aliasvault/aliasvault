import { StyleSheet, View } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import { useAuth } from '@/context/AuthContext';

import { ThemedText } from '../themed/ThemedText';

type AvatarProps = {
  size?: number;
};

/**
 * Avatar component that displays the first letter of the username.
 */
export function Avatar({ size = 40 }: AvatarProps): React.ReactNode {
  const colors = useColors();
  const { username } = useAuth();

  const styles = StyleSheet.create({
    avatar: {
      alignItems: 'center',
      backgroundColor: colors.primary + 80,
      borderRadius: size / 2,
      height: size,
      justifyContent: 'center',
      width: size,
    },
    avatarText: {
      color: colors.primarySurfaceText,
      fontSize: size * 0.45,
      fontWeight: '600',
      lineHeight: size * 0.6,
    },
  });

  return (
    <View style={styles.avatar}>
      <ThemedText style={styles.avatarText}>
        {username?.[0]?.toUpperCase() ?? '?'}
      </ThemedText>
    </View>
  );
}
