import { sharingText } from '@aliasvault/client/sharing/SharingView';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import { AccountFingerprint } from '@/components/sharing/AccountFingerprint';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * How folder sharing works, with this account's fingerprint to hand out.
 */
export default function FolderSharingScreen(): React.ReactNode {
  const colors = useColors();
  const [ownFingerprint, setOwnFingerprint] = useState<string | null>(null);

  useEffect(() => {
    NativeVaultManager.getSigningKeyFingerprint().then(setOwnFingerprint).catch(() => setOwnFingerprint(null));
  }, []);

  const styles = StyleSheet.create({
    card: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      marginTop: 16,
      padding: 16,
    },
    cardTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 12,
    },
    fingerprint: {
      marginTop: 16,
    },
    fingerprintLabel: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 8,
    },
    hint: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 8,
    },
    intro: {
      color: colors.textMuted,
      fontSize: 14,
      lineHeight: 20,
    },
    step: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      marginBottom: 10,
    },
    stepNumber: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 11,
      height: 22,
      justifyContent: 'center',
      marginRight: 10,
      width: 22,
    },
    stepNumberText: {
      color: colors.primarySurfaceText,
      fontSize: 12,
      fontWeight: '600',
      lineHeight: 16,
    },
    stepText: {
      color: colors.text,
      flex: 1,
      fontSize: 14,
      lineHeight: 20,
    },
  });

  /**
   * A titled card with a numbered list of steps.
   */
  const renderSteps = (title: string, steps: readonly string[]): React.ReactNode => (
    <View style={styles.card}>
      <ThemedText style={styles.cardTitle}>{title}</ThemedText>
      {steps.map((step, index) => (
        <View key={step} style={styles.step}>
          <View style={styles.stepNumber}>
            <ThemedText style={styles.stepNumberText}>{index + 1}</ThemedText>
          </View>
          <ThemedText style={styles.stepText}>{step}</ThemedText>
        </View>
      ))}
    </View>
  );

  return (
    <ThemedContainer>
      <ThemedScrollView>
        <ThemedText style={styles.intro}>{sharingText.folderSharingIntro}</ThemedText>

        {ownFingerprint && (
          <View style={styles.fingerprint} testID="own-account-fingerprint-card">
            <ThemedText style={styles.fingerprintLabel}>{sharingText.yourFingerprint}</ThemedText>
            <AccountFingerprint code={ownFingerprint} variant="bar" />
            <ThemedText style={styles.hint}>{sharingText.yourFingerprintSettingsHint}</ThemedText>
          </View>
        )}

        {renderSteps(sharingText.shareFolderStepsTitle, sharingText.shareFolderSteps)}
        {renderSteps(sharingText.joinFolderStepsTitle, sharingText.joinFolderSteps)}
      </ThemedScrollView>
    </ThemedContainer>
  );
}
