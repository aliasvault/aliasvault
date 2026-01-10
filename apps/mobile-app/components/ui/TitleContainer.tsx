import { Platform, StyleSheet, View } from 'react-native';

import Logo from '@/assets/images/logo.svg';
import { ThemedText } from '@/components/themed/ThemedText';

type TitleContainerProps = {
  title: string;
  showLogo?: boolean;
};

/**
 * Title container component.
 * Note: Offline/sync status is now shown via the floating ServerSyncIndicator in the tab layout.
 */
export function TitleContainer({ title, showLogo = true }: TitleContainerProps): React.ReactNode {
  // On Android, we don't show the title container as the native header is used
  if (Platform.OS === 'android') {
    return null;
  }

  return (
    <View style={styles.titleContainer}>
      {showLogo && <Logo width={40} height={40} style={styles.logo} />}
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
