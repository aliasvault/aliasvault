import { Buffer } from 'buffer';

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { usePreventRemove } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, Alert, Keyboard, Platform, ScrollView, KeyboardAvoidingView, TouchableOpacity } from 'react-native';
import Toast from 'react-native-toast-message';

import type { Folder } from '@/utils/db/repositories/FolderRepository';
import { CreateIdentityGenerator, CreateUsernameEmailGenerator, Gender, Identity, IdentityHelperUtils, convertAgeRangeToBirthdateOptions } from '@/utils/dist/core/identity-generator';
import type { Attachment, Item, ItemField, TotpCode, ItemType, FieldType } from '@/utils/dist/core/models/vault';
import { ItemTypes, getSystemFieldsForItemType, getOptionalFieldsForItemType, isFieldShownByDefault, getSystemField, fieldAppliesToType, FieldCategories, FieldTypes } from '@/utils/dist/core/models/vault';
import type { FaviconExtractModel } from '@/utils/dist/core/models/webapi';
import { CreatePasswordGenerator, PasswordGenerator } from '@/utils/dist/core/password-generator';
import emitter from '@/utils/EventEmitter';
import { extractServiceNameFromUrl } from '@/utils/UrlUtility';

import { useColors } from '@/hooks/useColorScheme';
import { useVaultMutate } from '@/hooks/useVaultMutate';

import { AddFieldMenu, type OptionalSection } from '@/components/form/AddFieldMenu';
import { AdvancedPasswordField } from '@/components/form/AdvancedPasswordField';
import { EmailDomainField } from '@/components/form/EmailDomainField';
import { FormField } from '@/components/form/FormField';
import { FormSection } from '@/components/form/FormSection';
import { HiddenField } from '@/components/form/HiddenField';
import { ItemNameField, ItemNameFieldRef } from '@/components/form/ItemNameField';
import { AttachmentUploader } from '@/components/items/details/AttachmentUploader';
import { TotpEditor } from '@/components/items/details/TotpEditor';
import { ItemTypeSelector } from '@/components/items/ItemTypeSelector';
import LoadingOverlay from '@/components/LoadingOverlay';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedText } from '@/components/themed/ThemedText';
import { AliasVaultToast } from '@/components/Toast';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { useDb } from '@/context/DbContext';
import { useWebApi } from '@/context/WebApiContext';

// Valid item types from the shared model
const VALID_ITEM_TYPES: ItemType[] = [ItemTypes.Login, ItemTypes.Alias, ItemTypes.CreditCard, ItemTypes.Note];

// Default item type for new items
const DEFAULT_ITEM_TYPE: ItemType = ItemTypes.Login;

/**
 * Temporary custom field definition (before persisting to database).
 */
type CustomFieldDefinition = {
  tempId: string;
  label: string;
  fieldType: FieldType;
  isHidden: boolean;
  displayOrder: number;
};

/**
 * Add or edit an item screen.
 */
