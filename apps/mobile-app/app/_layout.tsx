import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Href, Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Platform } from 'react-native';
import 'react-native-reanimated';
import 'react-native-get-random-values';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { install } from 'react-native-quick-crypto';

import { useColors, useColorScheme } from '@/hooks/useColorScheme';

import SpaceMono from '@/assets/fonts/SpaceMono-Regular.ttf';
import { ThemedView } from '@/components/themed/ThemedView';
import { AliasVaultToast } from '@/components/Toast';
import { AppProvider } from '@/context/AppContext';
import { AuthProvider } from '@/context/AuthContext';
import { ClipboardCountdownProvider } from '@/context/ClipboardCountdownContext';
import { DbProvider } from '@/context/DbContext';
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

  const [bootComplete, setBootComplete] = useState(false);
  const [redirectTarget, setRedirectTarget] = useState<string | null>(null);
  const hasBooted = useRef(false);

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

      // Initialize i18n and wait for it to be ready
      await initI18n();

      hasBooted.current = true;
      setRedirectTarget('/initialize');
      setBootComplete(true);
    };

    initializeApp();
  }, []);

  useEffect(() => {
    /**
     * Redirect to a explicit target page if we have one (in case of non-happy path).
     * Otherwise check for a deep link and simulate stack navigation.
     * If neither is present, we let the router redirect us to the default route.
     */
    const redirect = async () : Promise<void> => {
      if (!bootComplete) {
        return;
      }

      if (redirectTarget) {
        // If we have an explicit redirect target, we navigate to it. This overrides potential deep link handling.
        router.replace(redirectTarget as Href);
      } else {
        // Check if we have an initial URL to handle (deep link from most likely the autofill extension).
        const initialUrl = await Linking.getInitialURL();
        if (initialUrl) {
          /**
           * Check for certain supported deep link routes, and if found, ensure we simulate the stack navigation
           * as otherwise the "back" button for navigation will not work as expected.
           */
          const path = initialUrl.replace('net.aliasvault.app://', '');
          const isDetailRoute = path.includes('credentials/');
          if (isDetailRoute) {
            // First go to the credentials tab.
            router.replace('/(tabs)/credentials');

            // Then push the target route inside the credentials tab.
            setTimeout(() => {
              router.push(path as Href);
            }, 0);
          }
        }
      }
    };

    redirect();
  }, [bootComplete, redirectTarget, router]);

  const styles = StyleSheet.create({
    container: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
    },
  });

  if (!bootComplete) {
    return (
      <ThemedView style={styles.container}>
        {/* Loading state while booting */}
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

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <DbProvider>
      <AuthProvider>
        <WebApiProvider>
          <AppProvider>
            <ClipboardCountdownProvider>
              <KeyboardProvider>
                <GestureHandlerRootView>
                  <RootLayoutNav />
                </GestureHandlerRootView>
              </KeyboardProvider>
            </ClipboardCountdownProvider>
          </AppProvider>
        </WebApiProvider>
      </AuthProvider>
    </DbProvider>
  );
}
