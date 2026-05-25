import { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useColors } from '@/hooks/useColorScheme';

type ThemedSafeAreaViewProps = {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
};

/**
 * Themed safe area view component.
 */
export function ThemedSafeAreaView({
  style,
  children,
  ...otherProps
}: ThemedSafeAreaViewProps): React.ReactNode {
  const colors = useColors();

  return (
    <SafeAreaView
      style={[{ backgroundColor: colors.background }, style]}
      {...otherProps}
    >
      {children}
    </SafeAreaView>
  );
}