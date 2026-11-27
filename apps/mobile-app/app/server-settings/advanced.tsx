import { cleanProxyHeaders, headerNameError, toRequestHeaders } from '@aliasvault/client/platform/ProxyHeaders';
import { apiUrlFromServerUrl, toServerUrlFields, toStoredUrls, validateServerUrlFields, withApiUrl } from '@aliasvault/client/platform/ServerUrl';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from 'expo-router';
import { useState, useEffect, useLayoutEffect } from 'react';
import { StyleSheet, View, Text, TextInput, KeyboardAvoidingView, Platform } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';

import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { RobustPressable } from '@/components/ui/RobustPressable';
import NativeVaultManager from '@/specs/NativeVaultManager';

import type { ProxyHeader } from '@aliasvault/client/platform/ProxyHeaders';
import type { ServerUrlFields } from '@aliasvault/client/platform/ServerUrl';

const EMPTY_HEADER: ProxyHeader = { name: '', value: '' };

/**
 * Advanced settings of a self-hosted server: API URL and custom proxy headers (for logged out users).
 */
export default function ServerAdvancedSettingsScreen(): React.ReactNode {
  const colors = useColors();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const [serverFields, setServerFields] = useState<ServerUrlFields>(() => toServerUrlFields('', ''));
  const [apiUrlInput, setApiUrlInput] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [headers, setHeaders] = useState<ProxyHeader[]>([]);
  const [visibleValues, setVisibleValues] = useState<boolean[]>([]);
  const [isEdited, setIsEdited] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: t('app.loginSettings.advancedSettings'),
    });
  }, [navigation, t]);

  useEffect(() => {
    /**
     * Load the stored API URL and headers.
     */
    const loadSettings = async (): Promise<void> => {
      let stored: ProxyHeader[] = [];
      try {
        const fields = toServerUrlFields(await NativeVaultManager.getApiUrl(), await NativeVaultManager.getClientUrl());
        setServerFields(fields);
        setApiUrlInput(fields.isCustomApiUrl ? fields.apiUrl : '');
        stored = Object.entries(toRequestHeaders(JSON.parse(await NativeVaultManager.getCustomProxyHeaders() || '[]'))).map(([name, value]) => ({ name, value }));
      } catch (error) {
        console.error('Failed to load advanced server settings:', error);
      }
      setHeaders(stored);
      setVisibleValues(stored.map(() => false));
    };
    loadSettings();
  }, []);

  // Store the headers only after an edit, so opening this page never rewrites headers an older version stored.
  useEffect(() => {
    if (isEdited) {
      NativeVaultManager.setCustomProxyHeaders(JSON.stringify(cleanProxyHeaders(headers))).catch(error => console.error('Failed to save custom proxy headers:', error));
    }
  }, [headers, isEdited]);

  /**
   * Update the API URL and store it once valid; an empty API URL means the server URL + /api.
   */
  const handleApiUrlChange = async (value: string): Promise<void> => {
    const fields = withApiUrl(serverFields, value);
    setApiUrlInput(value);
    setServerFields(fields);
    if (Object.keys(validateServerUrlFields(fields)).length > 0) {
      return;
    }
    const { apiUrl, clientUrl } = toStoredUrls(fields);
    try {
      await NativeVaultManager.setApiUrl(apiUrl);
      await NativeVaultManager.setClientUrl(clientUrl);
    } catch (error) {
      console.error('Failed to sync API URL to native layer:', error);
    }
  };

  /**
   * Update a field of a header.
   */
  const updateHeader = (index: number, field: keyof ProxyHeader, value: string): void => {
    setIsEdited(true);
    setHeaders(prev => prev.map((header, i) => (i === index ? { ...header, [field]: value } : header)));
  };

  /**
   * Remove a header.
   */
  const removeHeader = (index: number): void => {
    setIsEdited(true);
    setHeaders(prev => prev.filter((_, i) => i !== index));
    setVisibleValues(prev => prev.filter((_, i) => i !== index));
  };

  /**
   * Add an empty header.
   */
  const addHeader = (): void => {
    setIsEdited(true);
    setHeaders(prev => [...prev, EMPTY_HEADER]);
    setVisibleValues(prev => [...prev, false]);
  };

  const apiUrlError = showErrors ? validateServerUrlFields(serverFields).apiUrl : undefined;

  const styles = StyleSheet.create({
    addButton: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      flexDirection: 'row',
      gap: 6,
      justifyContent: 'center',
      paddingVertical: 12,
    },
    addButtonText: {
      color: colors.primary,
      fontSize: 16,
      fontWeight: '600',
    },
    content: {
      flex: 1,
    },
    footer: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 6,
    },
    footerError: {
      color: colors.red,
      fontSize: 13,
      marginTop: 6,
    },
    fullWidthInput: {
      color: colors.text,
      fontSize: 16,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    group: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      overflow: 'hidden',
    },
    groupError: {
      borderColor: colors.red,
      borderWidth: 1,
    },
    groupTitle: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '600',
      marginBottom: 8,
      textTransform: 'uppercase',
    },
    headerGroup: {
      marginBottom: 12,
    },
    headersDescription: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
      marginBottom: 12,
    },
    headersTitle: {
      marginTop: 32,
    },
    iconButton: {
      alignItems: 'center',
      height: 44,
      justifyContent: 'center',
      width: 48,
    },
    input: {
      color: colors.text,
      flex: 1,
      fontSize: 16,
      paddingLeft: 16,
      paddingVertical: 12,
    },
    inputRow: {
      alignItems: 'center',
      flexDirection: 'row',
    },
    removeButton: {
      alignItems: 'center',
      alignSelf: 'flex-end',
      flexDirection: 'row',
      gap: 4,
      marginBottom: 6,
    },
    removeButtonText: {
      color: colors.red,
      fontSize: 13,
      fontWeight: '600',
    },
    separator: {
      backgroundColor: colors.accentBorder,
      height: StyleSheet.hairlineWidth,
      marginLeft: 16,
    },
  });

  return (
    <ThemedContainer>
      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 30 : 80}
      >
        <ThemedScrollView keyboardShouldPersistTaps="handled">
          <Text style={styles.groupTitle}>{t('settings.customApiUrl')}</Text>
          <View style={[styles.group, apiUrlError && styles.groupError]}>
            <TextInput
              style={styles.fullWidthInput}
              value={apiUrlInput}
              onChangeText={handleApiUrlChange}
              onBlur={() => setShowErrors(true)}
              placeholder={apiUrlFromServerUrl(serverFields.serverUrl) || 'https://aliasvault.example.com/api'}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              accessibilityLabel={t('settings.customApiUrl')}
              testID="custom-api-url-input"
            />
          </View>
          {apiUrlError && <Text style={styles.footerError}>{t(apiUrlError)}</Text>}
          <Text style={styles.footer}>{t('settings.apiUrlHint')}</Text>

          <Text style={[styles.groupTitle, styles.headersTitle]}>{t('app.loginSettings.customProxyHeaders')}</Text>
          <Text style={styles.headersDescription}>{t('app.loginSettings.customProxyHeadersDescription')}</Text>

          {headers.map((header, index) => {
            const nameError = headerNameError(header.name);
            return (
              <View key={index} style={styles.headerGroup}>
                <RobustPressable style={styles.removeButton} onPress={() => removeHeader(index)} testID={`delete-custom-header-${index}`}>
                  <Ionicons name="trash-outline" size={15} color={colors.red} />
                  <Text style={styles.removeButtonText}>{t('common.remove')}</Text>
                </RobustPressable>
                <View style={[styles.group, nameError !== undefined && styles.groupError]}>
                  <TextInput
                    style={styles.fullWidthInput}
                    value={header.name}
                    onChangeText={value => updateHeader(index, 'name', value)}
                    placeholder={t('app.loginSettings.headerNamePlaceholder')}
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel={t('app.loginSettings.headerName')}
                    testID={`custom-header-name-${index}`}
                  />
                  <View style={styles.separator} />
                  <View style={styles.inputRow}>
                    <TextInput
                      style={styles.input}
                      value={header.value}
                      onChangeText={value => updateHeader(index, 'value', value)}
                      placeholder={t('app.loginSettings.headerValue')}
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      secureTextEntry={!visibleValues[index]}
                      accessibilityLabel={t('app.loginSettings.headerValue')}
                      testID={`custom-header-value-${index}`}
                    />
                    <RobustPressable
                      style={styles.iconButton}
                      onPress={() => setVisibleValues(prev => prev.map((visible, i) => (i === index ? !visible : visible)))}
                      testID={`toggle-custom-header-visibility-${index}`}
                    >
                      <Ionicons name={visibleValues[index] ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
                    </RobustPressable>
                  </View>
                </View>
                {nameError && <Text style={styles.footerError}>{t(nameError)}</Text>}
              </View>
            );
          })}

          <RobustPressable style={styles.addButton} onPress={addHeader} testID="add-custom-header">
            <Ionicons name="add" size={20} color={colors.primary} />
            <Text style={styles.addButtonText}>{t('common.add')}</Text>
          </RobustPressable>
        </ThemedScrollView>
      </KeyboardAvoidingView>
    </ThemedContainer>
  );
}
