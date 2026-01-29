import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, Pressable, StyleSheet } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';
import { useDb } from '@/context/DbContext';

type EmailDomainFieldProps = {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  label: string;
  /** Optional callback for remove button - when provided, shows X button in label row */
  onRemove?: () => void;
  /** Optional testID for the text input */
  testID?: string;
  /** Optional: default to email mode (free text) instead of alias mode (domain chooser). Defaults to false. */
  defaultEmailMode?: boolean;
  /** Optional callback to generate an email alias. When provided, shows a regenerate button and is called when switching to alias mode. */
  onGenerateAlias?: () => void;
}

// Hardcoded public email domains (same as in browser extension)
const PUBLIC_EMAIL_DOMAINS = [
  'spamok.com',
  'solarflarecorp.com',
  'spamok.nl',
  '3060.nl',
  'landmail.nl',
  'asdasd.nl',
  'spamok.de',
  'spamok.com.ua',
  'spamok.es',
  'spamok.fr',
];

/**
 * Email domain field component with domain chooser functionality for React Native.
 * Allows users to select from private/public domains or enter custom email addresses.
 */
export const EmailDomainField: React.FC<EmailDomainFieldProps> = ({
  value,
  onChange,
  error,
  required = false,
  label,
  onRemove,
  testID,
  defaultEmailMode = false,
  onGenerateAlias
}) => {
  const { t } = useTranslation();
  const colors = useColors();
  const dbContext = useDb();

  // Initialize mode immediately based on value (before domains load)
  // This prevents flicker by setting the correct mode right away
  const getInitialMode = useCallback((val: string): boolean => {
    if (!val || !val.includes('@')) {
      return defaultEmailMode;
    }
    const [, domain] = val.split('@');
    // Check against PUBLIC_EMAIL_DOMAINS immediately (hardcoded, always available)
    // This gives us an immediate answer for most cases
    const isKnownPublicDomain = PUBLIC_EMAIL_DOMAINS.includes(domain);
    // If it's a known public domain, use alias mode (not custom)
    // Otherwise, default to email mode until private domains load
    return !isKnownPublicDomain;
  }, [defaultEmailMode]);

  const [isCustomDomain, setIsCustomDomain] = useState(() => getInitialMode(value));
  const [localPart, setLocalPart] = useState(() => {
    if (value && value.includes('@')) {
      return value.split('@')[0];
    }
    return value || '';
  });
  const [selectedDomain, setSelectedDomain] = useState(() => {
    if (value && value.includes('@')) {
      return value.split('@')[1];
    }
    return PUBLIC_EMAIL_DOMAINS[0] || '';
  });
  const [isModalVisible, setIsModalVisible] = useState(false);

  // Use refs to store domains - this prevents re-renders when they load
  const privateEmailDomainsRef = useRef<string[]>([]);
  const hiddenPrivateEmailDomainsRef = useRef<string[]>([]);
  const hasDomainsLoadedRef = useRef(false);

  // State for domains (only used for UI display in modal, not for mode detection)
  const [privateEmailDomains, setPrivateEmailDomains] = useState<string[]>([]);
  const [hiddenPrivateEmailDomains, setHiddenPrivateEmailDomains] = useState<string[]>([]);

  // Track value changes to avoid unnecessary re-initialization
  const lastValueRef = useRef<string>(value);
  const hasInitializedFromValue = useRef(false);

  // Get private email domains from vault metadata
  useEffect(() => {
    /**
     * Load private email domains from vault metadata.
     * Store in refs immediately (no re-render), then update state for modal display.
     * This prevents flicker by avoiding re-renders when domains load.
     */
    const loadDomains = async (): Promise<void> => {
      try {
        const metadata = await dbContext.getVaultMetadata();
        const privateDomains = metadata?.privateEmailDomains ?? [];
        const hiddenDomains = metadata?.hiddenPrivateEmailDomains ?? [];

        // Update refs immediately (no re-render triggered)
        privateEmailDomainsRef.current = privateDomains;
        hiddenPrivateEmailDomainsRef.current = hiddenDomains;
        hasDomainsLoadedRef.current = true;

        // Update state for modal display (triggers re-render, but only affects modal)
        setPrivateEmailDomains(privateDomains);
        setHiddenPrivateEmailDomains(hiddenDomains);

        // Check if we need to update mode now that domains are loaded
        // Only update if value has an @ and we're in custom mode
        if (value && value.includes('@')) {
          const domain = value.split('@')[1];
          if (domain) {
            const isKnownDomain = PUBLIC_EMAIL_DOMAINS.includes(domain) ||
                                 privateDomains.includes(domain) ||
                                 hiddenDomains.includes(domain);

            // Only update mode if domain is now recognized AND we're in custom mode
            // Use functional update to avoid stale closure and prevent unnecessary updates
            setIsCustomDomain(prev => {
              if (isKnownDomain && prev) {
                return false; // Switch to alias mode
              }
              return prev; // No change needed - prevents re-render
            });
          }
        }
      } catch (err) {
        console.error('Error loading email domains:', err);
      }
    };
    loadDomains();
  }, [dbContext, value]);

  // Check if private domains are available and valid
  const showPrivateDomains = useMemo(() => {
    return privateEmailDomains.length > 0 &&
           !(privateEmailDomains.length === 1 && (privateEmailDomains[0] === 'DISABLED.TLD' || privateEmailDomains[0] === ''));
  }, [privateEmailDomains]);

  // Initialize state from value prop - only runs when value actually changes
  useEffect(() => {
    // Skip if value hasn't changed and we've already initialized
    if (value === lastValueRef.current && hasInitializedFromValue.current) {
      return;
    }
    lastValueRef.current = value;

    if (!value) {
      // Set default domain using refs (no re-render)
      const defaultDomain = hasDomainsLoadedRef.current && privateEmailDomainsRef.current[0]
        ? privateEmailDomainsRef.current[0]
        : PUBLIC_EMAIL_DOMAINS[0];
      if (defaultDomain && defaultDomain !== selectedDomain) {
        setSelectedDomain(defaultDomain);
      }
      hasInitializedFromValue.current = true;
      return;
    }

    if (value.includes('@')) {
      const [local, domain] = value.split('@');

      // Only update if values actually changed (prevents unnecessary re-renders)
      if (local !== localPart) {
        setLocalPart(local);
      }
      if (domain !== selectedDomain) {
        setSelectedDomain(domain);
      }

      // Check mode using refs (no re-render) - works even before domains load
      const isKnownDomain = PUBLIC_EMAIL_DOMAINS.includes(domain) ||
                           privateEmailDomainsRef.current.includes(domain) ||
                           hiddenPrivateEmailDomainsRef.current.includes(domain);

      // Only update mode if it needs to change (prevents flicker)
      setIsCustomDomain(prev => {
        const newMode = !isKnownDomain;
        return newMode !== prev ? newMode : prev;
      });

      hasInitializedFromValue.current = true;
    } else {
      if (value !== localPart) {
        setLocalPart(value);
      }
      // Set default domain if not already set
      if (!selectedDomain) {
        const defaultDomain = hasDomainsLoadedRef.current && privateEmailDomainsRef.current[0]
          ? privateEmailDomainsRef.current[0]
          : PUBLIC_EMAIL_DOMAINS[0];
        if (defaultDomain) {
          setSelectedDomain(defaultDomain);
        }
      }
      hasInitializedFromValue.current = true;
    }
  }, [value, localPart, selectedDomain]);

  /*
   * Re-check domain mode when domains finish loading.
   * This handles the case where value was set before domains were loaded.
   * Only switches mode if domain is now recognized and we're currently in custom mode.
   */
  // Note: Domain mode checking is now handled in the loadDomains effect above
  // This prevents the need for a separate effect that triggers re-renders

  // Handle local part changes
  const handleLocalPartChange = useCallback((newText: string) => {
    // If in custom domain mode, always pass through the full value
    if (isCustomDomain) {
      onChange(newText);
      // Stay in custom domain mode - don't auto-switch back
      return;
    }

    // Check if new value contains '@' symbol, if so, switch to custom domain mode
    if (newText.includes('@')) {
      setIsCustomDomain(true);
      onChange(newText);
      return;
    }

    setLocalPart(newText);
    // If the local part is empty, treat the whole field as empty
    if (!newText || newText.trim() === '') {
      onChange('');
    } else if (selectedDomain) {
      onChange(`${newText}@${selectedDomain}`);
    }
  }, [isCustomDomain, selectedDomain, onChange]);

  // Select a domain from the modal
  const selectDomain = useCallback((domain: string) => {
    setSelectedDomain(domain);
    const cleanLocalPart = localPart.includes('@') ? localPart.split('@')[0] : localPart;
    // If the local part is empty, treat the whole field as empty
    if (!cleanLocalPart || cleanLocalPart.trim() === '') {
      onChange('');
    } else {
      onChange(`${cleanLocalPart}@${domain}`);
    }
    setIsCustomDomain(false);
    setIsModalVisible(false);
  }, [localPart, onChange]);

  // Toggle between custom domain and domain chooser
  const toggleCustomDomain = useCallback(() => {
    const newIsCustom = !isCustomDomain;
    setIsCustomDomain(newIsCustom);

    if (newIsCustom) {
      // Switching to custom domain mode (free text / normal email).
      // Clear the value so the user starts fresh with a regular email address.
      onChange('');
      setLocalPart('');
    } else {
      // Switching to domain chooser mode - clear old email-mode value.
      const defaultDomain = showPrivateDomains && privateEmailDomains[0]
        ? privateEmailDomains[0]
        : PUBLIC_EMAIL_DOMAINS[0];
      setSelectedDomain(defaultDomain);
      setLocalPart('');
      onChange('');

      if (onGenerateAlias) {
        // Delegate to the parent callback which sets the full email value (prefix@domain)
        onGenerateAlias();
      }
    }
  }, [isCustomDomain, showPrivateDomains, privateEmailDomains, onChange, onGenerateAlias]);

  const styles = StyleSheet.create({
    domainAt: {
      color: colors.textMuted,
      fontSize: 16,
      marginRight: 2,
    },
    domainButton: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderBottomRightRadius: 8,
      borderColor: error ? colors.errorBorder : colors.accentBorder,
      borderLeftWidth: 0,
      borderTopRightRadius: 8,
      borderWidth: 1,
      flexDirection: 'row',
      justifyContent: 'center',
      paddingHorizontal: 12,
      paddingVertical: 11,
    },
    domainButtonNoRoundRight: {
      borderBottomRightRadius: 0,
      borderTopRightRadius: 0,
    },
    generateButton: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderBottomRightRadius: 8,
      borderColor: error ? colors.errorBorder : colors.accentBorder,
      borderLeftWidth: 0,
      borderTopRightRadius: 8,
      borderWidth: 1,
      justifyContent: 'center',
      paddingHorizontal: 10,
      paddingVertical: 11,
    },
    domainButtonText: {
      color: colors.text,
      fontSize: 16,
    },
    domainChip: {
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    domainChipSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    domainChipText: {
      color: colors.text,
      fontSize: 14,
    },
    domainChipTextSelected: {
      color: colors.primarySurfaceText,
    },
    domainList: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    domainSection: {
      marginBottom: 24,
    },
    domainSectionDescription: {
      color: colors.textMuted,
      fontSize: 13,
      marginBottom: 12,
      marginTop: 4,
    },
    domainSectionHeader: {
      alignItems: 'center',
      flexDirection: 'row',
    },
    domainSectionSubtitle: {
      color: colors.textMuted,
      fontSize: 12,
      marginLeft: 4,
    },
    domainSectionTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 4,
    },
    errorText: {
      color: colors.errorText,
      fontSize: 12,
      marginTop: 4,
    },
    inputContainer: {
      alignItems: 'center',
      flexDirection: 'row',
    },
    label: {
      color: colors.textMuted,
      fontSize: 12,
    },
    labelContainer: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    switcherContainer: {
      alignItems: 'center',
      flexDirection: 'row',
    },
    switcherButton: {
      fontSize: 14,
      fontWeight: '600',
    },
    switcherButtonActive: {
      color: colors.primary,
      fontWeight: '600',
    },
    switcherButtonInactive: {
      color: colors.textMuted,
      fontWeight: '400',
      opacity: 0.5,
    },
    switcherSeparator: {
      color: colors.textMuted,
      fontSize: 14,
      marginHorizontal: 6,
    },
    removeButton: {
      padding: 4,
    },
    modalCloseButton: {
      padding: 8,
    },
    modalContent: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      maxHeight: '80%',
      paddingBottom: 34,
    },
    modalHeader: {
      alignItems: 'center',
      borderBottomColor: colors.headerBorder,
      borderBottomWidth: 1,
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    modalOverlay: {
      backgroundColor: colors.modalBackground,
      flex: 1,
      justifyContent: 'flex-end',
    },
    modalScrollView: {
      paddingHorizontal: 16,
      paddingVertical: 16,
    },
    modalTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
    },
    requiredAsterisk: {
      color: colors.errorText,
    },
    separator: {
      backgroundColor: colors.headerBorder,
      height: 1,
      marginVertical: 16,
    },
    textInput: {
      backgroundColor: colors.background,
      borderBottomLeftRadius: 8,
      borderColor: error ? colors.errorBorder : colors.accentBorder,
      borderRadius: isCustomDomain ? 8 : 0,
      borderTopLeftRadius: 8,
      borderWidth: 1,
      color: colors.text,
      flex: 1,
      fontSize: 16,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
  });

  return (
    <View>
      <View style={styles.labelContainer}>
        <View style={styles.switcherContainer}>
          <TouchableOpacity
            onPress={isCustomDomain ? undefined : toggleCustomDomain}
            disabled={isCustomDomain}
          >
            <Text style={[
              styles.switcherButton,
              isCustomDomain ? styles.switcherButtonActive : styles.switcherButtonInactive
            ]}>
              {t('items.email')}
            </Text>
          </TouchableOpacity>
          <Text style={styles.switcherSeparator}>/</Text>
          <TouchableOpacity
            onPress={!isCustomDomain ? undefined : toggleCustomDomain}
            disabled={!isCustomDomain}
          >
            <Text style={[
              styles.switcherButton,
              !isCustomDomain ? styles.switcherButtonActive : styles.switcherButtonInactive
            ]}>
              {t('items.alias')}
            </Text>
          </TouchableOpacity>
          {required && <Text style={styles.requiredAsterisk}> *</Text>}
        </View>
        {onRemove && (
          <TouchableOpacity style={styles.removeButton} onPress={onRemove}>
            <MaterialIcons name="close" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.textInput}
          value={isCustomDomain ? value : localPart}
          onChangeText={handleLocalPartChange}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          multiline={false}
          numberOfLines={1}
          testID={testID}
          accessibilityLabel={testID}
        />

        {!isCustomDomain && (
          <TouchableOpacity
            style={[styles.domainButton, onGenerateAlias ? styles.domainButtonNoRoundRight : null]}
            onPress={() => setIsModalVisible(true)}
          >
            <Text style={styles.domainAt}>@</Text>
            <Text style={styles.domainButtonText} numberOfLines={1}>
              {selectedDomain}
            </Text>
          </TouchableOpacity>
        )}

        {!isCustomDomain && onGenerateAlias && (
          <TouchableOpacity
            style={styles.generateButton}
            onPress={onGenerateAlias}
            accessibilityLabel={t('common.generate')}
          >
            <MaterialIcons name="refresh" size={20} color={colors.primary} />
          </TouchableOpacity>
        )}
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

      {/* Domain selection modal */}
      <Modal
        visible={isModalVisible && !isCustomDomain}
        transparent
        animationType="slide"
        onRequestClose={() => setIsModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setIsModalVisible(false)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <ThemedText style={styles.modalTitle}>
                {t('items.selectEmailDomain')}
              </ThemedText>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setIsModalVisible(false)}
              >
                <MaterialIcons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScrollView}>
              {showPrivateDomains && (
                <View style={styles.domainSection}>
                  <View style={styles.domainSectionHeader}>
                    <Text style={styles.domainSectionTitle}>
                      {t('items.privateEmailTitle')}
                    </Text>
                    <Text style={styles.domainSectionSubtitle}>
                      ({t('items.privateEmailAliasVaultServer')})
                    </Text>
                  </View>
                  <Text style={styles.domainSectionDescription}>
                    {t('items.privateEmailDescription')}
                  </Text>
                  <View style={styles.domainList}>
                    {privateEmailDomains.filter(domain => !hiddenPrivateEmailDomains.includes(domain)).map((domain) => (
                      <TouchableOpacity
                        key={domain}
                        style={[
                          styles.domainChip,
                          selectedDomain === domain && styles.domainChipSelected
                        ]}
                        onPress={() => selectDomain(domain)}
                      >
                        <Text style={[
                          styles.domainChipText,
                          selectedDomain === domain && styles.domainChipTextSelected
                        ]}>
                          {domain}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {showPrivateDomains && <View style={styles.separator} />}

              <View style={styles.domainSection}>
                <Text style={styles.domainSectionTitle}>
                  {t('items.publicEmailTitle')}
                </Text>
                <Text style={styles.domainSectionDescription}>
                  {t('items.publicEmailDescription')}
                </Text>
                <View style={styles.domainList}>
                  {PUBLIC_EMAIL_DOMAINS.map((domain) => (
                    <TouchableOpacity
                      key={domain}
                      style={[
                        styles.domainChip,
                        selectedDomain === domain && styles.domainChipSelected
                      ]}
                      onPress={() => selectDomain(domain)}
                    >
                      <Text style={[
                        styles.domainChipText,
                        selectedDomain === domain && styles.domainChipTextSelected
                      ]}>
                        {domain}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};