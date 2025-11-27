import { Ionicons } from '@expo/vector-icons';
import { Href, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useCallback, useRef } from 'react';
import { View, Alert, StyleSheet, Linking } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission, useCodeScanner } from 'react-native-vision-camera';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';

import LoadingIndicator from '@/components/LoadingIndicator';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedText } from '@/components/themed/ThemedText';

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
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const { url } = useLocalSearchParams<{ url?: string }>();
  const hasProcessedUrl = useRef(false);
  const processedUrls = useRef(new Set<string>());

  // Request camera permission on mount
  useEffect(() => {
    /**
     * Request camera permission.
     */
    const requestCameraPermission = async () : Promise<void> => {
      if (hasPermission === undefined) {
        return; // Still loading permission status
      }

      if (!hasPermission) {
        const permission = await requestPermission();

        if (!permission) {
          // Permission was denied
          Alert.alert(
            t('settings.qrScanner.cameraPermissionTitle'),
            t('settings.qrScanner.cameraPermissionMessage'),
            [
              { text: t('common.cancel'),
                /**
                 * Go back to the settings tab.
                 */
                onPress: (): void => router.back(),
                style: 'cancel'
              },
              {
                text: t('common.openSettings'),
                /**
                 * Open app settings.
                 */
                onPress: (): void => {
                  Linking.openSettings();
                  router.back();
                }
              }
            ]
          );
        }
      }
    };

    requestCameraPermission();
  }, [hasPermission, requestPermission, t]);

  /*
   * Handle barcode scanned - parse and navigate to appropriate page.
   * Only processes AliasVault QR codes, silently ignores others.
   * Validation is handled by the destination page.
   */
  const handleBarcodeScanned = useCallback((data: string) : void => {
    // Prevent processing the same URL multiple times
    if (processedUrls.current.has(data)) {
      return;
    }

    // Parse the QR code to determine its type
    const parsedData = parseQRCode(data);

    // Silently ignore non-AliasVault QR codes
    if (!parsedData.type) {
      return;
    }

    // Mark this URL as processed
    processedUrls.current.add(data);

    /*
     * Navigate to the appropriate page based on QR code type
     * Validation will be handled by the destination page
     */
    if (parsedData.type === 'MOBILE_UNLOCK') {
      router.replace(`/(tabs)/settings/mobile-unlock/${parsedData.payload}` as Href);
    }
  }, []);

  // Configure code scanner
  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    /**
     * Handle QR code scanned.
     * @param codes - Scanned codes.
     */
    onCodeScanned: (codes) => {
      if (codes.length > 0 && codes[0]?.value) {
        handleBarcodeScanned(codes[0].value);
      }
    },
  });

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
      handleBarcodeScanned(url);
    }
  }, [url, handleBarcodeScanned]);

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      paddingHorizontal: 0,
    },
    camera: {
      flex: 1,
    },
    cameraContainer: {
      backgroundColor: colors.black,
      flex: 1,
    },
    cameraOverlay: {
      alignItems: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      bottom: 0,
      justifyContent: 'center',
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    cameraOverlayText: {
      color: colors.white,
      fontSize: 16,
      marginTop: 20,
      paddingHorizontal: 40,
      textAlign: 'center',
    },
    closeButton: {
      position: 'absolute',
      right: 16,
      top: 16,
      zIndex: 10,
    },
    loadingContainer: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
      padding: 20,
    },
  });

  // Show permission request screen or loading if device not ready
  if (hasPermission === undefined || !hasPermission || !device) {
    return (
      <ThemedContainer>
        <View style={styles.loadingContainer}>
          <LoadingIndicator />
        </View>
      </ThemedContainer>
    );
  }

  return (
    <ThemedContainer style={styles.container}>
      <View style={styles.cameraContainer}>
        <Camera
          style={styles.camera}
          device={device}
          isActive={true}
          codeScanner={codeScanner}
        >
          <View style={styles.cameraOverlay}>
            <Ionicons name="qr-code-outline" size={100} color={colors.white} />
            <ThemedText style={styles.cameraOverlayText}>
              {t('settings.qrScanner.scanningMessage')}
            </ThemedText>
          </View>
        </Camera>
      </View>
    </ThemedContainer>
  );
}
