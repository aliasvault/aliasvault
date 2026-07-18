import { MaterialIcons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View, TextInput, TextInputProps, StyleSheet, Platform, TouchableOpacity } from 'react-native';

import type { PasswordSettings } from '@/utils/dist/core/models/vault';
import { MIN_WORD_COUNT, MAX_WORD_COUNT, DEFAULT_WORD_COUNT } from '@/utils/dist/core/models/defaults';
import { HapticsUtility } from '@/utils/HapticsUtility';
import { sliderToLength, lengthToSlider, SLIDER_MIN, SLIDER_MAX } from '@/utils/PasswordLengthSlider';
import * as PasswordGenerator from '@/utils/PasswordGeneratorUtility';

import { useColors } from '@/hooks/useColorScheme';

import { ModalWrapper } from '@/components/common/ModalWrapper';
import { PasswordGeneratorPanel } from '@/components/form/PasswordGeneratorPanel';
import { ThemedText } from '@/components/themed/ThemedText';
import { useDb } from '@/context/DbContext';

export type AdvancedPasswordFieldRef = {
  focus: () => void;
  selectAll: () => void;
};

type AdvancedPasswordFieldProps = Omit<TextInputProps, 'value' | 'onChangeText'> & {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  required?: boolean;
  showPassword?: boolean;
  onShowPasswordChange?: (show: boolean) => void;
  isNewCredential?: boolean;
  onRemove?: () => void;
  initialSettings?: PasswordSettings;
  /** Optional testID for the text input */
  testID?: string;
}

