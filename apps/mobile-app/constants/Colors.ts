import { ThemeColors as SharedColors } from '@aliasvault/models/colors';

/**
 * The colors used in the app, per color scheme. The shared theme colors come from core/models/src/colors/palette.json,
 * the keys below them are specific to the React Native app.
 */
export const Colors = {
  light: {
    ...SharedColors.light,
    white: '#ffffff',
    errorBackground: '#f8d7da',
    errorBorder: '#f8d7da',
    errorText: '#842029',
    tint: SharedColors.light.primary,
    tabIconDefault: SharedColors.light.icon,
    tabIconSelected: SharedColors.light.primary,
    headerBackgroundAndroid: SharedColors.light.background,
    headerBackgroundIos: 'rgba(255, 255, 255, 0.7)',
    headerBorder: '#eae9eb',
    tabBarBackground: '#fff',
    loginHeader: '#f6dfc4',
    greenBackground: '#22c55e',
    skeleton: 'rgba(98, 98, 98, 0.33)',
    red: '#ff0000',
    black: '#000000',
    modalBackground: 'rgba(75, 85, 99, 0.6)',
    modalSurface: SharedColors.light.background,
    modalSurfaceRaised: '#ffffff',
  },
  dark: {
    ...SharedColors.dark,
    white: '#ffffff',
    errorBackground: '#3d1a1e',
    errorBorder: '#9c2530',
    errorText: '#fae1e3',
    tint: SharedColors.dark.primary,
    tabIconDefault: SharedColors.dark.icon,
    tabIconSelected: SharedColors.dark.primary,
    headerBackgroundAndroid: SharedColors.dark.background,
    headerBackgroundIos: 'rgba(0, 0, 0, 0.3)',
    headerBorder: '#2f2e30',
    tabBarBackground: '#000000',
    loginHeader: '#5c4331',
    greenBackground: '#22c55e',
    skeleton: 'rgba(255, 255, 255, 0.2)',
    red: '#ff0000',
    black: '#000000',
    modalBackground: 'rgba(0, 0, 0, 0.7)',
    modalSurface: '#1c1c1e',
    modalSurfaceRaised: '#2c2c2e',
  },
} as const;

// Export the type for TypeScript support
export type ThemeColors = typeof Colors.light;
