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

  const [isCustomDomain, setIsCustomDomain] = useState(defaultEmailMode);
  const [localPart, setLocalPart] = useState('');
  const [selectedDomain, setSelectedDomain] = useState('');
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [publicEmailDomains, setPublicEmailDomains] = useState<string[]>([]);
  const [privateEmailDomains, setPrivateEmailDomains] = useState<string[]>([]);
  const [hiddenPrivateEmailDomains, setHiddenPrivateEmailDomains] = useState<string[]>([]);

  /**
   * Tracks whether the user explicitly toggled mode via buttons.
   * While true, the value useEffect skips auto-detection of isCustomDomain.
   */
  const modeToggledByUser = useRef(false);

  // Get email domains from vault metadata
  useEffect(() => {
    /**
     * Load email domains from vault metadata.
     */
    const loadDomains = async (): Promise<void> => {
      try {
        const metadata = await dbContext.getVaultMetadata();
        setPublicEmailDomains(metadata?.publicEmailDomains ?? []);
        setPrivateEmailDomains(metadata?.privateEmailDomains ?? []);
        setHiddenPrivateEmailDomains(metadata?.hiddenPrivateEmailDomains ?? []);
      } catch (err) {
        console.error('Error loading email domains:', err);
      }
    };
    loadDomains();
  }, [dbContext]);

  // Check if private domains are available and valid
  const showPrivateDomains = useMemo(() => {
    return privateEmailDomains.length > 0 &&
           !(privateEmailDomains.length === 1 && (privateEmailDomains[0] === 'DISABLED.TLD' || privateEmailDomains[0] === ''));
  }, [privateEmailDomains]);

  // Track previous defaultEmailMode to detect prop changes (e.g., when item type changes)
  const prevDefaultEmailModeRef = useRef(defaultEmailMode);

  // When defaultEmailMode changes (e.g., item type switched from Login to Alias),
  // update the mode and load the user's configured default domain
  useEffect(() => {
    // Only act when defaultEmailMode actually changed
    if (prevDefaultEmailModeRef.current === defaultEmailMode) {
      return;
    }
    prevDefaultEmailModeRef.current = defaultEmailMode;

    // If switching to alias mode (defaultEmailMode = false) and we don't have a value with a domain
    if (!defaultEmailMode && (!value || !value.includes('@'))) {
      modeToggledByUser.current = false;
      setIsCustomDomain(false);

      // Load the user's configured default domain
      const loadDefaultDomain = async (): Promise<void> => {
        const userDefaultDomain = await dbContext.sqliteClient?.getDefaultEmailDomain();
        if (userDefaultDomain) {
          setSelectedDomain(userDefaultDomain);
        }
      };
      loadDefaultDomain();
    }
  }, [defaultEmailMode, value, dbContext.sqliteClient]);

  // Initialize state from value prop
  useEffect(() => {
    if (!value) {
      // Value is empty - clear local part but preserve selected domain
      setLocalPart('');
      // Only set default domain if none is selected yet (initial load)
      if (!selectedDomain) {
        // Load the user's configured default domain
        const loadDefaultDomain = async (): Promise<void> => {
          const userDefaultDomain = await dbContext.sqliteClient?.getDefaultEmailDomain();
          if (userDefaultDomain) {
            setSelectedDomain(userDefaultDomain);
          } else if (showPrivateDomains && privateEmailDomains[0]) {
            setSelectedDomain(privateEmailDomains[0]);
          } else if (publicEmailDomains[0]) {
            setSelectedDomain(publicEmailDomains[0]);
          }
        };
        loadDefaultDomain();
      }
      return;
    }

    if (value.includes('@')) {
      const [local, domain] = value.split('@');
      setLocalPart(local);
      setSelectedDomain(domain);

      /*
       * Auto-detect mode based on domain recognition, but only if the user
       * hasn't explicitly toggled mode via the Email/Alias buttons.
       */
      if (!modeToggledByUser.current) {
        const isKnownDomain = publicEmailDomains.includes(domain) ||
                             privateEmailDomains.includes(domain) ||
                             hiddenPrivateEmailDomains.includes(domain);
        setIsCustomDomain(!isKnownDomain);
      }
    } else {
      setLocalPart(value);
      // Don't reset isCustomDomain here - preserve the current mode

      // Set default domain if not already set
      if (!selectedDomain && !value.includes('@')) {
        // Load the user's configured default domain
        const loadDefaultDomain = async (): Promise<void> => {
          const userDefaultDomain = await dbContext.sqliteClient?.getDefaultEmailDomain();
          if (userDefaultDomain) {
            setSelectedDomain(userDefaultDomain);
          } else if (showPrivateDomains && privateEmailDomains[0]) {
            setSelectedDomain(privateEmailDomains[0]);
          } else if (publicEmailDomains[0]) {
            setSelectedDomain(publicEmailDomains[0]);
          }
        };
        loadDefaultDomain();
      }
    }
  }, [value, publicEmailDomains, privateEmailDomains, hiddenPrivateEmailDomains, showPrivateDomains, selectedDomain, dbContext.sqliteClient]);

  /*
   * Re-check domain mode when domains finish loading.
   * This handles the case where value was set before domains were loaded.
   * Skip if the user has explicitly toggled mode via buttons.
   */
  useEffect(() => {
    if (modeToggledByUser.current) {
      return;
    }

    if (!value || !value.includes('@')) {
      return;
    }

    const domain = value.split('@')[1];
    if (!domain) {
      return;
    }

    const isKnownDomain = publicEmailDomains.includes(domain) ||
                         privateEmailDomains.includes(domain) ||
                         hiddenPrivateEmailDomains.includes(domain);

    if (isKnownDomain && isCustomDomain) {
      setIsCustomDomain(false);
    }
  }, [publicEmailDomains, privateEmailDomains, hiddenPrivateEmailDomains, value, isCustomDomain]);

  // Handle local part changes
  const handleLocalPartChange = useCallback((newText: string) => {
    modeToggledByUser.current = false;

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
  const toggleCustomDomain = useCallback(async () => {
    modeToggledByUser.current = true;
    const newIsCustom = !isCustomDomain;
    setIsCustomDomain(newIsCustom);

    if (newIsCustom) {
      // Switching to custom domain mode (free text / normal email).
      // Clear the value so the user starts fresh with a regular email address.
      onChange('');
      setLocalPart('');
    } else {
      // Switching to domain chooser mode - clear old email-mode value.
      // Load the user's configured default domain
      const userDefaultDomain = await dbContext.sqliteClient?.getDefaultEmailDomain();
      const defaultDomain = userDefaultDomain ||
        (showPrivateDomains && privateEmailDomains[0] ? privateEmailDomains[0] : publicEmailDomains[0]);
      if (defaultDomain) {
        setSelectedDomain(defaultDomain);
      }
      setLocalPart('');
      onChange('');

      if (onGenerateAlias) {
        onGenerateAlias();
      }
    }
  }, [isCustomDomain, showPrivateDomains, publicEmailDomains, privateEmailDomains, onChange, onGenerateAlias, dbContext.sqliteClient]);

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
                  {publicEmailDomains.map((domain) => (
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
