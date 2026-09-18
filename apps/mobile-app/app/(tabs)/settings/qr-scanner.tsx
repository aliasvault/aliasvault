import { MobileLoginProtocol } from '@aliasvault/client/auth/MobileLoginProtocol';
import { router } from 'expo-router';
import { useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';

import { MobileLoginScanHandoff } from '@/utils/MobileLoginScanHandoff';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';

import LoadingIndicator from '@/components/LoadingIndicator';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedText } from '@/components/themed/ThemedText';
import { useDialog } from '@/context/DialogContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

/*
 * Prefixes the native scanner accepts. Future actions get their own prefix here, e.g.
 * 'aliasvault://open/passkey-auth/' or 'aliasvault://open/share-credential/'.
 */
const QR_CODE_PREFIXES = [MobileLoginProtocol.QR_PREFIX];

/**
 * General QR code scanner screen for AliasVault.
 */
export default function QRScannerScreen() : React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const { showAlert } = useDialog();
  const hasLaunchedScanner = useRef(false);

  /*
   * Handle a scanned QR code. Only codes read by the in-app camera get here: this screen takes no URL or route
   * params.
   */
  const handleQRCodeScanned = useCallback((data: string) : void => {
    const mobileLoginRequest = MobileLoginProtocol.parseQrPayload(data);
    if (!mobileLoginRequest) {
      showAlert(t('common.error'), t('common.errors.unknownErrorTryAgain'), () => router.back());
      return;
    }

    /*
     * Hand the request over in memory. Use push instead of replace to navigate while the scanner is still
     * dismissing, which gives a smoother transition without returning to settings first.
     */
    MobileLoginScanHandoff.set(mobileLoginRequest, 'scan');
    router.push('/(tabs)/settings/mobile-unlock/confirm');
  }, [showAlert, t]);

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
      const statusText = t('settings.qrScanner.scanningMessage');
      const scannedData = await NativeVaultManager.scanQRCode(QR_CODE_PREFIXES, statusText);

      if (scannedData) {
        handleQRCodeScanned(scannedData);
      } else {
        // User cancelled or scan failed, go back
        router.back();
      }
    } catch (error) {
      console.error('QR scan error:', error);
      showAlert(t('common.error'), 'Failed to scan QR code', () => router.back());
    }
  }, [handleQRCodeScanned, showAlert, t]);

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
