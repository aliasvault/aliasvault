import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, StyleSheet, View } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedSafeAreaView } from '@/components/themed/ThemedSafeAreaView';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';

/**
 * Confirmation screen shown after the user successfully linked an
 * autofill URL/package to an existing credential. Mirrors the
 * autofill-item-created pattern: auto-dismisses when the app is
 * sent to background so the user can return to the original app
 * and trigger autofill again.
 */
export default function AutofillUrlAddedScreen(): React.ReactNode {
  const router = useRouter();
  const colors = useColors();
  const { t } = useTranslation();
  const { itemName, itemUrl } = useLocalSearchParams<{
    itemName?: string;
    itemUrl?: string;
  }>();

  const decodedItemName = useMemo(() => {
    if (!itemName) {
      return t('items.untitled');
    }
    try {
      return decodeURIComponent(itemName);
    } catch {
      return itemName;
    }
  }, [itemName, t]);

  const decodedItemUrl = useMemo(() => {
    if (!itemUrl) {
      return '';
    }
    try {
      return decodeURIComponent(itemUrl);
    } catch {
      return itemUrl;
    }
  }, [itemUrl]);

  /*
   * Auto-dismiss when backgrounded so when the user comes back to the
   * app they see the items home rather than this success screen. The
   * stack was reset before navigating here, so router.back() pops
   * straight to the items list.
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
    boldMessage: {
      fontWeight: 'bold',
      marginTop: 20,
    },
    container: {
      flex: 1,
    },
    content: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
      padding: 24,
    },
    detailBox: {
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      marginBottom: 16,
      paddingHorizontal: 12,
      paddingVertical: 10,
      width: '100%',
    },
    detailLabel: {
      color: colors.textMuted,
      fontSize: 12,
      marginBottom: 2,
      textTransform: 'uppercase',
    },
    detailValue: {
      fontSize: 14,
      fontWeight: '600',
    },
    headerRightButton: {
      padding: 10,
      paddingRight: 0,
    },
    iconContainer: {
      marginBottom: 24,
    },
    message: {
      fontSize: 16,
      lineHeight: 24,
      marginBottom: 20,
      textAlign: 'center',
    },
    title: {
      fontSize: 24,
      fontWeight: 'bold',
      marginBottom: 16,
      textAlign: 'center',
    },
  });

  return (
    <ThemedSafeAreaView style={styles.container}>
      <ThemedView style={styles.content}>
        <View style={styles.iconContainer}>
          <MaterialIcons name="task-alt" size={80} color={colors.primary} />
        </View>

        <ThemedText style={styles.title}>{t('items.autofillUrlAdded.title')}</ThemedText>

        <ThemedText style={styles.message}>
          {t('items.autofillUrlAdded.message', { name: decodedItemName })}
        </ThemedText>

        {decodedItemUrl.length > 0 && (
          <View style={styles.detailBox}>
            <ThemedText style={styles.detailLabel}>
              {t('items.autofillOpenApp.appOrUrlLabel')}
            </ThemedText>
            <ThemedText style={styles.detailValue} numberOfLines={2}>
              {decodedItemUrl}
            </ThemedText>
          </View>
        )}

        <ThemedText style={[styles.message, styles.boldMessage]}>
          {t('items.switchBackToOriginalApp')}
        </ThemedText>
      </ThemedView>
    </ThemedSafeAreaView>
  );
}
