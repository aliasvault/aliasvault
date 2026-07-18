import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, usePathname, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
import { Linking, Platform } from 'react-native';
import 'react-native-reanimated';
import 'react-native-get-random-values';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { install } from 'react-native-quick-crypto';

import { resolveDeepLink } from '@/utils/DeepLinkResolver';

import { useColors, useColorScheme } from '@/hooks/useColorScheme';

import SpaceMono from '@/assets/fonts/SpaceMono-Regular.ttf';
import { AliasVaultToast } from '@/components/Toast';
import { AppProvider } from '@/context/AppContext';
import { AuthProvider } from '@/context/AuthContext';
import { ClipboardCountdownProvider } from '@/context/ClipboardCountdownContext';
import { DbProvider } from '@/context/DbContext';
import { DialogProvider } from '@/context/DialogContext';
import { NavigationProvider, useNavigation } from '@/context/NavigationContext';
import { WebApiProvider } from '@/context/WebApiContext';
import { initI18n } from '@/i18n';
import { runStartupMigrations } from '@/migrations';

SplashScreen.preventAutoHideAsync();

/*
 * Install react-native-quick-crypto synchronously at module load.
 */
install();

/**
 * Root layout navigation.
 */
function RootLayoutNav() : React.ReactNode {
  const colorScheme = useColorScheme();
  const colors = useColors();
  const router = useRouter();
  const pathname = usePathname();
  const navigation = useNavigation();

  const hasBooted = useRef(false);
  const splashHidden = useRef(false);
  const { bootHandled } = navigation;

  useEffect(() => {
    if (hasBooted.current) {
      return;
    }
    hasBooted.current = true;

    /**
     * Initialize i18n and inspect the cold-start deep link in parallel.
     * One-time startup migrations run here too.
     * If a deep link is detected, set the return URL so after succesful
     * initialization, the app will navigate to the deep link target.
     */
    (async (): Promise<void> => {
      const [, initialUrl] = await Promise.all([initI18n(), Linking.getInitialURL(), runStartupMigrations()]);

      const resolved = await resolveDeepLink(initialUrl);
      if (resolved) {
        navigation.setReturnUrl(resolved);
      }
      router.replace('/initialize');

      navigation.markBootHandled();
    })();
  }, [navigation, router]);

  useEffect(() => {
    if (splashHidden.current || !bootHandled || !pathname || pathname === '/') {
      return;
    }
    splashHidden.current = true;
    SplashScreen.hideAsync();
  }, [bootHandled, pathname]);

  const customDefaultTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      primary: colors.primary,
      background: colors.background,
    },
  };

  const customDarkTheme = {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      primary: colors.primary,
      background: colors.background,
    },
  };

  return (
    <ThemeProvider value={colorScheme === 'dark' ? customDarkTheme : customDefaultTheme}>
      <Stack
        screenOptions={{
          headerShown: true,
          animation: 'none',
          headerTransparent: Platform.OS === 'ios',
          headerStyle: {
            backgroundColor: colors.accentBackground,
          },
          headerTintColor: colors.primary,
          headerTitleStyle: {
            color: colors.text,
          },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="initialize" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="login-settings" />
        <Stack.Screen name="reinitialize" options={{ headerShown: false }} />
        <Stack.Screen name="unlock" options={{ headerShown: false }} />
        <Stack.Screen name="upgrade" options={{ headerShown: false }} />
        <Stack.Screen name="vault-error" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="open/[...path]" options={{ headerShown: false }} />
        <Stack.Screen name="+not-found" />
      </Stack>
      <AliasVaultToast />
    </ThemeProvider>
  );
}

/**
 * Root layout.
 */
export default function RootLayout() : React.ReactNode {
  const [loaded] = useFonts({
    SpaceMono: SpaceMono,
  });

  if (!loaded) {
    return null;
  }

  return (
    <NavigationProvider>
      <DbProvider>
        <AuthProvider>
          <WebApiProvider>
            <AppProvider>
              <ClipboardCountdownProvider>
                <DialogProvider>
                  <GestureHandlerRootView>
                    <RootLayoutNav />
                  </GestureHandlerRootView>
                </DialogProvider>
              </ClipboardCountdownProvider>
            </AppProvider>
          </WebApiProvider>
        </AuthProvider>
      </DbProvider>
    </NavigationProvider>
  );
}