const AdvancedPasswordFieldComponent = forwardRef<AdvancedPasswordFieldRef, AdvancedPasswordFieldProps>(({
  label,
  value,
  onChangeText,
  required,
  showPassword: controlledShowPassword,
  onShowPasswordChange,
  isNewCredential = false,
  onRemove,
  testID,
  initialSettings,
  ...props
}, ref) => {
  const colors = useColors();
  const { t } = useTranslation();
  const inputRef = useRef<TextInput>(null);
  const [internalShowPassword, setInternalShowPassword] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [currentSettings, setCurrentSettings] = useState<PasswordSettings | null>(initialSettings || null);
  // Preview produced by the settings panel; used by the "Use" button.
  const previewPassword = useRef<string>('');
  const [sliderValue, setSliderValue] = useState<number>(() => {
    if (initialSettings) {
      return lengthToSlider(initialSettings.Length);
    }
    if (!isNewCredential && value && value.length > 0) {
      return lengthToSlider(value.length);
    }
    return lengthToSlider(16);
  });
  const lastGeneratedLength = useRef<number>(0);
  const isSliding = useRef(false);
  const hasSetInitialLength = useRef(!!initialSettings || (!isNewCredential && value && value.length > 0));
  const dbContext = useDb();
  const showPassword = controlledShowPassword ?? internalShowPassword;

  const isDiceware = (currentSettings?.Type ?? 'basic') === 'diceware';

  const setShowPasswordState = useCallback((show: boolean) => {
    if (controlledShowPassword !== undefined) {
      onShowPasswordChange?.(show);
    } else {
      setInternalShowPassword(show);
    }
  }, [controlledShowPassword, onShowPasswordChange]);

  // Load password settings from database (only if initialSettings not provided)
  useEffect(() => {
    if (initialSettings) {
      return;
    }
    const loadSettings = async () => {
      try {
        if (dbContext.sqliteClient) {
          const settings = await dbContext.sqliteClient.getPasswordSettings();
          setCurrentSettings(settings);
          if (!hasSetInitialLength.current) {
            setSliderValue(lengthToSlider(settings.Length));
            hasSetInitialLength.current = true;
          }
        }
      } catch (error) {
        console.error('Error loading password settings:', error);
      }
    };
    loadSettings();
  }, [dbContext.sqliteClient, initialSettings]);

  // Sync slider value with password length (only if not already initialized)
  useEffect(() => {
    if (!hasSetInitialLength.current) {
      if (!isNewCredential && value && value.length > 0) {
        setSliderValue(lengthToSlider(value.length));
        hasSetInitialLength.current = true;
      } else if (isNewCredential) {
        hasSetInitialLength.current = true;
      }
    }
  }, [value, isNewCredential]);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    selectAll: () => {
      const input = inputRef.current;
      if (input && value) {
        input.setSelection(0, value.length);
      }
    }
  }), [value]);

  /**
   * Generate a password/passphrase from the given settings using the native Rust core.
   */
  const generatePassword = useCallback(async (settings: PasswordSettings): Promise<string> => {
    try {
      return await PasswordGenerator.generatePassword(settings);
    } catch (error) {
      console.error('Error generating password:', error);
      return '';
    }
  }, []);

  const handleGeneratePassword = useCallback(async () => {
    if (currentSettings) {
      const password = await generatePassword(currentSettings);
      if (password) {
        onChangeText(password);
        setShowPasswordState(true);
        HapticsUtility.impact();
      }
    }
  }, [currentSettings, generatePassword, onChangeText, setShowPasswordState]);

  const handleSliderChange = useCallback((sliderVal: number) => {
    setSliderValue(sliderVal);
    const passwordLength = sliderToLength(sliderVal);

    if (passwordLength !== lastGeneratedLength.current && isSliding.current && currentSettings && !isDiceware) {
      lastGeneratedLength.current = passwordLength;

      if (!showPassword) {
        setShowPasswordState(true);
      }

      const newSettings = { ...currentSettings, Length: passwordLength };
      void generatePassword(newSettings).then((password) => {
        if (password) {
          onChangeText(password);
        }
      });
    }
  }, [currentSettings, isDiceware, generatePassword, showPassword, setShowPasswordState, onChangeText]);

  const handleSliderStart = useCallback(() => {
    isSliding.current = true;
    lastGeneratedLength.current = sliderToLength(sliderValue);
  }, [sliderValue]);

  const handleSliderComplete = useCallback((sliderVal: number) => {
    isSliding.current = false;
    const passwordLength = sliderToLength(sliderVal);
    if (currentSettings) {
      setCurrentSettings({ ...currentSettings, Length: passwordLength });
    }
    lastGeneratedLength.current = 0;
  }, [currentSettings]);

  /**
   * Handle the Diceware word-count slider: update the setting and regenerate the field value.
   */
  const handleWordCountChange = useCallback((wordCount: number) => {
    if (!currentSettings) {
      return;
    }
    const newSettings = { ...currentSettings, WordCount: Math.round(wordCount) };
    setCurrentSettings(newSettings);
    if (!showPassword) {
      setShowPasswordState(true);
    }
    void generatePassword(newSettings).then((password) => {
      if (password) {
        onChangeText(password);
      }
    });
  }, [currentSettings, generatePassword, onChangeText, showPassword, setShowPasswordState]);

  const handleUsePassword = useCallback(() => {
    if (previewPassword.current) {
      onChangeText(previewPassword.current);
      setShowPasswordState(true);
      setShowSettingsModal(false);
    }
  }, [onChangeText, setShowPasswordState]);

  const handleOpenSettings = useCallback(() => {
    if (currentSettings) {
      setShowSettingsModal(true);
    }
  }, [currentSettings]);

  const styles = useMemo(() => StyleSheet.create({
    button: {
      borderLeftColor: colors.accentBorder,
      borderLeftWidth: 1,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    clearButton: {
      paddingHorizontal: 8,
      paddingVertical: 10,
    },
    closeButton: {
      padding: 8,
    },
    input: {
      color: colors.text,
      flex: 1,
      fontSize: 16,
      paddingHorizontal: 10,
      paddingVertical: 10,
    },
    inputContainer: {
      alignItems: 'center',
      backgroundColor: colors.background,
      borderColor: colors.accentBorder,
      borderRadius: 6,
      borderWidth: 1,
      flexDirection: 'row',
    },
    inputGroup: {
      marginBottom: 6,
    },
    inputLabel: {
      color: colors.textMuted,
      fontSize: 12,
    },
    labelContainer: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    modalHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 12,
      marginTop: 10,
    },
    modalTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
    },
    removeButton: {
      padding: 4,
    },
    requiredIndicator: {
      color: 'red',
      marginLeft: 4,
    },
    settingsButton: {
      marginLeft: 8,
      padding: 4,
    },
    slider: {
      height: 40,
      width: '100%',
    },
    sliderContainer: {
      marginTop: 8,
      paddingHorizontal: 4,
    },
    sliderHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    sliderLabel: {
      color: colors.textMuted,
      fontSize: 12,
    },
    sliderValue: {
      color: colors.text,
      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
      fontSize: 12,
      fontWeight: '600',
    },
    sliderValueContainer: {
      alignItems: 'center',
      flexDirection: 'row',
    },
    useButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 6,
      flexDirection: 'row',
      justifyContent: 'center',
      marginTop: 12,
      padding: 12,
    },
    useButtonText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
      marginLeft: 8,
    },
  }), [colors]);

  const showClearButton = Platform.OS === 'android' && value && value.length > 0;

  return (
    <View style={styles.inputGroup}>
      <View style={styles.labelContainer}>
        <ThemedText style={styles.inputLabel}>
          {label} {required && <ThemedText style={styles.requiredIndicator}>*</ThemedText>}
        </ThemedText>
        {onRemove && (
          <TouchableOpacity
            style={styles.removeButton}
            onPress={onRemove}
            activeOpacity={0.7}
          >
            <MaterialIcons name="close" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.inputContainer}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={value}
          placeholderTextColor={colors.textMuted}
          onChangeText={onChangeText}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect={false}
          clearButtonMode={Platform.OS === 'ios' ? "while-editing" : "never"}
          secureTextEntry={!showPassword}
          testID={testID}
          accessibilityLabel={testID}
          {...props}
        />

        {showClearButton && (
          <TouchableOpacity
            style={styles.clearButton}
            onPress={() => onChangeText('')}
            activeOpacity={0.7}
          >
            <MaterialIcons name="close" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.button}
          onPress={() => setShowPasswordState(!showPassword)}
          activeOpacity={0.7}
        >
          <MaterialIcons
            name={showPassword ? "visibility-off" : "visibility"}
            size={20}
            color={colors.primary}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.button}
          onPress={handleGeneratePassword}
          activeOpacity={0.7}
        >
          <MaterialIcons name="refresh" size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.sliderContainer}>
        <View style={styles.sliderHeader}>
          <ThemedText style={styles.sliderLabel}>
            {isDiceware ? t('items.wordCount') : t('items.passwordLength')}
          </ThemedText>
          <View style={styles.sliderValueContainer}>
            <ThemedText style={styles.sliderValue}>
              {isDiceware ? (currentSettings?.WordCount ?? DEFAULT_WORD_COUNT) : sliderToLength(sliderValue)}
            </ThemedText>
            <TouchableOpacity
              style={styles.settingsButton}
              onPress={handleOpenSettings}
              activeOpacity={0.7}
            >
              <MaterialIcons name="settings" size={20} color={colors.primary} />
            </TouchableOpacity>
          </View>
        </View>

        {isDiceware ? (
          <Slider
            style={styles.slider}
            minimumValue={MIN_WORD_COUNT}
            maximumValue={MAX_WORD_COUNT}
            step={1}
            value={currentSettings?.WordCount ?? DEFAULT_WORD_COUNT}
            onValueChange={handleWordCountChange}
            minimumTrackTintColor={colors.primary}
            maximumTrackTintColor={colors.accentBorder}
            thumbTintColor={colors.primary}
          />
        ) : (
          <Slider
            style={styles.slider}
            minimumValue={SLIDER_MIN}
            maximumValue={SLIDER_MAX}
            value={sliderValue}
            onValueChange={handleSliderChange}
            onSlidingStart={handleSliderStart}
            onSlidingComplete={handleSliderComplete}
            minimumTrackTintColor={colors.primary}
            maximumTrackTintColor={colors.accentBorder}
            thumbTintColor={colors.primary}
          />
        )}
      </View>

      <ModalWrapper
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        showHeaderBorder={false}
        showFooterBorder={false}
      >
        <View style={styles.modalHeader}>
          <ThemedText style={styles.modalTitle}>{t('items.changePasswordComplexity')}</ThemedText>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => setShowSettingsModal(false)}
            activeOpacity={0.7}
          >
            <MaterialIcons name="close" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {currentSettings && (
          <PasswordGeneratorPanel
            initialSettings={currentSettings}
            onSettingsChange={setCurrentSettings}
            onPreviewChange={(password) => { previewPassword.current = password; }}
            footer={
              <TouchableOpacity
                style={styles.useButton}
                onPress={handleUsePassword}
                activeOpacity={0.7}
              >
                <MaterialIcons name="keyboard-arrow-down" size={20} color={colors.text} />
                <ThemedText style={styles.useButtonText}>{t('common.use')}</ThemedText>
              </TouchableOpacity>
            }
          />
        )}
      </ModalWrapper>
    </View>
  );
});

AdvancedPasswordFieldComponent.displayName = 'AdvancedPasswordField';

export const AdvancedPasswordField = AdvancedPasswordFieldComponent;
