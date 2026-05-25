import { useFonts } from 'expo-font';
import { Href, DarkTheme, DefaultTheme, Stack, ThemeProvider, usePathname, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Platform } from 'react-native';
import 'react-native-reanimated';
import 'react-native-get-random-values';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { install } from 'react-native-quick-crypto';

import { useColors, useColorScheme } from '@/hooks/useColorScheme';

import SpaceMono from '@/assets/fonts/SpaceMono-Regular.ttf';
import LoadingIndicator from '@/components/LoadingIndicator';
import { ThemedView } from '@/components/themed/ThemedView';
import { AliasVaultToast } from '@/components/Toast';
import { AppProvider } from '@/context/AppContext';
import { AuthProvider } from '@/context/AuthContext';
import { ClipboardCountdownProvider } from '@/context/ClipboardCountdownContext';
import { DbProvider } from '@/context/DbContext';
import { DialogProvider } from '@/context/DialogContext';
import { NavigationProvider, useNavigation } from '@/context/NavigationContext';
import { WebApiProvider } from '@/context/WebApiContext';
import { initI18n } from '@/i18n';

SplashScreen.preventAutoHideAsync();

/**
 * Root layout navigation.
 */
function RootLayoutNav() : React.ReactNode {
  const colorScheme = useColorScheme();
  const colors = useColors();
  const router = useRouter();
  const pathname = usePathname();
  const navigation = useNavigation();

  const [bootComplete, setBootComplete] = useState(false);
  const hasBooted = useRef(false);
  const splashHidden = useRef(false);
  const pendingActionPath = useRef<string | null>(null);

  useEffect(() => {
    /*
     * Keep the native splash visible until we're navigating to a real destination route.
     */
    if (splashHidden.current || !bootComplete || !pathname) {
      return;
    }
    if (pathname === '/') {
      return;
    }
    splashHidden.current = true;
    SplashScreen.hideAsync();
  }, [bootComplete, pathname]);

  useEffect(() => {
    /**
     * Initialize the app by redirecting to the initialize page.
     */
    const initializeApp = async () : Promise<void> => {
      if (hasBooted.current) {
        return;
      }

      // Install the react-native-quick-crypto library which is used by the EncryptionUtility
      install();

      // Run i18n init and deep link lookup in parallel
      const [, initialUrl] = await Promise.all([initI18n(), Linking.getInitialURL()]);

      hasBooted.current = true;
      if (initialUrl) {
        const path = initialUrl
          .replace('net.aliasvault.app://', '')
          .replace('aliasvault://', '')
          .replace('exp+aliasvault://', '');

        /*
         * Action URLs (open/...) are owned by the /open/[...path] route (ActionHandler).
         * We route there explicitly in the redirect effect below instead of going via
         * the NavigationContext. This prevents double navigation after vault unlock.
         */
        if (path.startsWith('open/')) {
          pendingActionPath.current = path;
        } else {
          navigation.setReturnUrl({ path });
        }
      }

      setBootComplete(true);
    };

    initializeApp();
  }, [navigation, router]);

  useEffect(() => {
    /*
     * If a deep-link action path was captured during boot, jump straight to it.
     * Otherwise let index.tsx handle the redirect to /initialize so we don't
     * fire a redundant navigation that races the <Redirect>.
     */
    if (!bootComplete || !pendingActionPath.current) {
      return;
    }

    router.replace(`/${pendingActionPath.current}` as Href);
  }, [bootComplete, router]);

  const styles = StyleSheet.create({
    container: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'flex-start',
      paddingHorizontal: 20,
      paddingTop: '40%',
    },
  });

  if (!bootComplete) {
    return (
      <ThemedView style={styles.container}>
        {/* Loading state while booting */}
        <LoadingIndicator />
      </ThemedView>
    );
  }

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