export default function AddEditItemScreen(): React.ReactNode {
  const { id, serviceUrl, itemType: itemTypeParam } = useLocalSearchParams<{
    id: string;
    serviceUrl?: string;
    itemType?: string;
  }>();
  const router = useRouter();
  const colors = useColors();
  const dbContext = useDb();
  const { executeVaultMutation } = useVaultMutate();
  const navigation = useNavigation();
  const webApi = useWebApi();
  const { t } = useTranslation();

  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const itemNameRef = useRef<ItemNameFieldRef>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [isSaveDisabled, setIsSaveDisabled] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [originalAttachmentIds, setOriginalAttachmentIds] = useState<string[]>([]);
  const [totpCodes, setTotpCodes] = useState<TotpCode[]>([]);
  const [originalTotpCodeIds, setOriginalTotpCodeIds] = useState<string[]>([]);
  const [passkeyIds, setPasskeyIds] = useState<string[]>([]);
  const [passkeyIdsMarkedForDeletion, setPasskeyIdsMarkedForDeletion] = useState<string[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Item state
  const [item, setItem] = useState<Item | null>(null);

  // Form state for dynamic fields - key is FieldKey, value is the field value
  const [fieldValues, setFieldValues] = useState<Record<string, string | string[]>>({});

  // Custom field definitions (temporary until saved)
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);

  // UI visibility state
  const [show2FA, setShow2FA] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);

  // Folder state
  const [folders, setFolders] = useState<Folder[]>([]);

  // Track manually added optional fields
  const [manuallyAddedFields, setManuallyAddedFields] = useState<Set<string>>(new Set());

  // Track fields that had values initially (edit mode)
  const [initiallyVisibleFields, setInitiallyVisibleFields] = useState<Set<string>>(new Set());

  // Track if alias was already auto-generated
  const aliasGeneratedRef = useRef(false);

  // Track last generated values to avoid overwriting manual entries
  const [lastGeneratedValues, setLastGeneratedValues] = useState<{
    username: string | null;
    password: string | null;
    email: string | null;
  }>({ username: null, password: null, email: null });

  /**
   * If we received an ID, we're in edit mode.
   */
  const isEditMode = id !== undefined && id.length > 0;

  /**
   * Get all applicable system fields for the current item type.
   */
  const applicableSystemFields = useMemo(() => {
    if (!item) {
      return [];
    }
    return getSystemFieldsForItemType(item.ItemType);
  }, [item]);

  /**
   * Optional system fields for the current item type.
   */
  const optionalSystemFields = useMemo(() => {
    if (!item) {
      return [];
    }
    return getOptionalFieldsForItemType(item.ItemType);
  }, [item]);

  /**
   * The notes field (notes.content) - handled separately.
   */
  const notesField = useMemo(() => {
    return applicableSystemFields.find(field => field.FieldKey === 'notes.content');
  }, [applicableSystemFields]);

  /**
   * Set of field keys that are currently visible.
   */
  const visibleFieldKeys = useMemo(() => {
    const keys = new Set<string>();
    // Add fields that are shown by default
    applicableSystemFields.forEach(field => {
      if (item && isFieldShownByDefault(field, item.ItemType)) {
        keys.add(field.FieldKey);
      }
    });
    // Add manually added fields
    manuallyAddedFields.forEach(key => keys.add(key));
    // Add fields that were initially visible
    initiallyVisibleFields.forEach(key => keys.add(key));
    // Add fields with current values
    Object.keys(fieldValues).forEach(key => {
      const value = fieldValues[key];
      if (value && (Array.isArray(value) ? value.length > 0 : value.toString().trim() !== '')) {
        keys.add(key);
      }
    });
    return keys;
  }, [item, applicableSystemFields, manuallyAddedFields, initiallyVisibleFields, fieldValues]);

  /**
   * Check if a field should be shown.
   */
  const shouldShowField = useCallback((field: { FieldKey: string }) => {
    if (!item) {
      return false;
    }
    if (manuallyAddedFields.has(field.FieldKey)) {
      return true;
    }
    if (initiallyVisibleFields.has(field.FieldKey)) {
      return true;
    }
    const systemField = applicableSystemFields.find(f => f.FieldKey === field.FieldKey);
    if (!systemField) {
      return true; // Custom fields are always shown
    }
    return isFieldShownByDefault(systemField, item.ItemType);
  }, [item, applicableSystemFields, manuallyAddedFields, initiallyVisibleFields]);

  /**
   * Primary fields (like URL) that should be shown in the name block.
   */
  const primaryFields = useMemo(() => {
    return applicableSystemFields.filter(field => field.Category === FieldCategories.Primary);
  }, [applicableSystemFields]);

  /**
   * Group system fields by category for organized rendering.
   */
  const groupedSystemFields = useMemo(() => {
    const groups: Record<string, typeof applicableSystemFields> = {};

    applicableSystemFields.forEach(field => {
      // Skip notes, metadata, and primary fields
      if (field.Category === FieldCategories.Notes ||
          field.Category === FieldCategories.Metadata ||
          field.Category === FieldCategories.Primary) {
        return;
      }

      const category = field.Category;
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(field);
    });

    return groups;
  }, [applicableSystemFields]);

  /**
   * Check if alias fields are shown by default for the current item type.
   */
  const aliasFieldsShownByDefault = useMemo(() => {
    if (!item) {
      return false;
    }
    const aliasField = applicableSystemFields.find(f => f.FieldKey === 'alias.first_name');
    return aliasField ? isFieldShownByDefault(aliasField, item.ItemType) : false;
  }, [item, applicableSystemFields]);

  /**
   * Check if login fields exist for the current item type (determines 2FA support).
   */
  const hasLoginFields = useMemo(() => {
    return applicableSystemFields.some(f => f.FieldKey === 'login.username' || f.FieldKey === 'login.password');
  }, [applicableSystemFields]);

  /**
   * Handle field value change.
   */
  const handleFieldChange = useCallback((fieldKey: string, value: string | string[]) => {
    setFieldValues(prev => ({
      ...prev,
      [fieldKey]: value
    }));
    setHasUnsavedChanges(true);
  }, []);

  /**
   * Generate a random identity.
   */
  const generateRandomIdentity = useCallback(async (): Promise<Identity> => {
    const identityLanguage = await dbContext.sqliteClient!.getEffectiveIdentityLanguage();
    const identityGenerator = CreateIdentityGenerator(identityLanguage);

    const genderPreference = await dbContext.sqliteClient!.getDefaultIdentityGender();
    const ageRange = await dbContext.sqliteClient!.getDefaultIdentityAgeRange();
    const birthdateOptions = convertAgeRangeToBirthdateOptions(ageRange);

    return identityGenerator.generateRandomIdentity(genderPreference, birthdateOptions);
  }, [dbContext.sqliteClient]);

  /**
   * Initialize the password generator with settings from user's vault.
   */
  const initializePasswordGenerator = useCallback(async (): Promise<PasswordGenerator> => {
    const passwordSettings = await dbContext.sqliteClient!.getPasswordSettings();
    return CreatePasswordGenerator(passwordSettings);
  }, [dbContext.sqliteClient]);

  /**
   * Generate a random alias and password.
   */
  const generateRandomAlias = useCallback(async (): Promise<void> => {
    const passwordGenerator = await initializePasswordGenerator();
    const identity = await generateRandomIdentity();
    const password = passwordGenerator.generateRandomPassword();
    const defaultEmailDomain = await dbContext.sqliteClient!.getDefaultEmailDomain();
    const email = defaultEmailDomain ? `${identity.emailPrefix}@${defaultEmailDomain}` : identity.emailPrefix;

    // Check current values
    const currentUsername = (fieldValues['login.username'] as string) ?? '';
    const currentPassword = (fieldValues['login.password'] as string) ?? '';
    const currentEmail = (fieldValues['login.email'] as string) ?? '';

    const newValues: Record<string, string | string[]> = { ...fieldValues };

    // Only overwrite email if it's empty or matches the last generated value
    if (!currentEmail || currentEmail === lastGeneratedValues.email) {
      newValues['login.email'] = email;
    }

    // Always update alias identity fields
    newValues['alias.first_name'] = identity.firstName;
    newValues['alias.last_name'] = identity.lastName;
    newValues['alias.gender'] = identity.gender;
    newValues['alias.birthdate'] = IdentityHelperUtils.normalizeBirthDate(identity.birthDate.toISOString());

    // Only overwrite username if it's empty or matches the last generated value
    if (!currentUsername || currentUsername === lastGeneratedValues.username) {
      newValues['login.username'] = identity.nickName;
    }

    // Only overwrite password if it's empty or matches the last generated value
    if (!currentPassword || currentPassword === lastGeneratedValues.password) {
      newValues['login.password'] = password;
      setIsPasswordVisible(true);
    }

    setFieldValues(newValues);
    setHasUnsavedChanges(true);

    // Update tracking with new generated values
    setLastGeneratedValues({
      username: identity.nickName,
      password: password,
      email: email
    });
  }, [fieldValues, initializePasswordGenerator, generateRandomIdentity, dbContext.sqliteClient, lastGeneratedValues]);

  /**
   * Generate a random username.
   */
  const generateRandomUsername = useCallback(async (): Promise<void> => {
    try {
      const firstName = (fieldValues['alias.first_name'] as string) ?? '';
      const lastName = (fieldValues['alias.last_name'] as string) ?? '';
      const birthDate = (fieldValues['alias.birthdate'] as string) ?? '';

      let username: string;

      if (!firstName && !lastName && !birthDate) {
        const randomIdentity = await generateRandomIdentity();
        username = randomIdentity.nickName;
      } else {
        const usernameEmailGenerator = CreateUsernameEmailGenerator();

        let gender = Gender.Other;
        try {
          gender = (fieldValues['alias.gender'] as string) as Gender;
        } catch {
          // Gender parsing failed, default to other
        }

        let parsedBirthDate = new Date(birthDate);
        if (!birthDate || isNaN(parsedBirthDate.getTime())) {
          parsedBirthDate = new Date();
        }

        const identity: Identity = {
          firstName,
          lastName,
          nickName: '',
          gender,
          birthDate: parsedBirthDate,
          emailPrefix: (fieldValues['login.email'] as string) ?? '',
        };

        username = usernameEmailGenerator.generateUsername(identity);
      }

      handleFieldChange('login.username', username);
      setLastGeneratedValues(prev => ({ ...prev, username }));
    } catch (error) {
      console.error('Error generating random username:', error);
    }
  }, [fieldValues, generateRandomIdentity, handleFieldChange]);

  /**
   * Prevent accidental dismissal when there are unsaved changes.
   */
  usePreventRemove(hasUnsavedChanges, ({ data }): void => {
    Alert.alert(
      t('items.unsavedChanges.title'),
      t('items.unsavedChanges.message'),
      [
        {
          text: t('common.cancel'),
          style: 'cancel',
          /**
           * Do nothing
           */
          onPress: (): void => {}
        },
        {
          text: t('items.unsavedChanges.discard'),
          style: 'destructive',
          /**
           * Discard unsaved changes and navigate back
           */
          onPress: (): void => {
            setHasUnsavedChanges(false);
            navigation.dispatch(data.action);
          },
        },
      ]
    );
  });

  /**
   * Load an existing item from the database in edit mode.
   */
  const loadExistingItem = useCallback(async (): Promise<void> => {
    try {
      const existingItem = await dbContext.sqliteClient!.items.getById(id);
      if (existingItem) {
        setItem(existingItem);

        // Initialize field values from existing fields
        const initialValues: Record<string, string | string[]> = {};
        const existingCustomFields: CustomFieldDefinition[] = [];
        const fieldsWithValues = new Set<string>();

        existingItem.Fields.forEach((field) => {
          initialValues[field.FieldKey] = field.Value;
          fieldsWithValues.add(field.FieldKey);

          // Check if it's a custom field
          if (field.IsCustomField) {
            existingCustomFields.push({
              tempId: field.FieldKey,
              label: field.Label,
              fieldType: field.FieldType,
              isHidden: field.IsHidden,
              displayOrder: field.DisplayOrder
            });
          }
        });

        // Normalize birthdate if present
        if (initialValues['alias.birthdate']) {
          initialValues['alias.birthdate'] = IdentityHelperUtils.normalizeBirthDate(
            initialValues['alias.birthdate'] as string
          );
        }

        setFieldValues(initialValues);
        setCustomFields(existingCustomFields);
        setInitiallyVisibleFields(fieldsWithValues);

        // Load attachments for this item
        const itemAttachments = await dbContext.sqliteClient!.settings.getAttachmentsForItem(id);
        setAttachments(itemAttachments);
        setOriginalAttachmentIds(itemAttachments.map(a => a.Id));
        if (itemAttachments.length > 0) {
          setShowAttachments(true);
        }

        // Load TOTP codes for this item
        const itemTotpCodes = await dbContext.sqliteClient!.settings.getTotpCodesForItem(id);
        setTotpCodes(itemTotpCodes);
        setOriginalTotpCodeIds(itemTotpCodes.map(tc => tc.Id));
        if (itemTotpCodes.length > 0) {
          setShow2FA(true);
        }

        // Load passkeys for this item
        const itemPasskeys = await dbContext.sqliteClient!.passkeys.getByItemId(id);
        setPasskeyIds(itemPasskeys.map(pk => pk.Id));
      }
    } catch (err) {
      console.error('Error loading item:', err);
      Toast.show({
        type: 'error',
        text1: t('common.error'),
        text2: t('common.errors.unknownErrorTryAgain')
      });
    }
  }, [id, dbContext.sqliteClient, t]);

  /**
   * On mount, load an existing item if we're in edit mode, or initialize new item.
   */
  useEffect(() => {
    /**
     * Initialize the component.
     * Offline mode is fully supported - items can be added/edited locally
     * and will sync when back online.
     */
    const initializeComponent = async (): Promise<void> => {
      // Load folders for folder selection
      try {
        const loadedFolders = await dbContext.sqliteClient!.folders.getAll();
        setFolders(loadedFolders);
      } catch (err) {
        console.error('Error loading folders:', err);
      }

      if (isEditMode) {
        loadExistingItem();
      } else {
        // Create mode - initialize new item
        let serviceName = '';
        let itemUrl = '';

        if (serviceUrl) {
          const decodedUrl = decodeURIComponent(serviceUrl);
          serviceName = extractServiceNameFromUrl(decodedUrl);
          itemUrl = decodedUrl;
        }

        // Determine effective type from URL param or default
        const effectiveType: ItemType = (itemTypeParam && VALID_ITEM_TYPES.includes(itemTypeParam as ItemType))
          ? itemTypeParam as ItemType
          : DEFAULT_ITEM_TYPE;

        const newItem: Item = {
          Id: crypto.randomUUID().toUpperCase(),
          Name: serviceName,
          ItemType: effectiveType,
          FolderId: null,
          Fields: [],
          CreatedAt: new Date().toISOString(),
          UpdatedAt: new Date().toISOString()
        };

        setItem(newItem);

        // Set URL in field values if provided
        if (itemUrl) {
          setFieldValues(prev => ({
            ...prev,
            'login.url': itemUrl
          }));
        }

        // Focus the item name field after a short delay
        setTimeout(() => {
          itemNameRef.current?.focus();
        }, 100);
      }
    };

    initializeComponent();
  }, [id, isEditMode, serviceUrl, itemTypeParam, loadExistingItem, router, t, dbContext.sqliteClient]);

  /**
   * Auto-generate alias when alias fields are shown by default in create mode.
   */
  useEffect(() => {
    if (!isEditMode && aliasFieldsShownByDefault && item && dbContext?.sqliteClient && !aliasGeneratedRef.current) {
      aliasGeneratedRef.current = true;
      void generateRandomAlias();
    }
  }, [isEditMode, aliasFieldsShownByDefault, item, dbContext?.sqliteClient, generateRandomAlias]);

  /**
   * Handle item type change.
   */
  const handleTypeChange = useCallback((newType: ItemType) => {
    if (!item) {
      return;
    }

    const oldType = item.ItemType;

    // Clear field values that don't apply to the new type
    if (oldType !== newType) {
      setFieldValues(prev => {
        const newValues: Record<string, string | string[]> = {};
        Object.entries(prev).forEach(([key, value]) => {
          const systemField = getSystemField(key);
          if (systemField) {
            if (fieldAppliesToType(systemField, newType)) {
              newValues[key] = value;
            }
          } else {
            // Custom fields are always kept
            newValues[key] = value;
          }
        });
        return newValues;
      });

      // Clear manually added fields that don't apply to new type
      setManuallyAddedFields(prev => {
        const newSet = new Set<string>();
        prev.forEach(fieldKey => {
          const systemField = getSystemField(fieldKey);
          if (!systemField || fieldAppliesToType(systemField, newType)) {
            newSet.add(fieldKey);
          }
        });
        return newSet;
      });

      // Clear initially visible fields that don't apply to new type (edit mode)
      if (isEditMode) {
        setInitiallyVisibleFields(prev => {
          const newSet = new Set<string>();
          prev.forEach(fieldKey => {
            const systemField = getSystemField(fieldKey);
            if (!systemField || fieldAppliesToType(systemField, newType)) {
              newSet.add(fieldKey);
            }
          });
          return newSet;
        });
      }
    }

    // Reset alias generated flag
    aliasGeneratedRef.current = false;

    setItem({
      ...item,
      ItemType: newType,
      Fields: []
    });

    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [item, isEditMode]);

  /**
   * Handle adding an optional system field.
   */
  const handleAddOptionalField = useCallback((fieldKey: string): void => {
    setManuallyAddedFields(prev => new Set(prev).add(fieldKey));
    setHasUnsavedChanges(true);
  }, []);

  /**
   * Handle removing an optional field.
   */
  const handleRemoveOptionalField = useCallback((fieldKey: string): void => {
    setManuallyAddedFields(prev => {
      const newSet = new Set(prev);
      newSet.delete(fieldKey);
      return newSet;
    });
    setFieldValues(prev => {
      const newValues = { ...prev };
      delete newValues[fieldKey];
      return newValues;
    });
    setHasUnsavedChanges(true);
  }, []);

  /**
   * Add custom field handler.
   */
  const handleAddCustomField = useCallback((label: string, fieldType: FieldType) => {
    const tempId = crypto.randomUUID();
    const newField: CustomFieldDefinition = {
      tempId,
      label,
      fieldType,
      isHidden: false,
      displayOrder: applicableSystemFields.length + customFields.length + 1
    };

    setCustomFields(prev => [...prev, newField]);
    setHasUnsavedChanges(true);
  }, [applicableSystemFields.length, customFields.length]);

  /**
   * Delete custom field handler.
   */
  const handleDeleteCustomField = useCallback((tempId: string) => {
    setCustomFields(prev => prev.filter(f => f.tempId !== tempId));
    setFieldValues(prev => {
      const newValues = { ...prev };
      delete newValues[tempId];
      return newValues;
    });
    setHasUnsavedChanges(true);
  }, []);

  /**
   * Optional sections for AddFieldMenu.
   */
  const optionalSections = useMemo((): OptionalSection[] => {
    const sections: OptionalSection[] = [];
    // 2FA - only for types with login fields
    if (hasLoginFields) {
      sections.push({
        key: '2fa',
        isVisible: show2FA,
        /**
         * Show the 2FA section
         */
        onAdd: () => setShow2FA(true)
      });
    }
    // Attachments - always available
    sections.push({
      key: 'attachments',
      isVisible: showAttachments,
      /**
       * Show the attachments section
       */
      onAdd: () => setShowAttachments(true)
    });
    return sections;
  }, [hasLoginFields, show2FA, showAttachments]);

  /**
   * Submit the form.
   * Non-blocking for local saves. Only shows loading indicator when fetching favicon.
   */
  const onSubmit = useCallback(async (): Promise<void> => {
    if (isSaveDisabled || !item) {
      return;
    }

    setIsSaveDisabled(true);
    Keyboard.dismiss();

    // Build the fields array from fieldValues
    const fields: ItemField[] = [];

    applicableSystemFields.forEach(systemField => {
      const value = fieldValues[systemField.FieldKey];

      // Only include fields with non-empty values
      if (value && (Array.isArray(value) ? value.length > 0 : value.toString().trim() !== '')) {
        fields.push({
          FieldKey: systemField.FieldKey,
          Label: systemField.FieldKey,
          FieldType: systemField.FieldType,
          Value: value,
          IsHidden: systemField.IsHidden,
          DisplayOrder: systemField.DefaultDisplayOrder,
          IsCustomField: false,
          EnableHistory: systemField.EnableHistory
        });
      }
    });

    // Add custom fields
    customFields.forEach(customField => {
      const value = fieldValues[customField.tempId];

      if (value && (Array.isArray(value) ? value.length > 0 : value.toString().trim() !== '')) {
        fields.push({
          FieldKey: customField.tempId,
          Label: customField.label,
          FieldType: customField.fieldType,
          Value: value,
          IsHidden: customField.isHidden,
          DisplayOrder: customField.displayOrder,
          IsCustomField: true,
          EnableHistory: false
        });
      }
    });

    // Normalize birthdate if present
    const birthdateField = fields.find(f => f.FieldKey === 'alias.birthdate');
    if (birthdateField && typeof birthdateField.Value === 'string') {
      birthdateField.Value = IdentityHelperUtils.normalizeBirthDate(birthdateField.Value);
    }

    // Build the item to save
    let itemToSave: Item = {
      ...item,
      Id: isEditMode ? id : crypto.randomUUID().toUpperCase(),
      Name: item.Name || t('items.untitled'),
      Fields: fields,
      UpdatedAt: new Date().toISOString()
    };

    // Extract favicon from URL if present (only show loading for this network operation)
    const urlValue = fieldValues['login.url'];
    const urlString = Array.isArray(urlValue) ? urlValue[0] : urlValue;
    const shouldFetchFavicon = urlString && urlString !== 'https://' && urlString !== 'http://';

    if (shouldFetchFavicon) {
      // Only show loading indicator when fetching favicon
      setIsSaving(true);
      setSaveStatus(t('vault.savingChangesToVault'));

      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Favicon extraction timed out')), 5000)
        );

        const faviconPromise = webApi.get<FaviconExtractModel>('Favicon/Extract?url=' + urlString);
        const faviconResponse = await Promise.race([faviconPromise, timeoutPromise]) as FaviconExtractModel;
        if (faviconResponse?.image) {
          const decodedImage = Uint8Array.from(Buffer.from(faviconResponse.image as string, 'base64'));
          itemToSave.Logo = decodedImage;
        }
      } catch {
        // Favicon extraction failed or timed out - not critical, continue with save
      }
    }

    /*
     * Execute mutation - local save + background sync (non-blocking).
     * Navigate immediately after local save; sync happens in background via ServerSyncIndicator.
     */
    try {
      await executeVaultMutation(async () => {
        if (isEditMode) {
          await dbContext.sqliteClient!.items.update(itemToSave, originalAttachmentIds, attachments, originalTotpCodeIds, totpCodes);

          // Delete passkeys if marked for deletion
          if (passkeyIdsMarkedForDeletion.length > 0) {
            for (const passkeyId of passkeyIdsMarkedForDeletion) {
              await dbContext.sqliteClient!.passkeys.delete(passkeyId);
            }
          }
        } else {
          await dbContext.sqliteClient!.items.create(itemToSave, attachments, totpCodes);
        }
      });

      // Emit event to notify list and detail views to refresh
      emitter.emit('credentialChanged', itemToSave.Id);
      setHasUnsavedChanges(false);
      setIsSaving(false);
      setIsSaveDisabled(false);

      // Navigate immediately - sync continues in background
      if (serviceUrl && !isEditMode) {
        router.replace('/items/autofill-item-created');
      } else {
        router.dismiss();

        setTimeout(() => {
          if (isEditMode) {
            Toast.show({
              type: 'success',
              text1: t('items.toasts.itemUpdated'),
              position: 'bottom'
            });
          } else {
            Toast.show({
              type: 'success',
              text1: t('items.toasts.itemCreated'),
              position: 'bottom'
            });
            router.push(`/items/${itemToSave.Id}`);
          }
        }, 100);
      }
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: t('common.error'),
        text2: error instanceof Error ? error.message : t('common.errors.unknownError'),
        position: 'bottom'
      });
      console.error('Error saving item:', error);
      setIsSaving(false);
      setIsSaveDisabled(false);
    }
  }, [isEditMode, id, serviceUrl, router, executeVaultMutation, dbContext.sqliteClient, webApi, isSaveDisabled, item, fieldValues, applicableSystemFields, customFields, t, originalAttachmentIds, attachments, originalTotpCodeIds, totpCodes, passkeyIdsMarkedForDeletion]);

  /**
   * Handle the delete button press.
   */
  const handleDelete = async (): Promise<void> => {
    if (!id) {
      return;
    }

    Keyboard.dismiss();

    Alert.alert(
      t('items.deleteItem'),
      t('items.deleteConfirm'),
      [
        {
          text: t('common.cancel'),
          style: "cancel"
        },
        {
          text: t('common.delete'),
          style: "destructive",
          /**
           * Delete the item
           */
          onPress: async (): Promise<void> => {
            await executeVaultMutation(async () => {
              await dbContext.sqliteClient!.items.trash(id);
            });

            emitter.emit('credentialChanged', id);

            setTimeout(() => {
              Toast.show({
                type: 'success',
                text1: t('items.toasts.itemDeleted'),
                position: 'bottom'
              });
            }, 200);

            router.back();
            router.back();
          }
        }
      ]
    );
  };

  /**
   * Handle cancel button press.
   */
  const handleCancel = useCallback((): void => {
    if (hasUnsavedChanges) {
      Alert.alert(
        t('items.unsavedChanges.title'),
        t('items.unsavedChanges.message'),
        [
          {
            text: t('common.cancel'),
            style: 'cancel',
          },
          {
            text: t('items.unsavedChanges.discard'),
            style: 'destructive',
            /**
             * Discard unsaved changes and navigate back
             */
            onPress: (): void => {
              setHasUnsavedChanges(false);
              router.back();
            },
          },
        ]
      );
    } else {
      router.back();
    }
  }, [hasUnsavedChanges, router, t]);

  /**
   * Get the top padding for the container.
   */
  const getTopPadding = (): number => {
    if (Platform.OS !== 'ios') {
      return 0;
    }
    const iosVersion = parseInt(Platform.Version as string, 10);
    return iosVersion >= 26 ? 72 : 52;
  };

  /**
   * Get category title for display.
   */
  const getCategoryTitle = useCallback((category: string): string => {
    switch (category) {
      case FieldCategories.Login:
        return t('items.loginCredentials');
      case FieldCategories.Alias:
        return t('items.alias');
      case FieldCategories.Card:
        return t('itemTypes.creditCard.cardInformation');
      default:
        return category;
    }
  }, [t]);

  /**
   * Get testID for a field based on its field key.
   */
  const getFieldTestId = useCallback((fieldKey: string): string | undefined => {
    const testIdMap: Record<string, string> = {
      'login.url': 'service-url-input',
      'login.email': 'login-email-input',
      'login.username': 'login-username-input',
      'login.password': 'login-password-input',
    };
    return testIdMap[fieldKey];
  }, []);

  /**
   * Render a field input based on field type.
   */
  const renderFieldInput = useCallback((
    fieldKey: string,
    label: string,
    fieldType: FieldType,
    isHidden: boolean,
    _isMultiValue: boolean,
    onRemove?: () => void
  ): React.ReactNode => {
    const value = fieldValues[fieldKey] || '';
    const stringValue = Array.isArray(value) ? value[0] || '' : value;
    const testID = getFieldTestId(fieldKey);

    switch (fieldType) {
      case FieldTypes.Password:
        return (
          <AdvancedPasswordField
            value={stringValue}
            onChangeText={(val) => handleFieldChange(fieldKey, val)}
            label={label}
            showPassword={isPasswordVisible}
            onShowPasswordChange={setIsPasswordVisible}
            isNewCredential={!isEditMode}
            onRemove={onRemove}
            testID={testID}
          />
        );

      case FieldTypes.Hidden:
        return (
          <HiddenField
            value={stringValue}
            onChangeText={(val) => handleFieldChange(fieldKey, val)}
            label={label}
            keyboardType={fieldKey === 'card.pin' || fieldKey === 'card.cvv' ? 'numeric' : 'default'}
            onRemove={onRemove}
            testID={testID}
          />
        );

      case FieldTypes.Email:
        return (
          <EmailDomainField
            value={stringValue}
            onChange={(val) => handleFieldChange(fieldKey, val)}
            label={label}
            onRemove={onRemove}
            testID={testID}
          />
        );

      case FieldTypes.TextArea:
        return (
          <FormField
            value={stringValue}
            onChangeText={(val) => handleFieldChange(fieldKey, val)}
            label={label}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            onRemove={onRemove}
            testID={testID}
          />
        );

      case FieldTypes.Text:
      case FieldTypes.URL:
      case FieldTypes.Phone:
      case FieldTypes.Number:
      case FieldTypes.Date:
      default:
        // Use username field with regenerate button for login.username when alias fields are shown
        if (fieldKey === 'login.username' && aliasFieldsShownByDefault) {
          return (
            <FormField
              value={stringValue}
              onChangeText={(val) => handleFieldChange(fieldKey, val)}
              label={label}
              buttons={[{
                icon: "refresh",
                onPress: generateRandomUsername
              }]}
              onRemove={onRemove}
              testID={testID}
            />
          );
        }
        return (
          <FormField
            value={stringValue}
            onChangeText={(val) => handleFieldChange(fieldKey, val)}
            label={label}
            placeholder={fieldKey === 'alias.birthdate' ? t('items.birthDatePlaceholder') : undefined}
            keyboardType={fieldType === FieldTypes.Phone || fieldType === FieldTypes.Number ? 'numeric' : 'default'}
            onRemove={onRemove}
            testID={testID}
          />
        );
    }
  }, [fieldValues, handleFieldChange, isPasswordVisible, isEditMode, aliasFieldsShownByDefault, generateRandomUsername, t, getFieldTestId]);

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      paddingTop: getTopPadding(),
    },
    contentContainer: {
      paddingBottom: 40,
      paddingTop: 16,
    },
    deleteButton: {
      alignItems: 'center',
      backgroundColor: colors.errorBackground,
      borderColor: colors.errorBorder,
      borderRadius: 8,
      borderWidth: 1,
      padding: 10,
    },
    deleteButtonText: {
      color: colors.errorText,
      fontWeight: '600',
    },
    headerLeftButton: {
      paddingHorizontal: 8,
    },
    headerLeftButtonText: {
      color: colors.primary,
    },
    headerRightButton: {
      paddingHorizontal: 8,
    },
    headerRightButtonDisabled: {
      opacity: 0.5,
    },
    passkeyContainer: {
      backgroundColor: colors.background,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      marginBottom: 8,
      marginTop: 8,
      padding: 12,
    },
    passkeyDeletedContainer: {
      backgroundColor: colors.errorBackground,
      borderColor: colors.errorBorder,
    },
    passkeyHeader: {
      alignItems: 'flex-start',
      flexDirection: 'row',
    },
    passkeyHeaderRight: {
      flex: 1,
    },
    passkeyHelpText: {
      color: colors.textMuted,
      fontSize: 11,
      marginTop: 4,
    },
    passkeyIcon: {
      marginRight: 8,
      marginTop: 2,
    },
    passkeyTitleRow: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    passkeyTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    passkeyTitleDeleted: {
      color: colors.errorText,
    },
    sectionHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
    },
    sectionTitleWithBadge: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
    },
    addEmailBadge: {
      alignItems: 'center',
      borderColor: colors.accentBorder,
      borderRadius: 12,
      borderStyle: 'dashed',
      borderWidth: 1,
      flexDirection: 'row',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    addEmailBadgeText: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '500',
    },
  });

  // Set header buttons
  useEffect(() => {
    navigation.setOptions({
      ...(Platform.OS === 'ios' && {
        /**
         * Show the cancel button
         */
        headerLeft: (): React.ReactNode => (
          <RobustPressable
            onPress={handleCancel}
            style={styles.headerLeftButton}
          >
            <ThemedText style={styles.headerLeftButtonText}>{t('common.cancel')}</ThemedText>
          </RobustPressable>
        ),
      }),
      /**
       * Show the save button
       */
      headerRight: () => (
        <TouchableOpacity
          onPress={onSubmit}
          style={[styles.headerRightButton, isSaveDisabled && styles.headerRightButtonDisabled]}
          disabled={isSaveDisabled}
          testID="save-button"
          accessibilityLabel="save-button"
        >
          <MaterialIcons
            name="save"
            size={Platform.OS === 'android' ? 24 : 22}
            color={colors.primary}
          />
        </TouchableOpacity>
      ),
    });
  }, [navigation, onSubmit, colors.primary, isEditMode, router, styles.headerLeftButton, styles.headerLeftButtonText, styles.headerRightButton, styles.headerRightButtonDisabled, isSaveDisabled, t, handleCancel]);

  // Check for passkeys (in edit mode)
  const hasPasskey = useMemo(() => {
    return item?.HasPasskey ?? false;
  }, [item]);

  if (!item) {
    return null;
  }

  return (
    <>
      <Stack.Screen options={{ title: isEditMode ? t('items.editItem') : t('items.addItem') }} />
      {isSaving && (
        <LoadingOverlay status={saveStatus} />
      )}

      <ThemedContainer style={styles.container} testID="add-edit-screen">
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 30 : 80}
        >
          <ScrollView
            contentContainerStyle={styles.contentContainer}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Item Type Selector */}
            <ItemTypeSelector
              selectedType={item.ItemType}
              isEditMode={isEditMode}
              onTypeChange={handleTypeChange}
              onRegenerateAlias={aliasFieldsShownByDefault ? generateRandomAlias : undefined}
            />

            {/* Item Name and Primary Fields Section */}
            <FormSection title={t('items.service')}>
              <ItemNameField
                ref={itemNameRef}
                value={item.Name ?? ''}
                onChangeText={(value) => {
                  setItem(prev => prev ? { ...prev, Name: value } : prev);
                  setHasUnsavedChanges(true);
                }}
                folders={folders}
                selectedFolderId={item.FolderId}
                onFolderChange={(folderId) => {
                  setItem(prev => prev ? { ...prev, FolderId: folderId } : prev);
                  setHasUnsavedChanges(true);
                }}
              />
              {/* Primary fields (like URL) */}
              {primaryFields.map(field => (
                <View key={field.FieldKey}>
                  {renderFieldInput(
                    field.FieldKey,
                    t(`fieldLabels.${field.FieldKey}`, { defaultValue: t('items.serviceUrl') }),
                    field.FieldType,
                    field.IsHidden,
                    field.IsMultiValue
                  )}
                </View>
              ))}
            </FormSection>

            {/* Passkey Section - only in edit mode for items with passkeys */}
            {isEditMode && hasPasskey && (
              <FormSection title={t('passkeys.passkey')}>
                {!passkeyIdsMarkedForDeletion.length ? (
                  <View style={styles.passkeyContainer}>
                    <View style={styles.passkeyHeader}>
                      <MaterialIcons
                        name="vpn-key"
                        size={20}
                        color={colors.primary}
                        style={styles.passkeyIcon}
                      />
                      <View style={styles.passkeyHeaderRight}>
                        <View style={styles.passkeyTitleRow}>
                          <ThemedText style={styles.passkeyTitle}>
                            {t('passkeys.passkey')}
                          </ThemedText>
                          <RobustPressable
                            onPress={() => setPasskeyIdsMarkedForDeletion(passkeyIds)}
                            style={{
                              padding: 6,
                              borderRadius: 4,
                              backgroundColor: colors.destructive + '15'
                            }}
                          >
                            <MaterialIcons
                              name="delete"
                              size={18}
                              color={colors.destructive}
                            />
                          </RobustPressable>
                        </View>
                        <ThemedText style={styles.passkeyHelpText}>
                          {t('passkeys.helpText')}
                        </ThemedText>
                      </View>
                    </View>
                  </View>
                ) : (
                  <View style={[styles.passkeyContainer, styles.passkeyDeletedContainer]}>
                    <View style={styles.passkeyHeader}>
                      <MaterialIcons
                        name="vpn-key"
                        size={20}
                        color={colors.errorText}
                        style={styles.passkeyIcon}
                      />
                      <View style={styles.passkeyHeaderRight}>
                        <View style={styles.passkeyTitleRow}>
                          <ThemedText style={[styles.passkeyTitle, styles.passkeyTitleDeleted]}>
                            {t('passkeys.passkeyMarkedForDeletion')}
                          </ThemedText>
                          <RobustPressable
                            onPress={() => setPasskeyIdsMarkedForDeletion([])}
                            style={{ padding: 4 }}
                          >
                            <MaterialIcons
                              name="undo"
                              size={18}
                              color={colors.textMuted}
                            />
                          </RobustPressable>
                        </View>
                        <ThemedText style={[styles.passkeyHelpText, { color: colors.errorText }]}>
                          {t('passkeys.passkeyWillBeDeleted')}
                        </ThemedText>
                      </View>
                    </View>
                  </View>
                )}
              </FormSection>
            )}

            {/* Render fields grouped by category */}
            {Object.keys(groupedSystemFields).map(category => {
              const categoryFields = groupedSystemFields[category];
              const visibleFields = categoryFields.filter(field => shouldShowField(field));

              // Find email field for potential "+ Email" button (only for Login category)
              const emailField = category === FieldCategories.Login
                ? categoryFields.find(f => f.FieldKey === 'login.email')
                : null;
              const showEmailAddButton = emailField && !shouldShowField(emailField);

              // Sort login fields: email first, then username, then password
              const sortedVisibleFields = category === FieldCategories.Login
                ? [...visibleFields].sort((a, b) => {
                  const order: Record<string, number> = {
                    'login.email': 0,
                    'login.username': 1,
                    'login.password': 2
                  };
                  const aOrder = order[a.FieldKey] ?? 99;
                  const bOrder = order[b.FieldKey] ?? 99;
                  return aOrder - bOrder;
                })
                : visibleFields;

              // Don't render category section if no visible fields and no add button
              if (sortedVisibleFields.length === 0 && !showEmailAddButton) {
                return null;
              }

              return (
                <FormSection
                  key={category}
                  title={
                    <View style={styles.sectionHeader}>
                      <View style={styles.sectionTitleWithBadge}>
                        <ThemedText style={styles.sectionTitle}>
                          {getCategoryTitle(category)}
                        </ThemedText>
                        {showEmailAddButton && (
                          <RobustPressable
                            onPress={() => handleAddOptionalField('login.email')}
                            style={styles.addEmailBadge}
                            testID="add-email-button"
                          >
                            <MaterialIcons name="add" size={14} color={colors.textMuted} />
                            <ThemedText style={styles.addEmailBadgeText}>
                              {t('items.email')}
                            </ThemedText>
                          </RobustPressable>
                        )}
                      </View>
                      {/* Section action: Regenerate button for Alias category */}
                      {category === FieldCategories.Alias && aliasFieldsShownByDefault && (
                        <RobustPressable onPress={generateRandomAlias} style={{ padding: 4 }}>
                          <MaterialIcons name="refresh" size={20} color={colors.textMuted} />
                        </RobustPressable>
                      )}
                    </View>
                  }
                >
                  {sortedVisibleFields.map(field => {
                    const canRemoveField = item && manuallyAddedFields.has(field.FieldKey) &&
                      !isFieldShownByDefault(field, item.ItemType);

                    return (
                      <View key={field.FieldKey}>
                        {renderFieldInput(
                          field.FieldKey,
                          t(`fieldLabels.${field.FieldKey}`, { defaultValue: field.FieldKey }),
                          field.FieldType,
                          field.IsHidden,
                          field.IsMultiValue,
                          canRemoveField ? (): void => handleRemoveOptionalField(field.FieldKey) : undefined
                        )}
                      </View>
                    );
                  })}
                </FormSection>
              );
            })}

            {/* Custom Fields Section */}
            {customFields.length > 0 && (
              <FormSection title={t('itemTypes.customFields')}>
                {customFields.map(field => (
                  <View key={field.tempId}>
                    {renderFieldInput(
                      field.tempId,
                      field.label,
                      field.fieldType,
                      field.isHidden,
                      false,
                      () => handleDeleteCustomField(field.tempId)
                    )}
                  </View>
                ))}
              </FormSection>
            )}

            {/* Notes Section */}
            {notesField && visibleFieldKeys.has('notes.content') && (
              <FormSection
                title={t('items.notes')}
                actions={
                  !shouldShowField(notesField) ? (
                    <RobustPressable
                      onPress={() => handleRemoveOptionalField('notes.content')}
                      style={{ padding: 4 }}
                    >
                      <MaterialIcons name="close" size={18} color={colors.textMuted} />
                    </RobustPressable>
                  ) : undefined
                }
              >
                {renderFieldInput(
                  notesField.FieldKey,
                  '', // No label - FormSection title is sufficient
                  notesField.FieldType,
                  notesField.IsHidden,
                  notesField.IsMultiValue
                )}
              </FormSection>
            )}

            {/* 2FA TOTP Section - only for types with login fields */}
            {show2FA && hasLoginFields && (
              <FormSection title={t('common.twoFactorAuthentication')}>
                <TotpEditor
                  totpCodes={totpCodes}
                  onTotpCodesChange={setTotpCodes}
                  originalTotpCodeIds={originalTotpCodeIds}
                />
              </FormSection>
            )}

            {/* Attachments Section */}
            {showAttachments && (
              <FormSection title={t('items.attachments')}>
                <AttachmentUploader
                  attachments={attachments}
                  onAttachmentsChange={setAttachments}
                />
              </FormSection>
            )}

            {/* Add Field Menu */}
            <AddFieldMenu
              optionalSystemFields={optionalSystemFields}
              visibleFieldKeys={visibleFieldKeys}
              optionalSections={optionalSections}
              callbacks={{
                onAddSystemField: handleAddOptionalField,
                onAddCustomField: handleAddCustomField
              }}
            />

            {/* Delete Button (edit mode only) */}
            {isEditMode && (
              <View style={{ marginTop: 24 }}>
                <RobustPressable
                  style={styles.deleteButton}
                  onPress={handleDelete}
                  testID="delete-item-button"
                >
                  <ThemedText style={styles.deleteButtonText}>{t('items.deleteItem')}</ThemedText>
                </RobustPressable>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </ThemedContainer>
      <AliasVaultToast />
    </>
  );
}
