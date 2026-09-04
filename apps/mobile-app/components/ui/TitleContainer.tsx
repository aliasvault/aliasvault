import { Platform, StyleSheet, TouchableOpacity, View } from 'react-native';

import Logo from '@/assets/images/logo.svg';
import { ThemedText } from '@/components/themed/ThemedText';

type TitleContainerProps = {
  title: string;
  showLogo?: boolean;
  onLogoPress?: () => void;
};

/**
 * Title container component.
 */
export function TitleContainer({ title, showLogo = true, onLogoPress }: TitleContainerProps): React.ReactNode {
  // On Android, we don't show the title container as the native header is used
  if (Platform.OS === 'android') {
    return null;
  }

  return (
    <View style={styles.titleContainer}>
      {showLogo && (
        onLogoPress ? (
          <TouchableOpacity onPress={onLogoPress} activeOpacity={1}>
            <Logo width={40} height={40} style={styles.logo} />
          </TouchableOpacity>
        ) : (
          <Logo width={40} height={40} style={styles.logo} />
        )
      )}
      <ThemedText type="title">{title}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  logo: {
    marginBottom: 6,
  },
  titleContainer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
});
