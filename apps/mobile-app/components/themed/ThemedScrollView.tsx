import { Platform, ScrollView, StyleProp, StyleSheet, ViewStyle, ScrollViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ThemedScrollViewProps = ScrollViewProps & {
  style?: StyleProp<ViewStyle>;
  lightColor?: string;
  darkColor?: string;
  children?: React.ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  scrollIndicatorInsets?: { top?: number; bottom?: number };
};

/**
 * Themed scroll view component.
 */
export function ThemedScrollView({
  style,
  lightColor,
  darkColor,
  contentContainerStyle,
  keyboardShouldPersistTaps = 'handled',
  ...otherProps
}: ThemedScrollViewProps): React.ReactNode {
  const insets = useSafeAreaInsets();

  const paddingTop = Platform.OS === 'ios' ? 56 : 16;
  const paddingBottom = Platform.OS === 'ios' ? insets.bottom + 60 : 40;

  return (
    <ScrollView
      style={[styles.container, { paddingTop: paddingTop }, style]}
      contentContainerStyle={[{ paddingBottom: paddingBottom }, contentContainerStyle]}
      scrollIndicatorInsets={{ bottom: paddingBottom }}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      {...otherProps}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});