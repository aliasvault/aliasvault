import { useHeaderHeight } from 'expo-router/react-navigation';
import { Platform } from 'react-native';

/**
 * Height of the native header that overlaps the screen content: the transparent iOS header, 0 on Android where the header is opaque.
 */
export function useHeaderInset(): number {
  const headerHeight = useHeaderHeight();
  return Platform.OS === 'ios' ? headerHeight : 0;
}
