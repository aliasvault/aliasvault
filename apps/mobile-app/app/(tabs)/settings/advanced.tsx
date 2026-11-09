import { useState, useEffect } from 'react';
import { StyleSheet, View, Platform, Switch } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { IS_TWO_PANE_PLATFORM, useIsLargeScreen, useTwoPanePreference } from '@/hooks/useTwoPane';

import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * Advanced settings screen.
 */
export default function AdvancedSettingsScreen(): React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const [hideAppContents, setHideAppContents] = useState<boolean>(true);
  const [blockScreenshots, setBlockScreenshots] = useState<boolean>(true);
  const [twoPaneLayout, setTwoPaneLayout] = useTwoPanePreference();
  const isLargeScreen = useIsLargeScreen();

  useEffect(() => {
    /**
     * Load the current preferences, which the native layer stores and applies.
     */
    const loadPreferences = async (): Promise<void> => {
      setHideAppContents(await NativeVaultManager.getScreenCaptureProtection());
      if (Platform.OS === 'android') {
        setBlockScreenshots(await NativeVaultManager.getBlockScreenshots());
      }
    };

    loadPreferences();
  }, []);

  /**
   * Handle the hide app contents toggle.
   */
  const handleHideAppContentsChange = async (value: boolean): Promise<void> => {
    setHideAppContents(value);
    await NativeVaultManager.setScreenCaptureProtection(value);
  };

  /**
   * Handle the block screenshots toggle (Android only).
   */
  const handleBlockScreenshotsChange = async (value: boolean): Promise<void> => {
    setBlockScreenshots(value);
    await NativeVaultManager.setBlockScreenshots(value);
  };

  const styles = StyleSheet.create({
    optionDescription: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 20,
      marginTop: 8,
    },
    groupTitle: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '600',
      marginLeft: 16,
      marginTop: 8,
      textTransform: 'uppercase',
    },
    option: {
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    optionContainer: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      marginTop: 8,
      overflow: 'hidden',
    },
    optionRow: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    optionText: {
      color: colors.text,
      flex: 1,
      fontSize: 16,
    },
    separator: {
      backgroundColor: colors.accentBorder,
      height: StyleSheet.hairlineWidth,
      marginLeft: 16,
    },
  });

  return (
    <ThemedContainer>
      <ThemedScrollView>
        <ThemedText style={styles.groupTitle}>{t('settings.groups.screenPrivacy')}</ThemedText>
        <View style={styles.optionContainer}>
          <View style={styles.option}>
            <View style={styles.optionRow}>
              <ThemedText style={styles.optionText}>{t('settings.hideAppContents')}</ThemedText>
              <Switch
                testID="hide-app-contents-switch"
                value={hideAppContents}
                onValueChange={handleHideAppContentsChange}
                trackColor={{ false: colors.accentBorder, true: colors.primary }}
                thumbColor={colors.primarySurfaceText}
              />
            </View>
            <ThemedText style={styles.optionDescription}>{t('settings.hideAppContentsDescription')}</ThemedText>
          </View>
          {Platform.OS === 'android' && (
            <>
              <View style={styles.separator} />
              <View style={styles.option}>
                <View style={styles.optionRow}>
                  <ThemedText style={styles.optionText}>{t('settings.blockScreenshots')}</ThemedText>
                  <Switch
                    testID="block-screenshots-switch"
                    value={blockScreenshots}
                    onValueChange={handleBlockScreenshotsChange}
                    trackColor={{ false: colors.accentBorder, true: colors.primary }}
                    thumbColor={colors.primarySurfaceText}
                  />
                </View>
                <ThemedText style={styles.optionDescription}>{t('settings.blockScreenshotsDescription')}</ThemedText>
              </View>
            </>
          )}
        </View>
        {IS_TWO_PANE_PLATFORM && isLargeScreen && (
          <>
            <ThemedText style={styles.groupTitle}>{t('settings.appearance')}</ThemedText>
            <View style={styles.optionContainer}>
              <View style={styles.option}>
                <View style={styles.optionRow}>
                  <ThemedText style={styles.optionText}>{t('settings.twoColumnLayout')}</ThemedText>
                  <Switch
                    testID="two-column-layout-switch"
                    value={twoPaneLayout ?? true}
                    onValueChange={setTwoPaneLayout}
                    trackColor={{ false: colors.accentBorder, true: colors.primary }}
                    thumbColor={colors.primarySurfaceText}
                  />
                </View>
                <ThemedText style={styles.optionDescription}>{t('settings.twoColumnLayoutDescription')}</ThemedText>
              </View>
            </View>
          </>
        )}
      </ThemedScrollView>
    </ThemedContainer>
  );
}
