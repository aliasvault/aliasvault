import { ApiRequestError } from '@aliasvault/client/api/errors/ApiRequestError';
import { MobileLoginProtocol } from '@aliasvault/client/auth/MobileLoginProtocol';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState, useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MobileLoginScanHandoff, type PendingMobileLoginRequest } from '@/utils/MobileLoginScanHandoff';
import { VaultUnlockHelper } from '@/utils/VaultUnlockHelper';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';

import LoadingIndicator from '@/components/LoadingIndicator';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { AccountChip } from '@/components/ui/AccountChip';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { useDialog } from '@/context/DialogContext';
import { useWebApi } from '@/context/WebApiContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

import type { MobileLoginDetailsResponse, MobileLoginRequestReference, MobileLoginSubmitRequest } from '@aliasvault/models/webapi';

/**
 * A mobile login request whose public key was checked against the scanned QR code.
 */
type VerifiedRequest = {
  details: MobileLoginDetailsResponse;
  verificationCode: string;
  codeChoices: string[];
}

const CODE_CHOICE_COUNT = 4;

const RECENT_UNLOCK_GRACE_SECONDS = 10;

/**
 * The numbers the user picks from, which includes the real code as well as fakes that are shown on the originating device's screen,
 * this requires the user to visually verify the originating device with the mobile app unlock attempt.
 */
