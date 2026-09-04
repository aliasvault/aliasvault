import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Toast from 'react-native-toast-message';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedButton } from '@/components/themed/ThemedButton';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { AppReviewService, type AppReviewState } from '@/services/AppReviewService';
import { DeveloperToolsService } from '@/services/DeveloperToolsService';

/**
 * Row in one of the state readouts below.
 */
type StateRow = {
  label: string;
  value: string;
  met?: boolean;
};

/**
 * Developer tools screen. Note: not required to be translated.
 */
export default function DeveloperToolsScreen(): React.ReactNode {
  const colors = useColors();
  const [reviewState, setReviewState] = useState<AppReviewState | null>(null);

  const loadReviewState = useCallback(async (): Promise<void> => {
    setReviewState(await AppReviewService.getState());
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadReviewState();
    }, [loadReviewState])
  );

  /**
   * Ask the OS for its review prompt right now, skipping every condition.
   */
  const handleRequestReview = useCallback(async (): Promise<void> => {
    const requested = await AppReviewService.requestReviewNow();
  }, []);

  /**
   * Forget the recorded uses and asks, as if the app was freshly installed.
   */
  const handleResetReviewState = useCallback(async (): Promise<void> => {
    await AppReviewService.reset();
    await loadReviewState();

    Toast.show({
      type: 'success',
      text1: 'App review state reset',
      position: 'bottom',
      visibilityTime: 2000,
    });
  }, [loadReviewState]);

  /**
   * Hide the developer tools again, which also puts the unlock gesture back at the start. Useful
   * to get the app into a clean state for app store screenshots.
   */
  const handleHideDeveloperTools = useCallback(async (): Promise<void> => {
    await DeveloperToolsService.setEnabled(false);
    router.back();
  }, []);

  const reviewRows: StateRow[] = reviewState ? [
    {
      label: 'Review prompt available',
      value: reviewState.isAvailable ? 'Yes' : 'No',
      met: reviewState.isAvailable,
    },
    {
      label: 'Days installed',
      value: `${reviewState.daysInstalled} of ${reviewState.minDaysInstalled}`,
      met: reviewState.daysInstalled >= reviewState.minDaysInstalled,
    },
    {
      label: 'Successful uses',
      value: `${reviewState.useCount} of ${reviewState.minUseCount}`,
      met: reviewState.useCount >= reviewState.minUseCount,
    },
    {
      label: 'Days since last ask',
      value: reviewState.daysSinceLastPrompt === null
        ? 'Never asked'
        : `${reviewState.daysSinceLastPrompt} of ${reviewState.minDaysBetweenPrompts}`,
      met: reviewState.daysSinceLastPrompt === null
        || reviewState.daysSinceLastPrompt >= reviewState.minDaysBetweenPrompts,
    },
    {
      label: 'Asked for this version',
      value: reviewState.lastPromptVersion ?? 'Never asked',
      met: reviewState.lastPromptVersion !== reviewState.currentVersion,
    },
    {
      label: 'Would ask on next vault open',
      value: reviewState.meetsCriteria ? 'Yes' : 'No',
      met: reviewState.meetsCriteria,
    },
  ] : [];

  const styles = StyleSheet.create({
    button: {
      marginTop: 12,
      backgroundColor: colors.primary,
    },
    buttonSecondary: {
      marginTop: 12,
      backgroundColor: colors.accentBackground,
    },
    headerText: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 20,
    },
    row: {
      alignItems: 'center',
      borderBottomColor: colors.accentBorder,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    rowLabel: {
      color: colors.text,
      flex: 1,
      fontSize: 15,
    },
    rowLast: {
      borderBottomWidth: 0,
    },
    rowStatusIcon: {
      marginLeft: 8,
    },
    rowValue: {
      color: colors.textMuted,
      flexShrink: 1,
      fontSize: 15,
      textAlign: 'right',
    },
    section: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      marginTop: 8,
      overflow: 'hidden',
    },
    sectionTitle: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '600',
      marginTop: 24,
      textTransform: 'uppercase',
    },
  });

  return (
    <ThemedContainer>
      <ThemedScrollView>
        <ThemedText style={styles.headerText}>
          These tools are for development and manual testing purposes.
        </ThemedText>

        <ThemedText style={styles.sectionTitle}>App store review</ThemedText>
        {reviewRows.length > 0 && (
          <View style={styles.section}>
            {reviewRows.map((row, index) => (
              <View
                key={row.label}
                style={[styles.row, index === reviewRows.length - 1 && styles.rowLast]}
              >
                <ThemedText style={styles.rowLabel}>{row.label}</ThemedText>
                <ThemedText style={styles.rowValue}>{row.value}</ThemedText>
                <Ionicons
                  name={row.met ? 'checkmark-circle' : 'close-circle'}
                  size={18}
                  color={row.met ? colors.primary : colors.textMuted}
                  style={styles.rowStatusIcon}
                />
              </View>
            ))}
          </View>
        )}

        <ThemedButton
          style={styles.button}
          title="Trigger review prompt now"
          onPress={handleRequestReview}
        />
        <ThemedButton
          style={styles.buttonSecondary}
          title="Reset app review state"
          onPress={handleResetReviewState}
        />

        <ThemedText style={styles.sectionTitle}>Developer tools</ThemedText>
        <ThemedButton
          style={styles.buttonSecondary}
          title="Hide developer tools"
          onPress={handleHideDeveloperTools}
        />
      </ThemedScrollView>
    </ThemedContainer>
  );
}
