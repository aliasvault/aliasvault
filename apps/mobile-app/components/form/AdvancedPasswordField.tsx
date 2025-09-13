import { MaterialIcons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { Controller, Control, FieldValues, Path } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View, TextInput, TextInputProps, StyleSheet, TouchableOpacity, Platform, Modal, ScrollView, Switch } from 'react-native';

import type { PasswordSettings } from '@/utils/dist/shared/models/vault';
import { CreatePasswordGenerator } from '@/utils/dist/shared/password-generator';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';
import { useDb } from '@/context/DbContext';

export type AdvancedPasswordFieldRef = {
  focus: () => void;
  selectAll: () => void;
};

type AdvancedPasswordFieldProps<T extends FieldValues> = Omit<TextInputProps, 'value' | 'onChangeText'> & {
  label: string;
  name: Path<T>;
  control: Control<T>;
  required?: boolean;
  showPassword?: boolean;
  onShowPasswordChange?: (show: boolean) => void;
  isNewCredential?: boolean;
}

const AdvancedPasswordFieldComponent = forwardRef<AdvancedPasswordFieldRef, AdvancedPasswordFieldProps<FieldValues>>(({
  label,
  name,
  control,
  required,
  showPassword: controlledShowPassword,
  onShowPasswordChange,
  isNewCredential = false,
  ...props
}, ref) => {
  const colors = useColors();
  const { t } = useTranslation();
  const inputRef = useRef<TextInput>(null);
  const [internalShowPassword, setInternalShowPassword] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [currentSettings, setCurrentSettings] = useState<PasswordSettings | null>(null);
  const [previewPassword, setPreviewPassword] = useState<string>('');
  const [sliderValue, setSliderValue] = useState<number>(16); // Default until loaded from DB
  const fieldOnChangeRef = useRef<((value: string) => void) | null>(null);
  const lastGeneratedLength = useRef<number>(0);
  const isSliding = useRef(false);
  const hasSetInitialLength = useRef(false);
  const currentPasswordRef = useRef<string>('');
  const dbContext = useDb();
  const showPassword = controlledShowPassword ?? internalShowPassword;

  const setShowPasswordState = useCallback((show: boolean) => {
    if (controlledShowPassword !== undefined) {
      onShowPasswordChange?.(show);
    } else {
      setInternalShowPassword(show);
    }
  }, [controlledShowPassword, onShowPasswordChange]);

  // Load password settings from database
  useEffect(() => {
    const loadSettings = async () => {
      try {
        if (dbContext.sqliteClient) {
          const settings = await dbContext.sqliteClient.getPasswordSettings();
          setCurrentSettings(settings);
          // Only set slider value from settings if we don't have a password value yet
          if (!hasSetInitialLength.current && isNewCredential) {
            setSliderValue(settings.Length);
          }
        }
      } catch (error) {
        console.error('Error loading password settings:', error);
      }
    };
    loadSettings();
  }, [dbContext.sqliteClient, isNewCredential]);


  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    selectAll: () => {
      const input = inputRef.current;
      if (input && input.props.value) {
        input.setSelection(0, String(input.props.value).length);
      }
    }
  }), []);

  const generatePassword = useCallback((settings: PasswordSettings): string => {
    try {
      const passwordGenerator = CreatePasswordGenerator(settings);
      return passwordGenerator.generateRandomPassword();
    } catch (error) {
      console.error('Error generating password:', error);
      return '';
    }
  }, []);

  const handleGeneratePassword = useCallback(() => {
    if (fieldOnChangeRef.current && currentSettings) {
      const password = generatePassword(currentSettings);
      if (password) {
        fieldOnChangeRef.current(password);
        setShowPasswordState(true);
      }
    }
  }, [currentSettings, generatePassword, setShowPasswordState]);

  const handleSliderChange = useCallback((value: number) => {
    const roundedLength = Math.round(value);
    setSliderValue(roundedLength);

    // Only generate if value actually changed and we're actively sliding
    if (roundedLength !== lastGeneratedLength.current && isSliding.current) {
      lastGeneratedLength.current = roundedLength;

      // Show password when sliding
      if (!showPassword) {
        setShowPasswordState(true);
      }

      const newSettings = { ...(currentSettings || {}), Length: roundedLength } as PasswordSettings;
      if (fieldOnChangeRef.current && currentSettings) {
        const password = generatePassword(newSettings);
        if (password) {
          fieldOnChangeRef.current(password);
        }
      }
    }
  }, [currentSettings, generatePassword, showPassword, setShowPasswordState]);

  const handleSliderStart = useCallback(() => {
    isSliding.current = true;
    // Initialize lastGeneratedLength when starting to slide
    lastGeneratedLength.current = sliderValue;
  }, [sliderValue]);

  const handleSliderComplete = useCallback((value: number) => {
    isSliding.current = false;
    const roundedLength = Math.round(value);
    if (currentSettings) {
      const newSettings = { ...currentSettings, Length: roundedLength };
      setCurrentSettings(newSettings);
    }
    lastGeneratedLength.current = 0; // Reset for next sliding session
  }, [currentSettings]);

  const handleRefreshPreview = useCallback(() => {
    if (currentSettings) {
      const password = generatePassword(currentSettings);
      setPreviewPassword(password);
    }
  }, [currentSettings, generatePassword]);

  const handleUsePassword = useCallback(() => {
    if (fieldOnChangeRef.current && previewPassword) {
      fieldOnChangeRef.current(previewPassword);
      setShowPasswordState(true);
      setShowSettingsModal(false);
    }
  }, [previewPassword, setShowPasswordState]);

  const handleOpenSettings = useCallback(() => {
    if (currentSettings) {
      const password = generatePassword(currentSettings);
      setPreviewPassword(password);
      setShowSettingsModal(true);
    }
  }, [currentSettings, generatePassword]);

  const updateSetting = useCallback((key: keyof PasswordSettings, value: boolean) => {
    setCurrentSettings(prev => {
      if (!prev) return prev;
      const newSettings = { ...prev, [key]: value };
      const password = generatePassword(newSettings);
      setPreviewPassword(password);
      return newSettings;
    });
  }, [generatePassword]);

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
    errorText: {
      color: 'red',
      fontSize: 12,
      marginTop: 4,
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
    inputError: {
      borderColor: 'red',
    },
    inputGroup: {
      marginBottom: 6,
    },
    inputLabel: {
      color: colors.textMuted,
      fontSize: 12,
      marginBottom: 4,
    },
    modalContent: {
      backgroundColor: colors.accentBackground,
      borderRadius: 12,
      maxHeight: '80%',
      maxWidth: 400,
      padding: 20,
      width: '90%',
    },
    modalHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 20,
    },
    modalOverlay: {
      alignItems: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      flex: 1,
      justifyContent: 'center',
    },
    modalTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
    },
    previewContainer: {
      marginBottom: 20,
    },
    previewInput: {
      color: colors.text,
      flex: 1,
      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
      fontSize: 14,
      padding: 12,
      textAlign: 'center',
    },
    previewInputContainer: {
      alignItems: 'center',
      backgroundColor: colors.background,
      borderColor: colors.accentBorder,
      borderRadius: 6,
      borderWidth: 1,
      flexDirection: 'row',
    },
    refreshButton: {
      borderLeftColor: colors.accentBorder,
      borderLeftWidth: 1,
      padding: 10,
    },
    requiredIndicator: {
      color: 'red',
      marginLeft: 4,
    },
    settingItem: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 10,
    },
    settingLabel: {
      color: colors.text,
      fontSize: 14,
      flex: 1,
    },
    settingsButton: {
      marginLeft: 8,
      padding: 4,
    },
    settingsSection: {
      marginBottom: 20,
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
      padding: 12,
    },
    useButtonText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
      marginLeft: 8,
    },
  }), [colors]);

  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, value }, fieldState: { error } }) => {
        fieldOnChangeRef.current = onChange;
        currentPasswordRef.current = value as string || '';

        // Use useEffect to update slider value when password value changes
        // This avoids setState during render
        useEffect(() => {
          if (!hasSetInitialLength.current) {
            if (!isNewCredential && value && typeof value === 'string' && value.length > 0) {
              // Editing existing credential: use actual password length
              setSliderValue(value.length);
              hasSetInitialLength.current = true;
            } else if (isNewCredential) {
              // New credential: settings default is already set
              hasSetInitialLength.current = true;
            }
          }
        }, [value]);

        const showClearButton = Platform.OS === 'android' && value && value.length > 0;

        return (
          <View style={styles.inputGroup}>
            <ThemedText style={styles.inputLabel}>
              {label} {required && <ThemedText style={styles.requiredIndicator}>*</ThemedText>}
            </ThemedText>

            <View style={[styles.inputContainer, error ? styles.inputError : null]}>
              <TextInput
                ref={inputRef}
                style={styles.input}
                value={value as string}
                placeholderTextColor={colors.textMuted}
                onChangeText={onChange}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect={false}
                clearButtonMode={Platform.OS === 'ios' ? "while-editing" : "never"}
                secureTextEntry={!showPassword}
                {...props}
              />

              {showClearButton && (
                <TouchableOpacity
                  style={styles.clearButton}
                  onPress={() => onChange('')}
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
                <ThemedText style={styles.sliderLabel}>{t('credentials.passwordLength')}</ThemedText>
                <View style={styles.sliderValueContainer}>
                  <ThemedText style={styles.sliderValue}>{sliderValue}</ThemedText>
                  <TouchableOpacity
                    style={styles.settingsButton}
                    onPress={handleOpenSettings}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons name="settings" size={20} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              </View>

              <Slider
                style={styles.slider}
                minimumValue={8}
                maximumValue={64}
                value={sliderValue}
                onValueChange={handleSliderChange}
                onSlidingStart={handleSliderStart}
                onSlidingComplete={handleSliderComplete}
                step={1}
                minimumTrackTintColor={colors.primary}
                maximumTrackTintColor={colors.accentBorder}
                thumbTintColor={colors.primary}
              />
            </View>

            {error && <ThemedText style={styles.errorText}>{error.message}</ThemedText>}

            <Modal
              visible={showSettingsModal}
              transparent
              animationType="fade"
              onRequestClose={() => setShowSettingsModal(false)}
            >
              <View style={styles.modalOverlay}>
                <View style={styles.modalContent}>
                  <View style={styles.modalHeader}>
                    <ThemedText style={styles.modalTitle}>{t('credentials.changePasswordComplexity')}</ThemedText>
                    <TouchableOpacity
                      style={styles.closeButton}
                      onPress={() => setShowSettingsModal(false)}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons name="close" size={24} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>

                  <ScrollView showsVerticalScrollIndicator={false}>
                    <View style={styles.previewContainer}>
                      <View style={styles.previewInputContainer}>
                        <TextInput
                          style={styles.previewInput}
                          value={previewPassword}
                          editable={false}
                        />
                        <TouchableOpacity
                          style={styles.refreshButton}
                          onPress={handleRefreshPreview}
                          activeOpacity={0.7}
                        >
                          <MaterialIcons name="refresh" size={20} color={colors.primary} />
                        </TouchableOpacity>
                      </View>
                    </View>

                    <View style={styles.settingsSection}>
                      <View style={styles.settingItem}>
                        <ThemedText style={styles.settingLabel}>{t('credentials.includeLowercase')}</ThemedText>
                        <Switch
                          value={currentSettings?.UseLowercase ?? true}
                          onValueChange={(value) => updateSetting('UseLowercase', value)}
                          trackColor={{ false: colors.accentBorder, true: colors.primary }}
                          thumbColor={Platform.OS === 'android' ? colors.background : undefined}
                        />
                      </View>

                      <View style={styles.settingItem}>
                        <ThemedText style={styles.settingLabel}>{t('credentials.includeUppercase')}</ThemedText>
                        <Switch
                          value={currentSettings?.UseUppercase ?? true}
                          onValueChange={(value) => updateSetting('UseUppercase', value)}
                          trackColor={{ false: colors.accentBorder, true: colors.primary }}
                          thumbColor={Platform.OS === 'android' ? colors.background : undefined}
                        />
                      </View>

                      <View style={styles.settingItem}>
                        <ThemedText style={styles.settingLabel}>{t('credentials.includeNumbers')}</ThemedText>
                        <Switch
                          value={currentSettings?.UseNumbers ?? true}
                          onValueChange={(value) => updateSetting('UseNumbers', value)}
                          trackColor={{ false: colors.accentBorder, true: colors.primary }}
                          thumbColor={Platform.OS === 'android' ? colors.background : undefined}
                        />
                      </View>

                      <View style={styles.settingItem}>
                        <ThemedText style={styles.settingLabel}>{t('credentials.includeSpecialChars')}</ThemedText>
                        <Switch
                          value={currentSettings?.UseSpecialChars ?? true}
                          onValueChange={(value) => updateSetting('UseSpecialChars', value)}
                          trackColor={{ false: colors.accentBorder, true: colors.primary }}
                          thumbColor={Platform.OS === 'android' ? colors.background : undefined}
                        />
                      </View>

                      <View style={styles.settingItem}>
                        <ThemedText style={styles.settingLabel}>{t('credentials.avoidAmbiguousChars')}</ThemedText>
                        <Switch
                          value={currentSettings?.UseNonAmbiguousChars ?? false}
                          onValueChange={(value) => updateSetting('UseNonAmbiguousChars', value)}
                          trackColor={{ false: colors.accentBorder, true: colors.primary }}
                          thumbColor={Platform.OS === 'android' ? colors.background : undefined}
                        />
                      </View>
                    </View>

                    <TouchableOpacity
                      style={styles.useButton}
                      onPress={handleUsePassword}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons name="keyboard-arrow-down" size={20} color={colors.text} />
                      <ThemedText style={styles.useButtonText}>{t('common.use')}</ThemedText>
                    </TouchableOpacity>
                  </ScrollView>
                </View>
              </View>
            </Modal>
          </View>
        );
      }}
    />
  );
});

AdvancedPasswordFieldComponent.displayName = 'AdvancedPasswordField';

export const AdvancedPasswordField = AdvancedPasswordFieldComponent as <T extends FieldValues>(props: AdvancedPasswordFieldProps<T> & { ref?: React.Ref<AdvancedPasswordFieldRef> }) => JSX.Element;