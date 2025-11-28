import { Href, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, Platform, Alert } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';

import LoadingIndicator from '@/components/LoadingIndicator';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedText } from '@/components/themed/ThemedText';
import NativeVaultManager from '@/specs/NativeVaultManager';

// QR Code type prefixes
const QR_CODE_PREFIXES = {
  MOBILE_UNLOCK: 'aliasvault://open/mobile-unlock/',
  /*
   * Future actions:
   * PASSKEY_AUTH: 'aliasvault://open/passkey-auth/',
   * SHARE_CREDENTIAL: 'aliasvault://open/share-credential/',
   */
} as const;

type QRCodeType = keyof typeof QR_CODE_PREFIXES;

/**
 * Scanned QR code data.
 */
type ScannedQRCode = {
  type: QRCodeType | null;
  payload: string;
  rawData: string;
}

/**
 * Parse QR code data and determine its type.
 */
function parseQRCode(data: string): ScannedQRCode {
  for (const [type, prefix] of Object.entries(QR_CODE_PREFIXES)) {
    if (data.startsWith(prefix)) {
      return {
        type: type as QRCodeType,
        payload: data.substring(prefix.length),
        rawData: data,
      };
    }
  }
  return { type: null, payload: data, rawData: data };
}

/**
 * General QR code scanner screen for AliasVault.
 */
export default function QRScannerScreen() : React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const { url } = useLocalSearchParams<{ url?: string }>();
  const hasProcessedUrl = useRef(false);
  const processedUrls = useRef(new Set<string>());
  const hasLaunchedScanner = useRef(false);

  /*
   * Handle barcode scanned - parse and navigate to appropriate page.
   * Native scanner already filters by prefix, so we only get AliasVault QR codes here.
   * Validation is handled by the destination page.
   */
  const handleQRCodeScanned = useCallback((data: string) : void => {
    // Prevent processing the same URL multiple times
    if (processedUrls.current.has(data)) {
      return;
    }

    // Mark this URL as processed
    processedUrls.current.add(data);

    // Parse the QR code to determine its type
    const parsedData = parseQRCode(data);

    /*
     * Navigate to the appropriate page based on QR code type
     * Use push instead of replace to navigate while scanner is still dismissing
     * This creates a smoother transition without returning to settings first
     */
    if (parsedData.type === 'MOBILE_UNLOCK') {
      router.push(`/(tabs)/settings/mobile-unlock/${parsedData.payload}` as Href);
    }
  }, []);

  /**
   * Launch the native QR scanner.
   */
  const launchScanner = useCallback(async () => {
    if (hasLaunchedScanner.current) {
      return;
    }

    hasLaunchedScanner.current = true;

    try {
      // Pass prefixes to native scanner for filtering and translated status text
      const prefixes = Object.values(QR_CODE_PREFIXES);
      const statusText = t('settings.qrScanner.scanningMessage');
      const scannedData = await NativeVaultManager.scanQRCode(prefixes, statusText);

      if (scannedData) {
        handleQRCodeScanned(scannedData);
      } else {
        // User cancelled or scan failed, go back
        router.back();
      }
    } catch (error) {
      console.error('QR scan error:', error);
      Alert.alert(
        t('common.error'),
        'Failed to scan QR code',
        [{ text: t('common.ok'), /**
         * Navigate back.
         */
          onPress: (): void => router.back() }]
      );
    }
  }, [handleQRCodeScanned, t]);

  /**
   * Reset hasProcessedUrl when URL changes to allow processing new URLs.
   */
  useEffect(() => {
    hasProcessedUrl.current = false;
  }, [url]);

  /**
   * Handle QR code URL passed from deep link (e.g., from native camera).
   */
  useEffect(() => {
    if (url && typeof url === 'string' && !hasProcessedUrl.current) {
      hasProcessedUrl.current = true;
      handleQRCodeScanned(url);
    }
  }, [url, handleQRCodeScanned]);

  /**
   * Launch scanner when component mounts (Android/iOS only).
   */
  useEffect(() => {
    if (Platform.OS === 'android' || Platform.OS === 'ios') {
      launchScanner();
    }
  }, [launchScanner]);

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      paddingHorizontal: 0,
    },
    loadingContainer: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
      padding: 20,
    },
  });

  // Show loading while scanner is launching
  return (
    <ThemedContainer style={styles.container}>
      <View style={styles.loadingContainer}>
        <LoadingIndicator />
        <ThemedText style={{ marginTop: 20, color: colors.textMuted }}>
          {t('settings.qrScanner.scanningMessage')}
        </ThemedText>
      </View>
    </ThemedContainer>
  );
}
