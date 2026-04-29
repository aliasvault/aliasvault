import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, StyleSheet, View } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedSafeAreaView } from '@/components/themed/ThemedSafeAreaView';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { RobustPressable } from '@/components/ui/RobustPressable';

/**
 * Landing screen shown when the user opens AliasVault from the Android
 * autofill popup, either via the "Open app" button or via "No match
 * found". The screen is intentionally neutral so it works in both
 * cases (no match, or there are matches but the user wants to do
 * something else, like add a second account or link a new app
 * identifier to an existing credential).
 *
 * Lets the user choose between:
 *  - Linking an existing credential (so the app's package/URL is added
 *    to that credential and future autofill prompts succeed
 *    automatically), or
 *  - Creating a brand-new credential pre-filled with the app's URL.
 *
 * The user can dismiss via the system back arrow if neither applies.
 */
export default function AutofillOpenAppScreen(): React.ReactNode {
  const router = useRouter();
  const colors = useColors();
  const { t } = useTranslation();
  const { itemUrl } = useLocalSearchParams<{ itemUrl?: string }>();

  const decodedAppInfo = useMemo(() => {
    if (!itemUrl) {
      return '';
    }
    try {
      return decodeURIComponent(itemUrl);
    } catch {
      return itemUrl;
    }
  }, [itemUrl]);

  /**
   * Navigate to the credential picker so the user can attach this URL
   * to an already-existing credential.
   */
  const handleFindExisting = useCallback(() => {
    router.push(
      `/(tabs)/items/autofill-link-existing?itemUrl=${encodeURIComponent(decodedAppInfo)}`
    );
  }, [router, decodedAppInfo]);

  /**
   * Navigate to the existing add-edit-page deep-link target with the
   * URL pre-populated, mirroring the previous behaviour.
   */
  const handleCreateNew = useCallback(() => {
    router.replace(
      `/(tabs)/items/add-edit-page?itemUrl=${encodeURIComponent(decodedAppInfo)}`
    );
  }, [router, decodedAppInfo]);

  /**
   * Auto-dismiss when the app goes to the background — matches the
   * pattern in autofill-item-created so users can't get stuck here.
   */
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'background') {
        router.back();
      }
    });
    return (): void => {
      subscription.remove();
    };
  }, [router]);

  const styles = StyleSheet.create({
    actionDescription: {
      color: colors.textMuted,
      fontSize: 14,
      lineHeight: 20,
      marginTop: 4,
    },
    actionRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 16,
    },
    actionTextWrapper: {
      flex: 1,
    },
    actionTitle: {
      fontSize: 16,
      fontWeight: '600',
    },
    appInfoBox: {
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      marginBottom: 24,
      paddingHorizontal: 12,
      paddingVertical: 10,
      width: '100%',
    },
    appInfoLabel: {
      color: colors.textMuted,
      fontSize: 12,
      marginBottom: 2,
      textTransform: 'uppercase',
    },
    appInfoValue: {
      fontSize: 16,
      fontWeight: '600',
    },
    container: {
      flex: 1,
    },
    content: {
      alignItems: 'stretch',
      flex: 1,
      paddingHorizontal: 20,
      paddingTop: 24,
    },
    introText: {
      color: colors.textMuted,
      fontSize: 15,
      lineHeight: 22,
      marginBottom: 20,
      textAlign: 'center',
    },
    optionCard: {
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 12,
      borderWidth: 1,
      marginBottom: 12,
      padding: 16,
    },
    optionIconWrapper: {
      alignItems: 'center',
      backgroundColor: colors.background,
      borderRadius: 24,
      height: 48,
      justifyContent: 'center',
      width: 48,
    },
    optionPrimaryIconWrapper: {
      alignItems: 'center',
      backgroundColor: colors.primary + '20',
      borderRadius: 24,
      height: 48,
      justifyContent: 'center',
      width: 48,
    },
  });

  return (
    <ThemedSafeAreaView style={styles.container}>
      <ThemedView style={styles.content}>
        <ThemedText style={styles.introText}>
          {t('items.autofillOpenApp.description')}
        </ThemedText>

        {decodedAppInfo.length > 0 && (
          <View style={styles.appInfoBox}>
            <ThemedText style={styles.appInfoLabel}>
              {t('items.autofillOpenApp.appOrUrlLabel')}
            </ThemedText>
            <ThemedText style={styles.appInfoValue} numberOfLines={2}>
              {decodedAppInfo}
            </ThemedText>
          </View>
        )}

        <RobustPressable
          style={styles.optionCard}
          onPress={handleFindExisting}
          testID="autofill-find-existing-button"
        >
          <View style={styles.actionRow}>
            <View style={styles.optionPrimaryIconWrapper}>
              <MaterialIcons name="link" size={26} color={colors.primary} />
            </View>
            <View style={styles.actionTextWrapper}>
              <ThemedText style={styles.actionTitle}>
                {t('items.autofillOpenApp.findExistingTitle')}
              </ThemedText>
              <ThemedText style={styles.actionDescription}>
                {t('items.autofillOpenApp.findExistingDescription')}
              </ThemedText>
            </View>
            <MaterialIcons name="chevron-right" size={24} color={colors.textMuted} />
          </View>
        </RobustPressable>

        <RobustPressable
          style={styles.optionCard}
          onPress={handleCreateNew}
          testID="autofill-create-new-button"
        >
          <View style={styles.actionRow}>
            <View style={styles.optionIconWrapper}>
              <MaterialIcons name="add" size={26} color={colors.text} />
            </View>
            <View style={styles.actionTextWrapper}>
              <ThemedText style={styles.actionTitle}>
                {t('items.autofillOpenApp.createNewTitle')}
              </ThemedText>
              <ThemedText style={styles.actionDescription}>
                {t('items.autofillOpenApp.createNewDescription')}
              </ThemedText>
            </View>
            <MaterialIcons name="chevron-right" size={24} color={colors.textMuted} />
          </View>
        </RobustPressable>
      </ThemedView>
    </ThemedSafeAreaView>
  );
}
