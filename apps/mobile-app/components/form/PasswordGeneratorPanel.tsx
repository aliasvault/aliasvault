import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, TouchableOpacity, View } from 'react-native';

import type { PasswordSettings, DicewareCapitalization, DicewareSeparator, DicewareSalt } from '@/utils/dist/core/models/vault';
import { MIN_WORD_COUNT, MAX_WORD_COUNT, DEFAULT_WORD_COUNT, getLanguageInfo, resolveDefaultLanguage } from '@/utils/dist/core/models/defaults';
import { sliderToLength, lengthToSlider, SLIDER_MIN, SLIDER_MAX } from '@/utils/PasswordLengthSlider';
import * as PasswordGenerator from '@/utils/PasswordGeneratorUtility';

import { useColors } from '@/hooks/useColorScheme';

import { ModalWrapper } from '@/components/common/ModalWrapper';
import { ThemedText } from '@/components/themed/ThemedText';

const CAPITALIZATION_OPTIONS: DicewareCapitalization[] = ['Lowercase', 'TitleCase', 'Uppercase'];
const SEPARATOR_OPTIONS: DicewareSeparator[] = ['Dash', 'Space', 'Underscore', 'Dot', 'None'];
const SALT_OPTIONS: DicewareSalt[] = ['None', 'Prefix', 'Sprinkle', 'Suffix'];

/**
 * Cycle through a list of options.
 */
function cycle<T>(options: T[], current: T): T {
  const index = options.indexOf(current);
  return options[(index + 1) % options.length];
}

interface IPasswordGeneratorPanelProps {
  initialSettings: PasswordSettings;
  onSettingsChange: (settings: PasswordSettings) => void;
  onPreviewChange?: (password: string) => void;
  footer?: React.ReactNode;
}

/**
 * Shared password generator configuration panel (preview, type switcher, type options).
 */