function buildCodeChoices(verificationCode: string) : string[] {
  const choices = new Set([verificationCode]);
  while (choices.size < CODE_CHOICE_COUNT) {
    const fake = Math.floor(Math.random() * 10 ** MobileLoginProtocol.VERIFICATION_CODE_LENGTH);
    choices.add(fake.toString().padStart(MobileLoginProtocol.VERIFICATION_CODE_LENGTH, '0'));
  }
  const shuffled = [...choices];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Show the result page.
 */
function showResult(success: boolean, reason?: 'codeMismatch') : void {
  router.replace({
    pathname: '/(tabs)/settings/mobile-unlock/result',
    params: { success: success ? 'true' : 'false', ...(reason ? { reason } : {}) },
  });
}

/**
 * Confirmation screen for a mobile login request.
 */
export default function MobileUnlockConfirmScreen() : React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const { showAlert } = useDialog();
  const webApi = useWebApi();
  const insets = useSafeAreaInsets();
  const [scan] = useState<PendingMobileLoginRequest | null>(() => MobileLoginScanHandoff.take());
  const [request, setRequest] = useState<VerifiedRequest | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const hasLoadedRequest = useRef(false);

  /*
   * Load the request and verify its public key on mount.
   */
  useEffect(() => {
    if (hasLoadedRequest.current) {
      return;
    }
    hasLoadedRequest.current = true;

    if (!scan) {
      // Opened without a pending request, e.g. through a plain route link. There is nothing to approve.
      router.replace('/(tabs)/settings');
      return;
    }

    /**
     * Fetch the request and accept it only when its public key is the one the QR code was made for.
     */
    const loadRequest = async () : Promise<void> => {
      try {
        const details = await webApi.post<MobileLoginRequestReference, MobileLoginDetailsResponse>('auth/mobile-login/details', { requestId: scan.requestId });

        if (!await MobileLoginProtocol.isExpectedPublicKey(details.clientPublicKey, scan.publicKeyHash)) {
          console.error('Mobile login public key does not match the scanned QR code');
          showResult(false);
          return;
        }

        const verificationCode = await MobileLoginProtocol.computeVerificationCode(details.clientPublicKey);
        setRequest({ details, verificationCode, codeChoices: buildCodeChoices(verificationCode) });
      } catch (error) {
        console.error('Mobile login request validation error:', error);
        const isExpired = error instanceof ApiRequestError && error.statusCode === 404;
        showAlert(t('common.error'), isExpired ? t('settings.qrScanner.mobileLogin.requestExpired') : t('common.errors.unknownErrorTryAgain'), () => router.replace('/(tabs)/settings'));
      }
    };

    loadRequest();
  }, [scan, webApi, showAlert, t]);

  /**
   * Decline the request.
   */
  const declineRequest = async () : Promise<void> => {
    if (!scan) {
      return;
    }
    try {
      await webApi.post<MobileLoginRequestReference, void>('auth/mobile-login/decline', { requestId: scan.requestId }, false);
    } catch (error) {
      console.error('Failed to decline mobile login request:', error);
    }
  };

  /**
   * Handle a tapped number: check it, re-authenticate the user, then hand over the unlock key.
   */
  const handleCodeChoice = async (chosenCode: string) : Promise<void> => {
    if (!scan || !request) {
      return;
    }

    setIsProcessing(true);

    try {
      // A wrong confirmation number results in a automatic decline for the mobile login request attempt.
      if (chosenCode !== request.verificationCode) {
        await declineRequest();
        showResult(false, 'codeMismatch');
        return;
      }

      const authenticated = await VaultUnlockHelper.authenticateForAction(
        t('settings.qrScanner.mobileLogin.confirmTitle'),
        t('settings.qrScanner.mobileLogin.confirmSubtitle'),
        null,
        null,
        RECENT_UNLOCK_GRACE_SECONDS
      );

      if (!authenticated) {
        return;
      }

      // Encrypt with the public key that was verified against the QR code.
      const encryptedUnlockKey = await NativeVaultManager.encryptUnlockKeyForMobileLogin(request.details.clientPublicKey);
      await webApi.post<MobileLoginSubmitRequest, void>('auth/mobile-login/submit', { requestId: scan.requestId, encryptedUnlockKey }, false);

      showResult(true);
    } catch (error) {
      console.error('Mobile login error:', error);
      showResult(false);
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * Handle decline: refuse the request and return to settings.
   */
  const handleDecline = async () : Promise<void> => {
    setIsProcessing(true);
    await declineRequest();
    router.replace('/(tabs)/settings');
  };

  const styles = StyleSheet.create({
    loadingContainer: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
    },
    content: {
      alignItems: 'center',
      flexGrow: 1,
      paddingBottom: insets.bottom + 80,
      paddingHorizontal: 6,
      paddingTop: 8,
    },
    accountChip: {
      marginBottom: 20,
    },
    message: {
      color: colors.textMuted,
      fontSize: 15,
      lineHeight: 22,
      marginBottom: 24,
      textAlign: 'center',
    },
    linkWarning: {
      alignItems: 'center',
      backgroundColor: colors.warningBackground,
      borderRadius: 12,
      flexDirection: 'row',
      gap: 12,
      marginBottom: 16,
      padding: 12,
      width: '100%',
    },
    linkWarningText: {
      flex: 1,
      fontSize: 14,
      lineHeight: 20,
    },
    detailsContainer: {
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 12,
      borderWidth: 1,
      gap: 14,
      marginBottom: 32,
      padding: 16,
      width: '100%',
    },
    detailRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
    },
    detailText: {
      flex: 1,
      fontSize: 15,
      lineHeight: 20,
    },
    codePrompt: {
      fontSize: 17,
      fontWeight: '600',
      lineHeight: 24,
      marginBottom: 16,
      textAlign: 'center',
    },
    codeChoiceRow: {
      flexDirection: 'row',
      gap: 14,
      justifyContent: 'center',
      marginBottom: 32,
      width: '100%',
    },
    codeChoice: {
      alignItems: 'center',
      aspectRatio: 1,
      backgroundColor: colors.accentBackground,
      borderColor: colors.primary,
      borderRadius: 999,
      borderWidth: 2,
      flex: 1,
      justifyContent: 'center',
      maxWidth: 72,
    },
    codeChoiceText: {
      fontSize: 24,
      fontWeight: 'bold',
      lineHeight: 30,
    },
    declineButton: {
      alignItems: 'center',
      backgroundColor: colors.destructive + '10',
      borderColor: colors.destructive,
      borderRadius: 8,
      borderWidth: 1,
      marginTop: 'auto',
      paddingVertical: 12,
      width: '100%',
    },
    declineButtonText: {
      color: colors.destructive,
      fontSize: 16,
      fontWeight: '500',
    },
  });

  // Show loading during validation or processing
  if (!request || isProcessing) {
    return (
      <ThemedContainer>
        <View style={styles.loadingContainer}>
          <LoadingIndicator />
        </View>
      </ThemedContainer>
    );
  }

  const { details } = request;
  const clientDescription = [details.clientName, [details.browser, details.operatingSystem].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  const ipDescription = [details.ipAddress, details.location ? `(${details.location})` : null].filter(Boolean).join(' ');

  // Show confirmation screen
  return (
    <ThemedContainer>
      <ThemedScrollView contentContainerStyle={styles.content}>
        <AccountChip style={styles.accountChip} />
        <ThemedText style={styles.message}>
          {t('settings.qrScanner.mobileLogin.confirmMessage')}
        </ThemedText>
        {/* Show an additional warning if the request was opened from a link (e.g. native camera app) as this could be a phishing attempt. */}
        {scan?.source === 'link' && (
          <View style={styles.linkWarning}>
            <Ionicons name="warning" size={20} color={colors.warning} />
            <ThemedText style={styles.linkWarningText}>{t('settings.qrScanner.mobileLogin.openedFromLink')}</ThemedText>
          </View>
        )}
        <View style={styles.detailsContainer}>
          {clientDescription.length > 0 && (
            <View style={styles.detailRow}>
              <Ionicons name="desktop-outline" size={20} color={colors.textMuted} />
              <ThemedText style={styles.detailText}>{clientDescription}</ThemedText>
            </View>
          )}
          {ipDescription.length > 0 && (
            <View style={styles.detailRow}>
              <Ionicons name="globe-outline" size={20} color={colors.textMuted} />
              <ThemedText style={styles.detailText}>{ipDescription}</ThemedText>
            </View>
          )}
          <View style={styles.detailRow}>
            <Ionicons name="time-outline" size={20} color={colors.textMuted} />
            <ThemedText style={styles.detailText}>{new Date(details.createdAt).toLocaleTimeString()}</ThemedText>
          </View>
        </View>
        <ThemedText style={styles.codePrompt}>
          {t('settings.qrScanner.mobileLogin.selectCode')}
        </ThemedText>
        <View style={styles.codeChoiceRow}>
          {request.codeChoices.map(choice => (
            <RobustPressable key={choice} style={styles.codeChoice} onPress={() => handleCodeChoice(choice)} testID={`mobile-login-code-choice-${choice}`}>
              <ThemedText style={styles.codeChoiceText}>{choice}</ThemedText>
            </RobustPressable>
          ))}
        </View>
        <RobustPressable style={styles.declineButton} onPress={handleDecline} testID="mobile-login-decline">
          <ThemedText style={styles.declineButtonText}>{t('common.cancel')}</ThemedText>
        </RobustPressable>
      </ThemedScrollView>
    </ThemedContainer>
  );
}
