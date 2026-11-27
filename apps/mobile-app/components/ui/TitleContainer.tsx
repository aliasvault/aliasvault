import { Platform, StyleSheet, View, type TextStyle } from 'react-native';

import Logo from '@/assets/images/logo.svg';
import { ThemedText } from '@/components/themed/ThemedText';

/**
 * Text style of a tab's title; the items screen's title row uses it too, so all tab title rows line up at every text size.
 */
export const TAB_TITLE_TEXT_STYLE: TextStyle = {
  fontSize: 28,
  fontWeight: 'bold',
  lineHeight: 34,
};

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
      {showLogo && <Logo width={40} height={40} />}
      <ThemedText style={TAB_TITLE_TEXT_STYLE}>{title}</ThemedText>
      {right && <View style={styles.right}>{right}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
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
