import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  label
}) => {
  const { t } = useTranslation();
  const colors = useColors();
  const dbContext = useDb();
  const [isCustomDomain, setIsCustomDomain] = useState(false);
  const [localPart, setLocalPart] = useState('');
  const [selectedDomain, setSelectedDomain] = useState('');
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [privateEmailDomains, setPrivateEmailDomains] = useState<string[]>([]);

  // Get private email domains from vault metadata
  useEffect(() => {
    /**
     * Load private email domains from vault metadata.
     */
    const loadDomains = async (): Promise<void> => {
      try {
        const defaultDomain = await dbContext.sqliteClient?.getDefaultEmailDomain();
        if (defaultDomain) {
          setPrivateEmailDomains([defaultDomain]);
        }
      } catch (err) {
        console.error('Error loading email domains:', err);
      }
    };
    loadDomains();
  }, [dbContext.sqliteClient]);

  // Check if private domains are available and valid
  const showPrivateDomains = useMemo(() => {
    return privateEmailDomains.length > 0 &&
           !(privateEmailDomains.length === 1 && (privateEmailDomains[0] === 'DISABLED.TLD' || privateEmailDomains[0] === ''));
  }, [privateEmailDomains]);

  // Initialize state from value prop
  useEffect(() => {
    if (!value) {
      // Set default domain
      if (showPrivateDomains && privateEmailDomains[0]) {
        setSelectedDomain(privateEmailDomains[0]);
      } else if (PUBLIC_EMAIL_DOMAINS[0]) {
        setSelectedDomain(PUBLIC_EMAIL_DOMAINS[0]);
      }
      return;
    }

    if (value.includes('@')) {
      const [local, domain] = value.split('@');
      setLocalPart(local);
      setSelectedDomain(domain);

      // Check if it's a custom domain
      const isKnownDomain = PUBLIC_EMAIL_DOMAINS.includes(domain) ||
                           privateEmailDomains.includes(domain);
      setIsCustomDomain(!isKnownDomain);
    } else {
      setLocalPart(value);
      // Don't reset isCustomDomain here - preserve the current mode

      // Set default domain if not already set
      if (!selectedDomain && !value.includes('@')) {
        if (showPrivateDomains && privateEmailDomains[0]) {
          setSelectedDomain(privateEmailDomains[0]);
        } else if (PUBLIC_EMAIL_DOMAINS[0]) {
          setSelectedDomain(PUBLIC_EMAIL_DOMAINS[0]);
        }
      }
    }
  }, [value, privateEmailDomains, showPrivateDomains, selectedDomain]);

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
      // Switching to custom domain mode
      // If we have a domain-based value, extract just the local part
      if (value && value.includes('@')) {
        const [local] = value.split('@');
        onChange(local);
        setLocalPart(local);
      }
    } else {
      // Switching to domain chooser mode
      const defaultDomain = showPrivateDomains && privateEmailDomains[0]
        ? privateEmailDomains[0]
        : PUBLIC_EMAIL_DOMAINS[0];
      setSelectedDomain(defaultDomain);

      // Only add domain if we have a local part
      if (localPart && localPart.trim()) {
        onChange(`${localPart}@${defaultDomain}`);
      } else if (value && !value.includes('@')) {
        // If we have a value without @, add the domain
        onChange(`${value}@${defaultDomain}`);
      }
    }
  }, [isCustomDomain, value, localPart, showPrivateDomains, privateEmailDomains, onChange]);

  const styles = StyleSheet.create({
    container: {
      marginBottom: 16,
    },
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
      color: colors.text,
      fontSize: 14,
      fontWeight: '500',
      marginBottom: 6,
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
    toggleButton: {
      marginTop: 8,
    },
    toggleButtonText: {
      color: colors.primary,
      fontSize: 14,
    },
  });

  return (
    <View style={styles.container}>
      <Text style={styles.label}>
        {label}
        {required && <Text style={styles.requiredAsterisk}> *</Text>}
      </Text>

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.textInput}
          value={isCustomDomain ? value : localPart}
          onChangeText={handleLocalPartChange}
          placeholder={isCustomDomain ? t('credentials.enterFullEmail') : t('credentials.enterEmailPrefix')}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          multiline={false}
          numberOfLines={1}
        />

        {!isCustomDomain && (
          <TouchableOpacity
            style={styles.domainButton}
            onPress={() => setIsModalVisible(true)}
          >
            <Text style={styles.domainAt}>@</Text>
            <Text style={styles.domainButtonText} numberOfLines={1}>
              {selectedDomain}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity style={styles.toggleButton} onPress={toggleCustomDomain}>
        <Text style={styles.toggleButtonText}>
          {isCustomDomain
            ? t('credentials.useDomainChooser')
            : t('credentials.enterCustomDomain')}
        </Text>
      </TouchableOpacity>

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
                {t('credentials.selectEmailDomain')}
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
                      {t('credentials.privateEmailTitle')}
                    </Text>
                    <Text style={styles.domainSectionSubtitle}>
                      ({t('credentials.privateEmailAliasVaultServer')})
                    </Text>
                  </View>
                  <Text style={styles.domainSectionDescription}>
                    {t('credentials.privateEmailDescription')}
                  </Text>
                  <View style={styles.domainList}>
                    {privateEmailDomains.map((domain) => (
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
                  {t('credentials.publicEmailTitle')}
                </Text>
                <Text style={styles.domainSectionDescription}>
                  {t('credentials.publicEmailDescription')}
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