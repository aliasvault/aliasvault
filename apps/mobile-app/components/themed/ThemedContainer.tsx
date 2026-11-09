import { StyleSheet, type ViewProps } from 'react-native';

import { useRailSideFlush } from '@/hooks/useRailSideFlush';

import { ThemedView } from '@/components/themed/ThemedView';

export type ThemedContainerProps = ViewProps;

/**
 * Themed container component which should be the outermost component of a screen.
 * It fills the screen under the transparent iOS header: a scroll view inside it is inset by the system
 * (automatic content insets), a non-scrolling screen pads by useHeaderInset() itself.
 */
export function ThemedContainer({ style, ...otherProps }: ThemedContainerProps): React.ReactNode {
  const railSideFlush = useRailSideFlush();
  return <ThemedView style={[styles.container, railSideFlush, style]} {...otherProps} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 14,
  },
});
