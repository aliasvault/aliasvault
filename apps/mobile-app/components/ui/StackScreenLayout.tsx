import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useColors } from '@/hooks/useColorScheme';

type StackScreenLayoutProps = {
  children: React.ReactNode;
  horizontalInsets?: boolean;
};

/**
 * Keeps the content of a stack screen inside the horizontal safe area (the iPhone Duo bar rail, the notch in landscape) while the background fills the screen.
 */
export function StackScreenLayout({ children, horizontalInsets = true }: StackScreenLayoutProps): React.ReactNode {
  const colors = useColors();
  return <SafeAreaView edges={horizontalInsets ? ['left', 'right'] : []} style={[styles.container, { backgroundColor: colors.background }]}>{children}</SafeAreaView>;
}

/**
 * The `screenLayout` of a Stack: wraps every screen in a StackScreenLayout.
 */
export function stackScreenLayout({ children }: { children: React.ReactElement }): React.ReactElement {
  return <StackScreenLayout>{children}</StackScreenLayout>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
