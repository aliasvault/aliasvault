import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useVerticalBarEdgeIOS } from 'expo-status-bar';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Toaster } from 'sonner-native';

import { useColors, useColorScheme } from '@/hooks/useColorScheme';
import { RAIL_EDGE_MARGIN } from '@/hooks/useFloatingBottomInset';

/** Height of the Material bottom navigation bar of the Android tabs. */
const ANDROID_TAB_BAR_HEIGHT = 80;

/**
 * Bottom offset of the toasts.
 */
function useToastBottomOffset(): number {
  const insets = useSafeAreaInsets();
  const railEdge = useVerticalBarEdgeIOS();
  if (Platform.OS === 'android') {
    return insets.bottom + ANDROID_TAB_BAR_HEIGHT + 16;
  }
  return railEdge ? RAIL_EDGE_MARGIN : insets.bottom + 60;
}

/**
 * App-wide toast host (sonner-native).
 */
export function AppToaster(): React.ReactNode {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const colorScheme = useColorScheme();
  const offset = useToastBottomOffset();
  return (
    <Toaster
      position="bottom-center"
      offset={offset}
      theme={colorScheme}
      duration={2500}
      positionerStyle={{ left: insets.left, right: insets.right, width: 'auto' }}
      toastOptions={{
        style: {
          backgroundColor: colors.modalSurfaceRaised,
          borderColor: colors.accentBorder,
          borderWidth: 1,
          elevation: 12,
          shadowColor: colors.black,
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: colorScheme === 'dark' ? 0.5 : 0.18,
          shadowRadius: 16,
        },
        titleStyle: { color: colors.text },
        descriptionStyle: { color: colors.textMuted },
      }}
      icons={{
        success: <MaterialIcons name="check-circle-outline" size={20} color={colors.primary} />,
        error: <MaterialIcons name="error-outline" size={20} color={colors.destructive} />,
        info: <MaterialIcons name="info-outline" size={20} color={colors.info} />,
        warning: <MaterialIcons name="warning-amber" size={20} color={colors.warning} />,
      }}
    />
  );
}