export function PasswordGeneratorPanel({ initialSettings, onSettingsChange, onPreviewChange, footer }: IPasswordGeneratorPanelProps): React.ReactNode {
  const colors = useColors();
  const { t, i18n } = useTranslation();

  const [settings, setSettings] = useState<PasswordSettings>(initialSettings);
  const [previewPassword, setPreviewPassword] = useState<string>('');
  const [dicewareLanguages, setDicewareLanguages] = useState<string[]>([]);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [lengthSlider, setLengthSlider] = useState<number>(lengthToSlider(initialSettings.Length));
  const seedRef = useRef<string>('');

  const isDiceware = settings.Type === 'diceware';
  const currentLanguage = (settings.Language && settings.Language.length > 0) ? settings.Language : resolveDefaultLanguage(i18n.language, dicewareLanguages);

  const generatePreview = useCallback(async (currentSettings: PasswordSettings, seed: string): Promise<void> => {
    try {
      const password = await PasswordGenerator.generatePassword(currentSettings, seed);
      setPreviewPassword(password);
      onPreviewChange?.(password);
    } catch (error) {
      console.error('Error generating preview password:', error);
    }
  }, [onPreviewChange]);

  // Initialize the seed + preview on mount, and load the available languages.
  useEffect(() => {
    seedRef.current = PasswordGenerator.generateSeed();
    void generatePreview(initialSettings, seedRef.current);
    let cancelled = false;
    void PasswordGenerator.getDicewareLanguages().then((languages) => {
      if (!cancelled) {
        setDicewareLanguages(languages);
      }
    });
    return (): void => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Apply a settings change: update local state, notify the parent, and regenerate the preview with
   * the stable seed so only the changed option affects the output.
   */
  const applyChange = useCallback((changed: Partial<PasswordSettings>): void => {
    setSettings((prev) => {
      const next = { ...prev, ...changed };
      void generatePreview(next, seedRef.current);
      onSettingsChange(next);
      return next;
    });
  }, [generatePreview, onSettingsChange]);

  /**
   * Draw a fresh seed and regenerate the preview (a genuinely new password).
   */
  const handleRefreshPreview = useCallback((): void => {
    seedRef.current = PasswordGenerator.generateSeed();
    void generatePreview(settings, seedRef.current);
  }, [generatePreview, settings]);

  const handleLengthSlider = useCallback((value: number): void => {
    setLengthSlider(value);
    applyChange({ Length: sliderToLength(value) });
  }, [applyChange]);

  const handleSelectLanguage = useCallback((code: string): void => {
    applyChange({ Language: code });
    setShowLanguageModal(false);
  }, [applyChange]);

  const styles = useMemo(() => StyleSheet.create({
    card: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      marginBottom: 16,
      paddingHorizontal: 16,
    },
    chip: {
      backgroundColor: colors.background,
      borderColor: colors.accentBorder,
      borderRadius: 6,
      borderWidth: 1,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    chipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    chipText: {
      color: colors.text,
      fontSize: 14,
    },
    languageRow: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 12,
    },
    languageValue: {
      alignItems: 'center',
      flexDirection: 'row',
    },
    languageValueText: {
      color: colors.textMuted,
      fontSize: 15,
      marginRight: 6,
    },
    optionRow: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 10,
    },
    pickerItem: {
      alignItems: 'center',
      borderBottomColor: colors.accentBorder,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 14,
    },
    pickerItemText: {
      color: colors.text,
      fontSize: 16,
    },
    pickerTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 12,
      marginTop: 10,
    },
    previewContainer: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 6,
      borderWidth: 1,
      flexDirection: 'row',
      marginBottom: 16,
    },
    previewText: {
      color: colors.text,
      flex: 1,
      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
      fontSize: 14,
      padding: 12,
      textAlign: 'center',
    },
    refreshButton: {
      borderLeftColor: colors.accentBorder,
      borderLeftWidth: 1,
      padding: 10,
    },
    rowDivider: {
      borderTopColor: colors.accentBorder,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    sectionLabel: {
      color: colors.textMuted,
      fontSize: 13,
      marginBottom: 4,
    },
    slider: {
      height: 40,
      width: '100%',
    },
    sliderHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    sliderLabel: {
      color: colors.text,
      fontSize: 16,
    },
    sliderSection: {
      marginBottom: 8,
      paddingTop: 12,
    },
    sliderValue: {
      color: colors.primary,
      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
      fontSize: 16,
      fontWeight: '600',
    },
    tab: {
      alignItems: 'center',
      borderRadius: 7,
      flex: 1,
      paddingVertical: 8,
    },
    tabActive: {
      backgroundColor: colors.primary,
    },
    tabRow: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      flexDirection: 'row',
      marginBottom: 16,
      padding: 4,
    },
    tabText: {
      color: colors.textMuted,
      fontSize: 15,
      fontWeight: '500',
    },
    tabTextActive: {
      color: colors.primarySurfaceText,
    },
    toggleRow: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 10,
    },
    valuePill: {
      backgroundColor: colors.background,
      borderColor: colors.accentBorder,
      borderRadius: 6,
      borderWidth: 1,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    valuePillText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '500',
    },
  }), [colors]);

  /**
   * Render a labelled row whose value pill cycles through the given options on tap.
   */
  const renderCycleRow = (
    label: string,
    optionGroup: 'Capitalization' | 'Separator' | 'Salt',
    value: string,
    onCycle: () => void
  ): React.ReactNode => (
    <View style={[styles.optionRow, styles.rowDivider]}>
      <ThemedText style={styles.sliderLabel}>{label}</ThemedText>
      <TouchableOpacity style={styles.valuePill} onPress={onCycle} activeOpacity={0.7}>
        <ThemedText style={styles.valuePillText}>
          {value === 'None' ? t('common.none') : t(`items.diceware${optionGroup}Option.${value}`)}
        </ThemedText>
      </TouchableOpacity>
    </View>
  );

  return (
    <View>
      {/* Type switcher (Basic | Passphrase). */}
      <View style={styles.tabRow}>
        {(['basic', 'diceware'] as PasswordGeneratorType[]).map((mode) => {
          const active = (settings.Type ?? 'basic') === mode;
          return (
            <TouchableOpacity
              key={mode}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => applyChange({ Type: mode })}
              activeOpacity={0.7}
            >
              <ThemedText style={[styles.tabText, active && styles.tabTextActive]}>
                {mode === 'basic' ? t('items.passwordTypeBasic') : t('items.passwordTypeDiceware')}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Preview. */}
      <View style={styles.previewContainer}>
        <ThemedText style={styles.previewText} numberOfLines={1} ellipsizeMode="tail">
          {previewPassword}
        </ThemedText>
        <TouchableOpacity style={styles.refreshButton} onPress={handleRefreshPreview} activeOpacity={0.7}>
          <Ionicons name="refresh" size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {!isDiceware ? (
        <View style={styles.card}>
          {/* Length slider. */}
          <View style={styles.sliderSection}>
            <View style={styles.sliderHeader}>
              <ThemedText style={styles.sliderLabel}>{t('items.passwordLength')}</ThemedText>
              <ThemedText style={styles.sliderValue}>{settings.Length}</ThemedText>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={SLIDER_MIN}
              maximumValue={SLIDER_MAX}
              value={lengthSlider}
              onValueChange={handleLengthSlider}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={colors.accentBorder}
              thumbTintColor={colors.primary}
            />
          </View>

          {/* Character-class toggles. */}
          {([
            ['UseLowercase', t('items.includeLowercase')],
            ['UseUppercase', t('items.includeUppercase')],
            ['UseNumbers', t('items.includeNumbers')],
            ['UseSpecialChars', t('items.includeSpecialChars')],
            ['UseNonAmbiguousChars', t('items.avoidAmbiguousChars')],
          ] as [keyof PasswordSettings, string][]).map(([key, label]) => (
            <View key={key} style={[styles.toggleRow, styles.rowDivider]}>
              <ThemedText style={styles.sliderLabel}>{label}</ThemedText>
              <TouchableOpacity
                style={[styles.chip, settings[key] ? styles.chipActive : null]}
                onPress={() => applyChange({ [key]: !settings[key] } as Partial<PasswordSettings>)}
                activeOpacity={0.7}
              >
                <ThemedText style={styles.chipText}>
                  {settings[key] ? t('common.enabled') : t('common.disabled')}
                </ThemedText>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.card}>
          {/* Word count slider. */}
          <View style={styles.sliderSection}>
            <View style={styles.sliderHeader}>
              <ThemedText style={styles.sliderLabel}>{t('items.wordCount')}</ThemedText>
              <ThemedText style={styles.sliderValue}>{settings.WordCount ?? DEFAULT_WORD_COUNT}</ThemedText>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={MIN_WORD_COUNT}
              maximumValue={MAX_WORD_COUNT}
              step={1}
              value={settings.WordCount ?? DEFAULT_WORD_COUNT}
              onValueChange={(value) => applyChange({ WordCount: Math.round(value) })}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={colors.accentBorder}
              thumbTintColor={colors.primary}
            />
          </View>

          {renderCycleRow(
            t('items.capitalization'),
            'Capitalization',
            settings.Capitalization ?? 'Lowercase',
            () => applyChange({ Capitalization: cycle(CAPITALIZATION_OPTIONS, settings.Capitalization ?? 'Lowercase') })
          )}
          {renderCycleRow(
            t('items.separator'),
            'Separator',
            settings.Separator ?? 'Dash',
            () => applyChange({ Separator: cycle(SEPARATOR_OPTIONS, settings.Separator ?? 'Dash') })
          )}
          {renderCycleRow(
            t('items.salt'),
            'Salt',
            settings.Salt ?? 'None',
            () => applyChange({ Salt: cycle(SALT_OPTIONS, settings.Salt ?? 'None') })
          )}

          {/* Language row. */}
          <TouchableOpacity
            style={[styles.languageRow, styles.rowDivider]}
            onPress={() => setShowLanguageModal(true)}
            activeOpacity={0.7}
          >
            <ThemedText style={styles.sliderLabel}>{t('items.passphraseLanguage')}</ThemedText>
            <View style={styles.languageValue}>
              <ThemedText style={styles.languageValueText}>
                {getLanguageInfo(currentLanguage).flag} {getLanguageInfo(currentLanguage).label}
              </ThemedText>
              <MaterialIcons name="chevron-right" size={20} color={colors.textMuted} />
            </View>
          </TouchableOpacity>
        </View>
      )}

      {footer}

      {/* Language picker modal. */}
      <ModalWrapper
        isOpen={showLanguageModal}
        onClose={() => setShowLanguageModal(false)}
        showHeaderBorder={false}
        showFooterBorder={false}
        closeOnBackdropPress
      >
        <ThemedText style={styles.pickerTitle}>{t('items.passphraseLanguage')}</ThemedText>
        {dicewareLanguages.map((code) => {
          const { flag, label } = getLanguageInfo(code);
          const selected = code.toLowerCase() === currentLanguage.toLowerCase();
          return (
            <TouchableOpacity
              key={code}
              style={styles.pickerItem}
              onPress={() => handleSelectLanguage(code)}
              activeOpacity={0.7}
            >
              <ThemedText style={styles.pickerItemText}>{flag} {label}</ThemedText>
              {selected && <Ionicons name="checkmark" size={20} color={colors.primary} />}
            </TouchableOpacity>
          );
        })}
      </ModalWrapper>
    </View>
  );
}
