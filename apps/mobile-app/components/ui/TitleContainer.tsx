import { Platform, StyleSheet, View } from 'react-native';

import Logo from '@/assets/images/logo.svg';
import { ThemedText } from '@/components/themed/ThemedText';

type TitleContainerProps = {
  title: string;
  showLogo?: boolean;
  /** Shown at the right end of the title row, e.g. a menu button. */
  right?: React.ReactNode;
};

/**
 * Title container component.
 */
export function TitleContainer({ title, showLogo = true, right }: TitleContainerProps): React.ReactNode {
  // On Android, we don't show the title container as the native header is used
  if (Platform.OS === 'android') {
    return null;
  }

  return (
    <View style={styles.titleContainer}>
      {showLogo && <Logo width={40} height={40} style={styles.logo} />}
      <ThemedText type="title">{title}</ThemedText>
      {right && <View style={styles.right}>{right}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  logo: {
    marginBottom: 6,
  },
  right: {
    marginLeft: 'auto',
  },
  titleContainer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
});
