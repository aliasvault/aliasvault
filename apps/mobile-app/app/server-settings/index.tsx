import { AppInfo } from '@aliasvault/client/platform/AppInfo';
import { toRequestHeaders } from '@aliasvault/client/platform/ProxyHeaders';
import { toServerUrlFields, toStoredUrls, validateServerUrlFields, withServerUrl } from '@aliasvault/client/platform/ServerUrl';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { useState, useCallback, useLayoutEffect } from 'react';
import { StyleSheet, View, Text, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';

import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { SettingsRow } from '@/components/ui/SettingsRow';
import NativeVaultManager from '@/specs/NativeVaultManager';

import type { ServerUrlFields } from '@aliasvault/client/platform/ServerUrl';

const CUSTOM_OPTION = 'custom';

/**
 * Server settings screen (for logged out users).
 */
export default function ServerSettingsScreen() : React.ReactNode {
  const colors = useColors();
  const navigation = useNavigation();
  const router = useRouter();
  const { t } = useTranslation();
  const [selectedOption, setSelectedOption] = useState<string>(AppInfo.DEFAULT_API_URL);
  const [serverFields, setServerFields] = useState<ServerUrlFields>(() => toServerUrlFields('', ''));
  const [showErrors, setShowErrors] = useState(false);
  const [advancedCount, setAdvancedCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const isSelfHosted = selectedOption === CUSTOM_OPTION;

  useLayoutEffect(() => {
    navigation.setOptions({
      title: t('settings.serverConfiguration'),
    });
  }, [navigation, t]);

  /*
   * Load the stored settings whenever the screen shows, so changes made in the advanced settings are picked up.
   */
  useFocusEffect(useCallback(() => {
    /**
     * Load the stored server settings from the native layer.
     */
    const loadStoredSettings = async () : Promise<void> => {
      try {
        const apiUrl = await NativeVaultManager.getApiUrl();
        const headerCount = Object.keys(toRequestHeaders(JSON.parse(await NativeVaultManager.getCustomProxyHeaders() || '[]'))).length;
        if (apiUrl && apiUrl !== AppInfo.DEFAULT_API_URL) {
          const fields = toServerUrlFields(apiUrl, await NativeVaultManager.getClientUrl());
          setSelectedOption(CUSTOM_OPTION);
          setServerFields(fields);
          setAdvancedCount(headerCount + (fields.isCustomApiUrl ? 1 : 0));
        } else {
          setAdvancedCount(headerCount);
        }
      } catch (error) {
        console.error('Error loading settings:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadStoredSettings();
  }, []));

  /**
   * Select the official server or a self-hosted one.
   */
  const handleOptionChange = async (value: string) : Promise<void> => {
    setSelectedOption(value);
    if (value !== CUSTOM_OPTION) {
      setServerFields(toServerUrlFields('', ''));
      setShowErrors(false);
      try {
        await NativeVaultManager.setApiUrl(value);
        await NativeVaultManager.setClientUrl('');
      } catch (error) {
        console.error('Failed to sync API URL to native layer:', error);
      }
    }
  };

  /**
   * Update the server URL and store it once valid.
   */
  const handleServerUrlChange = async (value: string) : Promise<void> => {
    const fields = withServerUrl(serverFields, value);
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

  // Errors only show once the field lost focus, so they do not appear while the user is still typing.
  const serverUrlError = showErrors ? validateServerUrlFields(serverFields).serverUrl : undefined;

  const styles = StyleSheet.create({
    advancedBadge: {
      backgroundColor: colors.primary,
      borderRadius: 9,
      minWidth: 18,
      paddingHorizontal: 5,
      paddingVertical: 1,
    },
    advancedBadgeText: {
      color: colors.primarySurfaceText,
      fontSize: 11,
      fontWeight: '700',
      textAlign: 'center',
    },
    advancedLink: {
      alignItems: 'center',
      alignSelf: 'flex-start',
      flexDirection: 'row',
      gap: 4,
      marginTop: 20,
    },
    advancedLinkText: {
      color: colors.primary,
      fontSize: 15,
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
    group: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      overflow: 'hidden',
    },
    groupError: {
      borderColor: colors.red,
      borderWidth: 1,
    },
    groupInput: {
      color: colors.text,
      fontSize: 16,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    groupTitle: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '600',
      marginBottom: 8,
      marginTop: 24,
      textTransform: 'uppercase',
    },
    separator: {
      backgroundColor: colors.accentBorder,
      height: StyleSheet.hairlineWidth,
      marginLeft: 52,
    },
    versionText: {
      color: colors.textMuted,
      fontSize: 13,
      marginTop: 32,
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

  const checkmark = <Ionicons name="checkmark" size={20} color={colors.primary} />;

  return (
    <ThemedContainer>
      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 30 : 80}
      >
        <ThemedScrollView keyboardShouldPersistTaps="handled">
          <View style={styles.group}>
            <SettingsRow
              icon="globe-outline"
              label="AliasVault.com"
              chevron={false}
              trailing={isSelfHosted ? null : checkmark}
              onPress={() => handleOptionChange(AppInfo.DEFAULT_API_URL)}
              testID="api-option-default"
            />
            <View style={styles.separator} />
            <SettingsRow
              icon="server-outline"
              label={t('app.loginSettings.selfHosted')}
              chevron={false}
              trailing={isSelfHosted ? checkmark : null}
              onPress={() => handleOptionChange(CUSTOM_OPTION)}
              testID="api-option-custom"
            />
          </View>

          {isSelfHosted && (
            <>
              <Text style={styles.groupTitle}>{t('settings.serverUrl')}</Text>
              <View style={[styles.group, serverUrlError && styles.groupError]}>
                <TextInput
                  style={styles.groupInput}
                  value={serverFields.serverUrl}
                  onChangeText={handleServerUrlChange}
                  onBlur={() => setShowErrors(true)}
                  placeholder="https://aliasvault.example.com"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  accessibilityLabel={t('settings.serverUrl')}
                  testID="custom-server-url-input"
                />
              </View>
              {serverUrlError && <Text style={styles.footerError}>{t(serverUrlError)}</Text>}
              <Text style={styles.footer}>{t('settings.serverUrlHint')}</Text>

              <RobustPressable style={styles.advancedLink} onPress={() => router.push('/server-settings/advanced')} testID="advanced-settings-link">
                <Text style={styles.advancedLinkText}>{t('app.loginSettings.advancedSettings')}</Text>
                {advancedCount > 0 && (
                  <View style={styles.advancedBadge}>
                    <Text style={styles.advancedBadgeText}>{advancedCount}</Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={16} color={colors.primary} />
              </RobustPressable>
            </>
          )}

          <Text style={styles.versionText}>{t('app.loginSettings.version', { version: AppInfo.VERSION })}</Text>
        </ThemedScrollView>
      </KeyboardAvoidingView>
    </ThemedContainer>
  );
}
