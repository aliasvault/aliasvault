import { useNavigation } from 'expo-router';
import { useState, useEffect, useCallback, useMemo, useLayoutEffect } from 'react';
import { StyleSheet, View, Text, TextInput, ActivityIndicator } from 'react-native';

import { AppInfo } from '@/utils/AppInfo';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';

import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedView } from '@/components/themed/ThemedView';
import { RobustPressable } from '@/components/ui/RobustPressable';
import NativeVaultManager from '@/specs/NativeVaultManager';

type ApiOption = {
  label: string;
  value: string;
};

/**
 * Settings screen (for logged out users).
 */
export default function SettingsScreen() : React.ReactNode {
  const colors = useColors();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const [selectedOption, setSelectedOption] = useState<string>(AppInfo.DEFAULT_API_URL);
  const [customUrl, setCustomUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  const DEFAULT_OPTIONS: ApiOption[] = useMemo(() => [
    { label: t('app.loginSettings.aliasvaultNet'), value: AppInfo.DEFAULT_API_URL },
    { label: t('app.loginSettings.selfHosted'), value: 'custom' },
  ], [t]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: t('app.navigation.loginSettings'),
      headerBackTitle: t('app.navigation.login'),
    });
  }, [navigation, t]);

  /**
   * Load the stored settings from native layer.
   */
  const loadStoredSettings = useCallback(async () : Promise<void> => {
    try {
      const apiUrl = await NativeVaultManager.getApiUrl();
      const matchingOption = DEFAULT_OPTIONS.find(opt => opt.value === apiUrl);
      if (matchingOption) {
        setSelectedOption(matchingOption.value);
      } else if (apiUrl) {
        setSelectedOption('custom');
        setCustomUrl(apiUrl);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setIsLoading(false);
    }
  }, [DEFAULT_OPTIONS]);

  useEffect(() => {
    loadStoredSettings();
  }, [loadStoredSettings]);

  /**
   * Handle the option change.
   */
  const handleOptionChange = async (value: string) : Promise<void> => {
    setSelectedOption(value);
    if (value !== 'custom') {
      try {
        await NativeVaultManager.setApiUrl(value);
      } catch (error) {
        console.error('Failed to sync API URL to native layer:', error);
      }
      setCustomUrl('');
    }
  };

  /**
   * Handle the custom URL change.
   */
  const handleCustomUrlChange = async (value: string) : Promise<void> => {
    setCustomUrl(value);
    try {
      await NativeVaultManager.setApiUrl(value);
    } catch (error) {
      console.error('Failed to sync API URL to native layer:', error);
    }
  };

  const styles = StyleSheet.create({
    content: {
      flex: 1,
    },
    formContainer: {
      gap: 16,
    },
    input: {
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      color: colors.text,
      fontSize: 16,
      padding: 12,
    },
    label: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 8,
    },
    optionButton: {
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      marginBottom: 8,
      padding: 12,
    },
    optionButtonSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    optionButtonText: {
      color: colors.text,
      fontSize: 14,
    },
    optionButtonTextSelected: {
      color: colors.primarySurfaceText,
      fontWeight: 'bold',
    },
    title: {
      color: colors.text,
      fontSize: 24,
      fontWeight: 'bold',
    },
    titleContainer: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      marginBottom: 24,
    },
    versionText: {
      color: colors.textMuted,
      marginTop: 24,
      textAlign: 'center',
    },
  });

  if (isLoading) {
    return (
      <ThemedContainer>
        <ThemedScrollView>
          <View style={styles.content}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        </ThemedScrollView>
      </ThemedContainer>
    );
  }

  return (
    <>
      <ThemedContainer>
        <ThemedScrollView>
          <ThemedView style={styles.content}>
            <View style={styles.titleContainer}>
              <Text style={styles.title}>{t('app.loginSettings.title')}</Text>
            </View>

            <View style={styles.formContainer}>
              {DEFAULT_OPTIONS.map(option => (
                <RobustPressable
                  key={option.value}
                  style={[
                    styles.optionButton,
                    selectedOption === option.value && styles.optionButtonSelected
                  ]}
                  onPress={() => handleOptionChange(option.value)}
                >
                  <Text style={[
                    styles.optionButtonText,
                    selectedOption === option.value && styles.optionButtonTextSelected
                  ]}>
                    {option.label}
                  </Text>
                </RobustPressable>
              ))}

              {selectedOption === 'custom' && (
                <View>
                  <Text style={styles.label}>{t('app.loginSettings.customApiUrl')}</Text>
                  <TextInput
                    style={styles.input}
                    value={customUrl}
                    onChangeText={handleCustomUrlChange}
                    placeholder={t('app.loginSettings.customApiUrlPlaceholder')}
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    multiline={false}
                    numberOfLines={1}
                  />
                </View>
              )}
            </View>
            <Text style={styles.versionText}>{t('app.loginSettings.version', { version: AppInfo.VERSION })}</Text>
          </ThemedView>
        </ThemedScrollView>
      </ThemedContainer>
    </>
  );
}