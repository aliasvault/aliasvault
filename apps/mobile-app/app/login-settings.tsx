import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useNavigation, useRouter } from 'expo-router';
import { useState, useEffect, useCallback, useMemo, useLayoutEffect } from 'react';
import { StyleSheet, View, Text, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';

import { AppInfo } from '@/utils/AppInfo';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';

import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedView } from '@/components/themed/ThemedView';
import { HeaderBackButton } from '@/components/ui/HeaderBackButton';
import { RobustPressable } from '@/components/ui/RobustPressable';
import NativeVaultManager from '@/specs/NativeVaultManager';

type ApiOption = {
  label: string;
  value: string;
};

type CustomHeader = {
  name: string;
  value: string;
};

/**
 * Check whether a header name conflicts with built-in AliasVault headers.
 */
const isReservedHeaderName = (name: string): boolean => {
  const lower = name.trim().toLowerCase();
  return lower === 'authorization' || lower.startsWith('x-aliasvault-');
};

/**
 * Settings screen (for logged out users).
 */
export default function SettingsScreen() : React.ReactNode {
  const colors = useColors();
  const navigation = useNavigation();
  const router = useRouter();
  const { t } = useTranslation();
  const [selectedOption, setSelectedOption] = useState<string>(AppInfo.DEFAULT_API_URL);
  const [customUrl, setCustomUrl] = useState<string>('');
  const [customHeaders, setCustomHeaders] = useState<CustomHeader[]>([]);
  const [visibleHeaders, setVisibleHeaders] = useState<boolean[]>([]);
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const DEFAULT_OPTIONS: ApiOption[] = useMemo(() => [
    { label: 'AliasVault.com', value: AppInfo.DEFAULT_API_URL },
    { label: t('app.loginSettings.selfHosted'), value: 'custom' },
  ], [t]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: t('app.navigation.loginSettings'),
      /**
       * Header left button (custom back button with testID for E2E tests).
       */
      headerLeft: (): React.ReactNode => (
        <HeaderBackButton
          label={t('app.navigation.login')}
          onPress={() => router.back()}
        />
      ),
    });
  }, [navigation, router, t]);

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

      const headersJson = await NativeVaultManager.getCustomProxyHeaders();
      const parsed = JSON.parse(headersJson || '[]');
      if (Array.isArray(parsed) && parsed.length > 0) {
        setCustomHeaders(parsed.map((h: CustomHeader) => ({ name: h?.name ?? '', value: h?.value ?? '' })));
        setVisibleHeaders(parsed.map(() => false));
        // Pre-expand the advanced section so existing config is visible after a re-open.
        setAdvancedExpanded(true);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setIsLoading(false);
    }
  }, [DEFAULT_OPTIONS]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadStoredSettings is async; setState only fires after data is fetched
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

  /**
   * Persist the current header list to native storage, dropping invalid/empty/reserved entries.
   */
  const persistHeaders = useCallback(async (next: CustomHeader[]): Promise<void> => {
    const cleaned = next
      .map(h => ({ name: h.name.trim(), value: h.value.trim() }))
      .filter(h => h.name.length > 0 && h.value.length > 0 && !isReservedHeaderName(h.name));
    try {
      await NativeVaultManager.setCustomProxyHeaders(JSON.stringify(cleaned));
    } catch (error) {
      console.error('Failed to save custom proxy headers:', error);
    }
  }, []);

  /**
   * Update a field of a header row and persist.
   */
  const updateHeader = (index: number, field: 'name' | 'value', value: string): void => {
    setCustomHeaders(prev => {
      const next = prev.map((h, i) => (i === index ? { ...h, [field]: value } : h));
      persistHeaders(next);
      return next;
    });
  };

  /**
   * Remove a header row and persist.
   */
  const removeHeader = (index: number): void => {
    setCustomHeaders(prev => {
      const next = prev.filter((_, i) => i !== index);
      persistHeaders(next);
      return next;
    });
    setVisibleHeaders(prev => prev.filter((_, i) => i !== index));
  };

  /**
   * Add a new empty header row.
   */
  const addHeader = (): void => {
    setCustomHeaders(prev => [...prev, { name: '', value: '' }]);
    setVisibleHeaders(prev => [...prev, false]);
  };

  /**
   * Toggle visibility of a header value.
   */
  const toggleHeaderVisibility = (index: number): void => {
    setVisibleHeaders(prev => prev.map((v, i) => (i === index ? !v : v)));
  };

  const styles = StyleSheet.create({
    addButton: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      justifyContent: 'center',
      padding: 12,
    },
    content: {
      flex: 1,
    },
    deleteButton: {
      alignItems: 'center',
      height: 44,
      justifyContent: 'center',
      width: 44,
    },
    formContainer: {
      gap: 8,
    },
    headerBlock: {
      backgroundColor: colors.background,
      borderRadius: 8,
      padding: 12,
    },
    headerFields: {
      flex: 1,
      gap: 8,
    },
    headerRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
    },
    headersList: {
      gap: 12,
      marginTop: 8,
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
    valueInputWrapper: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      flexDirection: 'row',
    },
    valueInputInner: {
      color: colors.text,
      flex: 1,
      fontSize: 16,
      padding: 12,
    },
    visibilityToggle: {
      alignItems: 'center',
      borderLeftColor: colors.accentBorder,
      borderLeftWidth: 1,
      height: 44,
      justifyContent: 'center',
      paddingHorizontal: 12,
    },
    label: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 8,
    },
    advancedBody: {
      gap: 8,
      marginTop: 8,
    },
    advancedDescription: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    advancedToggle: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 6,
    },
    advancedToggleText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    connectedPanel: {
      backgroundColor: colors.accentBackground,
      borderBottomLeftRadius: 8,
      borderBottomRightRadius: 8,
      borderColor: colors.accentBorder,
      borderTopWidth: 0,
      borderWidth: 1,
      marginBottom: 8,
      padding: 16,
    },
    panelDivider: {
      backgroundColor: colors.accentBorder,
      height: 1,
      marginVertical: 16,
    },
    requiredMark: {
      color: colors.red,
      fontWeight: '700',
    },
    optionButton: {
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      marginBottom: 8,
      padding: 12,
    },
    optionButtonAttached: {
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
      marginBottom: 0,
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
        <KeyboardAvoidingView
          style={styles.content}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 30 : 80}
        >
          <ThemedScrollView keyboardShouldPersistTaps="handled">
            <ThemedView style={styles.content}>
              <View style={styles.titleContainer}>
                <Text style={styles.title}>{t('app.loginSettings.title')}</Text>
              </View>

              <View style={styles.formContainer}>
                {DEFAULT_OPTIONS.map(option => {
                  const isSelected = selectedOption === option.value;
                  const hasPanel = option.value === 'custom' && isSelected;
                  return (
                    <View key={option.value}>
                      <RobustPressable
                        style={[
                          styles.optionButton,
                          isSelected && styles.optionButtonSelected,
                          hasPanel && styles.optionButtonAttached,
                        ]}
                        onPress={() => handleOptionChange(option.value)}
                        testID={`api-option-${option.value === 'custom' ? 'custom' : 'default'}`}
                      >
                        <Text style={[
                          styles.optionButtonText,
                          isSelected && styles.optionButtonTextSelected
                        ]}>
                          {option.label}
                        </Text>
                      </RobustPressable>

                      {hasPanel && (
                        <View style={styles.connectedPanel}>
                          <Text style={styles.label}>
                            {t('app.loginSettings.customApiUrl')}
                            <Text style={styles.requiredMark}> *</Text>
                          </Text>
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
                            testID="custom-api-url-input"
                          />

                          <View style={styles.panelDivider} />

                          <RobustPressable
                            style={styles.advancedToggle}
                            onPress={() => setAdvancedExpanded(prev => !prev)}
                            testID="advanced-toggle"
                          >
                            <Text style={styles.advancedToggleText}>{t('app.loginSettings.advancedSettings')}</Text>
                            <MaterialIcons
                              name={advancedExpanded ? 'expand-less' : 'expand-more'}
                              size={24}
                              color={colors.textMuted}
                            />
                          </RobustPressable>

                          {advancedExpanded && (
                            <View style={styles.advancedBody}>
                              <Text style={styles.label}>{t('app.loginSettings.customProxyHeaders')}</Text>
                              <Text style={styles.advancedDescription}>{t('app.loginSettings.customProxyHeadersDescription')}</Text>

                              <View style={styles.headersList}>
                                {customHeaders.map((header, index) => (
                                  <View key={index} style={styles.headerBlock}>
                                    <View style={styles.headerRow}>
                                      <View style={styles.headerFields}>
                                        <Text style={styles.label}>{t('app.loginSettings.headerName')}</Text>
                                        <TextInput
                                          style={styles.input}
                                          value={header.name}
                                          onChangeText={value => updateHeader(index, 'name', value)}
                                          placeholder={t('app.loginSettings.headerNamePlaceholder')}
                                          placeholderTextColor={colors.textMuted}
                                          autoCapitalize="none"
                                          autoCorrect={false}
                                          testID={`custom-header-name-${index}`}
                                        />
                                        <Text style={styles.label}>{t('app.loginSettings.headerValue')}</Text>
                                        <View style={styles.valueInputWrapper}>
                                          <TextInput
                                            style={styles.valueInputInner}
                                            value={header.value}
                                            onChangeText={value => updateHeader(index, 'value', value)}
                                            placeholder={t('app.loginSettings.headerValue')}
                                            placeholderTextColor={colors.textMuted}
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            secureTextEntry={!visibleHeaders[index]}
                                            testID={`custom-header-value-${index}`}
                                          />
                                          <RobustPressable
                                            style={styles.visibilityToggle}
                                            onPress={() => toggleHeaderVisibility(index)}
                                            testID={`toggle-custom-header-visibility-${index}`}
                                          >
                                            <MaterialIcons
                                              name={visibleHeaders[index] ? 'visibility-off' : 'visibility'}
                                              size={20}
                                              color={colors.primary}
                                            />
                                          </RobustPressable>
                                        </View>
                                      </View>
                                      <RobustPressable
                                        style={styles.deleteButton}
                                        onPress={() => removeHeader(index)}
                                        testID={`delete-custom-header-${index}`}
                                      >
                                        <MaterialIcons name="delete-outline" size={24} color={colors.red} />
                                      </RobustPressable>
                                    </View>
                                  </View>
                                ))}

                                <RobustPressable
                                  style={styles.addButton}
                                  onPress={addHeader}
                                  testID="add-custom-header"
                                >
                                  <MaterialIcons name="add" size={24} color={colors.primary} />
                                </RobustPressable>
                              </View>
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>

              <Text style={styles.versionText}>{t('app.loginSettings.version', { version: AppInfo.VERSION })}</Text>
            </ThemedView>
          </ThemedScrollView>
        </KeyboardAvoidingView>
      </ThemedContainer>
    </>
  );
}
