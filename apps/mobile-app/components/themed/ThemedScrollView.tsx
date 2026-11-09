import { Platform, ScrollView, StyleProp, StyleSheet, ViewStyle, ScrollViewProps } from 'react-native';

type ThemedScrollViewProps = ScrollViewProps & {
  style?: StyleProp<ViewStyle>;
  lightColor?: string;
  darkColor?: string;
  children?: React.ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
};

/**
 * Themed scroll view component. On iOS the system insets the content by the header, the tab bar and the safe area.
 */
export function ThemedScrollView({
  style,
  lightColor,
  darkColor,
  contentContainerStyle,
  keyboardShouldPersistTaps = 'handled',
  ...otherProps
}: ThemedScrollViewProps): React.ReactNode {
  return (
    <ScrollView
      style={[styles.container, Platform.OS === 'ios' ? null : styles.androidContainer, style]}
      contentContainerStyle={[Platform.OS === 'ios' ? styles.iosContent : styles.androidContent, contentContainerStyle]}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      {...otherProps}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  androidContainer: {
    paddingTop: 16,
  },
  androidContent: {
    paddingBottom: 40,
  },
  iosContent: {
    paddingBottom: 16,
    paddingTop: 16,
  },
});
