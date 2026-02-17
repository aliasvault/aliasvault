import { router, useLocalSearchParams } from 'expo-router';
import { useState, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import EncryptionUtility from '@/utils/EncryptionUtility';
import { VaultUnlockHelper } from '@/utils/VaultUnlockHelper';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';

import LoadingIndicator from '@/components/LoadingIndicator';
import { ThemedButton } from '@/components/themed/ThemedButton';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { UsernameDisplay } from '@/components/ui/UsernameDisplay';
import { useDialog } from '@/context/DialogContext';
import { useWebApi } from '@/context/WebApiContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * QR Code confirmation screen for mobile login.
 */
export default function MobileUnlockConfirmScreen() : React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const { showAlert } = useDialog();
  const webApi = useWebApi();
  const insets = useSafeAreaInsets();
  const { id, pk } = useLocalSearchParams<{ id: string; pk?: string }>();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isValidating, setIsValidating] = useState(true);

  /*
   * Validate request on component mount
   */
  useEffect(() => {
    if (!id) {
      showAlert(t('common.error'), t('common.errors.unknownErrorTryAgain'), () => router.back());
      return;
    }

    /**
     * Validate the mobile login request.
     */
    const validateRequest = async () : Promise<void> => {
      try {
        // Check server version compatibility first
        const isVersionSupported = await NativeVaultManager.isServerVersionGreaterThanOrEqualTo('0.25.0');

        if (!isVersionSupported) {
          showAlert(t('common.error'), t('common.errors.serverVersionTooOld'), () => router.back());
          return;
        }

        // Validate the request exists by fetching from server
        await webApi.authFetch<{ clientPublicKey: string }>(
          `auth/mobile-login/request/${id}`,
          { method: 'GET' }
        );

        // Request is valid
        setIsValidating(false);
      } catch (error) {
        console.error('Request validation error:', error);
        let errorMsg = t('common.errors.unknownErrorTryAgain');

        if (error instanceof Error && error.message.includes('404')) {
          errorMsg = t('settings.qrScanner.mobileLogin.requestExpired');
        }

        showAlert(t('common.error'), errorMsg, () => router.back());
      }
    };

    validateRequest();
  }, [id, webApi, showAlert, t]);

  /**
   * Handle mobile login QR code.
   * @param requestId - The request ID from the QR code
   * @param expectedPublicKeyHash - Optional public key hash from QR code for security verification
   */
  const handleMobileLogin = async (requestId: string, expectedPublicKeyHash?: string) : Promise<void> => {
    try {
      // Fetch the public key from server
      const response = await webApi.authFetch<{ clientPublicKey: string }>(
        `auth/mobile-login/request/${requestId}`,
        { method: 'GET' }
      );

      const publicKeyJWK = response.clientPublicKey;

      /*
       * Security verification: if QR code contained a public key hash, verify it matches what
       * the server provided.
       */
      if (expectedPublicKeyHash) {
        const computedHash = await EncryptionUtility.computeSha256Hash(publicKeyJWK);
        if (computedHash !== expectedPublicKeyHash) {
          console.error('Public key hash mismatch - possible security attack');
          throw new Error('PUBLIC_KEY_MISMATCH');
        }
      }
      /*
       * TODO: In v1.0+, remove backwards compatibility and require public key hash verification
       * for all QR codes.
       */
      // Encrypt the decryption key using native module
      const encryptedKey = await NativeVaultManager.encryptDecryptionKeyForMobileLogin(publicKeyJWK);

      // Submit the encrypted key to the server
      await webApi.authFetch(
        'auth/mobile-login/submit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requestId: requestId,
            encryptedDecryptionKey: encryptedKey,
          }),
        }
      );

      // Success! Navigate to result page
      router.replace({
        pathname: '/(tabs)/settings/mobile-unlock/result',
        params: {
          success: 'true',
          message: t('settings.qrScanner.mobileLogin.successDescription'),
        },
      });
    } catch (error) {
      console.error('Mobile login error:', error);

      // Error! Navigate to result page
      router.replace({
        pathname: '/(tabs)/settings/mobile-unlock/result',
        params: {
          success: 'false',
          message: t('common.errors.unknownErrorTryAgain'),
        },
      });
    }
  };

  /**
   * Handle confirmation - authenticate user first, then process the scanned QR code.
   */
  const handleConfirm = async () : Promise<void> => {
    if (!id) {
      return;
    }

    setIsProcessing(true);

    try {
      // Authenticate user with either biometric or PIN (automatically detected)
      const authenticated = await VaultUnlockHelper.authenticateForAction(
        t('settings.qrScanner.mobileLogin.confirmTitle'),
        t('settings.qrScanner.mobileLogin.confirmSubtitle')
      );

      if (!authenticated) {
        setIsProcessing(false);
        return;
      }

      // Process the mobile login with optional public key hash verification
      await handleMobileLogin(id as string, pk);
    } catch (error) {
      console.error('Authentication or QR code processing error:', error);
      showAlert(t('common.error'), error instanceof Error ? error.message : t('common.errors.unknownError'));
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * Handle dismiss - navigate to settings tab.
   * Uses replace to handle cases where this page is the first in the navigation stack (deep link).
   */
  const handleDismiss = () : void => {
    router.replace('/(tabs)/settings');
  };

  const styles = StyleSheet.create({
    confirmationContainer: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
      padding: 20,
    },
    confirmationTitle: {
      fontSize: 24,
      fontWeight: 'bold',
      marginBottom: 20,
      textAlign: 'center',
    },
    confirmationText: {
      fontSize: 16,
      lineHeight: 24,
      marginBottom: 16,
      textAlign: 'center',
    },
    usernameDisplayContainer: {
      marginBottom: 12,
      width: '100%',
    },
    buttonContainer: {
      gap: 12,
      marginTop: 20,
      paddingBottom: insets.bottom + 80,
      paddingHorizontal: 20,
    },
    button: {
      width: '100%',
    },
    cancelButton: {
      backgroundColor: colors.secondary,
    },
  });

  // Show loading during validation or processing
  if (isValidating || isProcessing) {
    return (
      <ThemedContainer>
        <View style={styles.confirmationContainer}>
          <LoadingIndicator />
        </View>
      </ThemedContainer>
    );
  }

  // Show confirmation screen
  return (
    <ThemedContainer>
      <ThemedScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View style={styles.confirmationContainer}>
          <ThemedText style={styles.confirmationTitle}>
            {t('settings.qrScanner.mobileLogin.confirmTitle')}
          </ThemedText>
          <ThemedText style={styles.confirmationText}>
            {t('settings.qrScanner.mobileLogin.confirmMessage')}
          </ThemedText>
          <View style={styles.usernameDisplayContainer}>
            <UsernameDisplay />
          </View>
        </View>

        <View style={styles.buttonContainer}>
          <ThemedButton
            title={t('common.confirm')}
            onPress={handleConfirm}
            style={styles.button}
          />
          <ThemedButton
            title={t('common.cancel')}
            onPress={handleDismiss}
            style={StyleSheet.flatten([styles.button, styles.cancelButton])}
          />
        </View>
      </ThemedScrollView>
    </ThemedContainer>
  );
}
