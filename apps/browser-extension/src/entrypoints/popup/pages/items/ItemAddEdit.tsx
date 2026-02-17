import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import Modal from '@/entrypoints/popup/components/Dialogs/Modal';
import AddFieldMenu, { type OptionalSection } from '@/entrypoints/popup/components/Forms/AddFieldMenu';
import DraggableCustomFieldsList, { type CustomFieldDefinition } from '@/entrypoints/popup/components/Forms/DraggableCustomFieldsList';
import EmailDomainField from '@/entrypoints/popup/components/Forms/EmailDomainField';
import { FormInput } from '@/entrypoints/popup/components/Forms/FormInput';
import FormSection from '@/entrypoints/popup/components/Forms/FormSection';
import HiddenField from '@/entrypoints/popup/components/Forms/HiddenField';
import PasswordField from '@/entrypoints/popup/components/Forms/PasswordField';
import UsernameField from '@/entrypoints/popup/components/Forms/UsernameField';
import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import AttachmentUploader from '@/entrypoints/popup/components/Items/Details/AttachmentUploader';
import PasskeyEditor from '@/entrypoints/popup/components/Items/Details/PasskeyEditor';
import TotpEditor from '@/entrypoints/popup/components/Items/Details/TotpEditor';
import ItemNameInput from '@/entrypoints/popup/components/Items/ItemNameInput';
import ItemTypeSelector from '@/entrypoints/popup/components/Items/ItemTypeSelector';
import LoadingSpinner from '@/entrypoints/popup/components/LoadingSpinner';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';
import useAliasGenerator from '@/entrypoints/popup/hooks/useAliasGenerator';
import useFormPersistence from '@/entrypoints/popup/hooks/useFormPersistence';
import useServiceDetection from '@/entrypoints/popup/hooks/useServiceDetection';
import { useVaultMutate } from '@/entrypoints/popup/hooks/useVaultMutate';

import { UsernameEmailGenerator, Gender } from '@/utils/dist/core/identity-generator';
import type { Item, ItemField, ItemType, FieldType, Attachment, TotpCode, PasswordSettings } from '@/utils/dist/core/models/vault';
import { FieldCategories, FieldTypes, ItemTypes, getSystemFieldsForItemType, getOptionalFieldsForItemType, isFieldShownByDefault, getSystemField, fieldAppliesToType } from '@/utils/dist/core/models/vault';
import { FaviconService } from '@/utils/FaviconService';
import { LocalPreferencesService } from '@/utils/LocalPreferencesService';

// Valid item types from the shared model
const VALID_ITEM_TYPES: ItemType[] = [ItemTypes.Login, ItemTypes.Alias, ItemTypes.CreditCard, ItemTypes.Note];

// Default item type for new items
const DEFAULT_ITEM_TYPE: ItemType = ItemTypes.Login;

/**
 * Persisted form data type used for JSON serialization.
 * This is the data portion stored via useFormPersistence hook.
 */
type PersistedFormData = {
  item: Item | null;
  fieldValues: Record<string, string | string[]>;
  customFields: CustomFieldDefinition[];
  totpEditorState?: {
    isAddFormVisible: boolean;
    formData: {
      name: string;
      secretKey: string;
    };
  };
  show2FA: boolean;
  showAttachments: boolean;
  manuallyAddedFields: string[];
  isLoginEmailInEmailMode?: boolean;
  passwordSettings?: PasswordSettings;
};

/**
 * Add or edit item page with dynamic field support.
 * Shows all applicable system fields for the item type, not just fields with values.
 */
const ItemAddEdit: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const dbContext = useDb();
  const isEditMode = id !== undefined && id.length > 0;

  // Get item type, name, and folder from URL parameters (for create mode)
  const itemTypeParam = searchParams.get('type') as ItemType | null;
  const itemNameParam = searchParams.get('name');
  const folderIdParam = searchParams.get('folderId');

  const { executeVaultMutationAsync } = useVaultMutate();
  const { setHeaderButtons } = useHeaderButtons();
  const { setIsInitialLoading } = useLoading();
  const { generateAlias, generateRandomEmailPrefix, lastGeneratedValues } = useAliasGenerator();
  const { detectService } = useServiceDetection();
  const webApi = useWebApi();

  // Component state
  const [localLoading, setLocalLoading] = useState(true);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [item, setItem] = useState<Item | null>(null);

  // Form state for dynamic fields
  const [fieldValues, setFieldValues] = useState<Record<string, string | string[]>>({});

  // Custom field definitions (temporary until saved)
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);

  // Folder selection state
  const [folders, setFolders] = useState<Array<{ Id: string; Name: string }>>([]);

  // UI visibility state
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [show2FA, setShow2FA] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);

  // Track if alias was already auto-generated (to avoid re-generating on re-renders)
  const aliasGeneratedRef = useRef(false);

  // Ref for the item name input field (for auto-focus)
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Track password field visibility (for showing generated passwords)
  const [showPassword, setShowPassword] = useState(false);

  // Track manually added optional fields (fields that are not shown by default but user added)
  const [manuallyAddedFields, setManuallyAddedFields] = useState<Set<string>>(new Set());

  // Track fields that had values initially (edit mode) - these stay visible even if value is cleared
  const [initiallyVisibleFields, setInitiallyVisibleFields] = useState<Set<string>>(new Set());

  // TOTP codes state
  const [totpCodes, setTotpCodes] = useState<TotpCode[]>([]);
  const [originalTotpCodeIds, setOriginalTotpCodeIds] = useState<string[]>([]);
  const [totpEditorState, setTotpEditorState] = useState<{
    isAddFormVisible: boolean;
    formData: { name: string; secretKey: string };
  }>({
    isAddFormVisible: false,
    formData: { name: '', secretKey: '' }
  });

  // Attachments state
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [originalAttachmentIds, setOriginalAttachmentIds] = useState<string[]>([]);

  // Passkeys state (only IDs marked for deletion - passkeys cannot be created/edited manually)
  const [passkeyIdsMarkedForDeletion, setPasskeyIdsMarkedForDeletion] = useState<string[]>([]);

  // Track email field mode for Login type (true = free text "Email", false = domain chooser "Alias")
  const [isLoginEmailInEmailMode, setIsLoginEmailInEmailMode] = useState(true);

  // Track password settings for persistence (so slider position and options are remembered)
  const [passwordSettings, setPasswordSettings] = useState<PasswordSettings | undefined>(undefined);

  // Track whether to skip form restoration (set during initialization)
  const [skipFormRestore] = useState(false);

  /**
   * Memoized restore callback for form persistence.
   * Uses stable setter functions, so empty deps array is safe.
   */
  const handleFormRestore = useCallback((data: PersistedFormData) => {
    if (data.item) {
      setItem(data.item);
    }
    if (data.fieldValues) {
      setFieldValues(data.fieldValues);
    }
    if (data.customFields) {
      setCustomFields(data.customFields);
    }
    if (data.totpEditorState) {
      setTotpEditorState(data.totpEditorState);
    }
    if (data.show2FA !== undefined) {
      setShow2FA(data.show2FA);
    }
    if (data.showAttachments !== undefined) {
      setShowAttachments(data.showAttachments);
    }
    if (data.manuallyAddedFields) {
      setManuallyAddedFields(new Set(data.manuallyAddedFields));
    }
    if (data.isLoginEmailInEmailMode !== undefined) {
      setIsLoginEmailInEmailMode(data.isLoginEmailInEmailMode);
    }
    if (data.passwordSettings !== undefined) {
      setPasswordSettings(data.passwordSettings);
    }
  }, []);

  /**
   * Form persistence hook - handles saving/restoring form state to encrypted storage.
   * The hook auto-persists on state changes and clears on unmount.
   */
  const { loadPersistedValues, clearPersistedValues } = useFormPersistence<PersistedFormData>({
    formId: id || null,
    isLoading: localLoading,
    formData: {
      item,
      fieldValues,
      customFields,
      totpEditorState,
      show2FA,
      showAttachments,
      manuallyAddedFields: Array.from(manuallyAddedFields),
      isLoginEmailInEmailMode,
      passwordSettings,
    },
    onRestore: handleFormRestore,
    skipRestore: skipFormRestore,
  });

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
   * The notes field (notes.content) - handled separately for collapsible UI.
   */
  const notesField = useMemo(() => {
    return applicableSystemFields.find(field => field.FieldKey === 'notes.content');
  }, [applicableSystemFields]);

  /**
   * Optional system fields for the current item type.
   * These are fields with ShowByDefault: false that can be added via the + menu.
   */
  const optionalSystemFields = useMemo(() => {
    if (!item) {
      return [];
    }
    return getOptionalFieldsForItemType(item.ItemType);
  }, [item]);

  /**
   * Set of field keys that are currently visible (shown by default, manually added, or have values).
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
    // Add fields that were initially visible (had values)
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
   * Check if a field should be shown for the current item type.
   * Returns true if field is shown by default, was manually added, or had initial value (edit mode).
   */
  const shouldShowField = useCallback((field: { FieldKey: string }) => {
    if (!item) {
      return false;
    }
    // Check if manually added
    if (manuallyAddedFields.has(field.FieldKey)) {
      return true;
    }
    // Check if field was initially visible (had value when loaded in edit mode)
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
      // Skip notes fields - handled separately
      if (field.Category === FieldCategories.Notes) {
        return;
      }
      // Skip metadata fields - handled separately
      if (field.Category === FieldCategories.Metadata) {
        return;
      }
      // Skip primary fields - rendered in name block
      if (field.Category === FieldCategories.Primary) {
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
   * Load item data if in edit mode, or initialize for create mode with service detection.
   */
  useEffect(() => {
    if (!dbContext?.sqliteClient || !id || !isEditMode) {
      // Create mode - initialize with defaults
      const effectiveType: ItemType = (itemTypeParam && VALID_ITEM_TYPES.includes(itemTypeParam))
        ? itemTypeParam
        : DEFAULT_ITEM_TYPE;

      /**
       * Initialize create mode with service detection from URL params or active tab.
       */
      const initializeCreateMode = async (): Promise<void> => {
        // Use the service detection hook to get name and URL
        const { serviceName, serviceUrl } = await detectService(itemNameParam);

        // Create the new item with detected values
        const newItem: Item = {
          Id: crypto.randomUUID().toUpperCase(),
          Name: serviceName,
          ItemType: effectiveType,
          FolderId: folderIdParam || null,
          Fields: [],
          CreatedAt: new Date().toISOString(),
          UpdatedAt: new Date().toISOString()
        };

        setItem(newItem);

        /*
         * Initialize email field mode based on item type
         * Login type: email mode (free text), Alias type: alias mode (domain chooser)
         */
        setIsLoginEmailInEmailMode(effectiveType === ItemTypes.Login);

        // Set the detected URL in field values if we have one
        if (serviceUrl) {
          setFieldValues(prev => ({
            ...prev,
            'login.url': serviceUrl
          }));
        }

        // Load folders
        if (dbContext?.sqliteClient) {
          const allFolders = dbContext.sqliteClient.folders.getAll();
          setFolders(allFolders);
        }

        // Check if we should skip form restoration (e.g., when opened from popout button)
        const skipFormRestore = await LocalPreferencesService.getSkipFormRestore();
        if (skipFormRestore) {
          // Clear the flag after using it
          await LocalPreferencesService.setSkipFormRestore(false);
        } else {
          // Load persisted form values normally
          await loadPersistedValues();
        }

        setLocalLoading(false);
        setIsInitialLoading(false);
      };

      void initializeCreateMode();
      return;
    }

    try {
      const result = dbContext.sqliteClient.items.getById(id);
      if (result) {
        setItem(result);

        // Load folders
        const allFolders = dbContext.sqliteClient.folders.getAll();
        setFolders(allFolders);

        // Initialize field values from existing fields
        const initialValues: Record<string, string | string[]> = {};
        const existingCustomFields: CustomFieldDefinition[] = [];
        const fieldsWithValues = new Set<string>();

        result.Fields.forEach((field) => {
          initialValues[field.FieldKey] = field.Value;
          // Track fields that have values so they stay visible even if cleared
          fieldsWithValues.add(field.FieldKey);

          // Check if it's a custom field using the IsCustomField property
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

        setFieldValues(initialValues);
        // Sort custom fields by displayOrder when loading
        existingCustomFields.sort((a, b) => a.displayOrder - b.displayOrder);
        setCustomFields(existingCustomFields);
        setInitiallyVisibleFields(fieldsWithValues);

        // Load TOTP codes for this item
        const itemTotpCodes = dbContext.sqliteClient.settings.getTotpCodesForItem(id);
        setTotpCodes(itemTotpCodes);
        setOriginalTotpCodeIds(itemTotpCodes.map((tc) => tc.Id));
        if (itemTotpCodes.length > 0) {
          setShow2FA(true);
        }

        // Load attachments for this item
        const itemAttachments = dbContext.sqliteClient.settings.getAttachmentsForItem(id);
        setAttachments(itemAttachments);
        setOriginalAttachmentIds(itemAttachments.map((a) => a.Id));
        if (itemAttachments.length > 0) {
          setShowAttachments(true);
        }

        setLocalLoading(false);
        setIsInitialLoading(false);
      } else {
        console.error('Item not found');
        navigate('/items');
      }
    } catch (err) {
      console.error('Error loading item:', err);
      setLocalLoading(false);
      setIsInitialLoading(false);
    }
  }, [dbContext?.sqliteClient, id, isEditMode, itemTypeParam, itemNameParam, folderIdParam, navigate, setIsInitialLoading, detectService, loadPersistedValues]);

  /**
   * Handle generating alias and populating fields.
   */
  const handleGenerateAlias = useCallback(async () => {
    const generatedData = await generateAlias();
    if (!generatedData) {
      return;
    }

    setFieldValues(prev => {
      const currentUsername = (prev['login.username'] as string) || '';
      const currentPassword = (prev['login.password'] as string) || '';
      const currentEmail = (prev['login.email'] as string) || '';

      const newValues: Record<string, string | string[]> = {
        ...prev,
        // Always update alias identity fields
        'alias.first_name': generatedData.firstName,
        'alias.last_name': generatedData.lastName,
        'alias.gender': generatedData.gender,
        'alias.birthdate': generatedData.birthdate
      };

      // Only overwrite email if it's empty or matches the last generated value
      if (!currentEmail || currentEmail === lastGeneratedValues.email) {
        newValues['login.email'] = generatedData.email;
      }

      // Only overwrite username if it's empty or matches the last generated value
      if (!currentUsername || currentUsername === lastGeneratedValues.username) {
        newValues['login.username'] = generatedData.username;
      }

      // Only overwrite password if it's empty or matches the last generated value
      if (!currentPassword || currentPassword === lastGeneratedValues.password) {
        newValues['login.password'] = generatedData.password;
      }

      return newValues;
    });

    // Show the generated password
    setShowPassword(true);
  }, [generateAlias, lastGeneratedValues]);

  /**
   * Generate an identity-based email alias (for Alias type email field).
   * Uses the current alias field values (first name, last name, birthdate) to derive the email prefix,
   * so the email stays consistent with the filled-in persona fields.
   */
  const handleGenerateAliasEmail = useCallback(() => {
    if (!dbContext?.sqliteClient) {
      return;
    }

    const firstName = (fieldValues['alias.first_name'] as string) || '';
    const lastName = (fieldValues['alias.last_name'] as string) || '';

    let prefix: string;
    if (!firstName.trim() && !lastName.trim()) {
      // No alias identity fields filled in, fall back to random prefix.
      prefix = generateRandomEmailPrefix();
    } else {
      const gender = (fieldValues['alias.gender'] as string) || Gender.Other;
      const birthdate = (fieldValues['alias.birthdate'] as string) || '';

      const generator = new UsernameEmailGenerator();
      prefix = generator.generateEmailPrefix({
        firstName,
        lastName,
        gender: gender as Gender,
        birthDate: birthdate ? new Date(birthdate) : new Date(),
        emailPrefix: '',
        nickName: ''
      });
    }

    const defaultEmailDomain = dbContext.sqliteClient.settings.getDefaultEmailDomain();
    const email = defaultEmailDomain ? `${prefix}@${defaultEmailDomain}` : prefix;

    setFieldValues(prev => ({
      ...prev,
      'login.email': email
    }));
  }, [dbContext?.sqliteClient, fieldValues, generateRandomEmailPrefix]);

  /**
   * Generate a random-string email alias (for Login type email field).
   * Uses random characters instead of identity-based prefixes since Login type
   * has no persona fields to base the email on.
   */
  const handleGenerateRandomEmail = useCallback(() => {
    if (!dbContext?.sqliteClient) {
      return;
    }

    const prefix = generateRandomEmailPrefix();
    const defaultEmailDomain = dbContext.sqliteClient.settings.getDefaultEmailDomain();
    const email = defaultEmailDomain ? `${prefix}@${defaultEmailDomain}` : prefix;

    setFieldValues(prev => ({
      ...prev,
      'login.email': email
    }));
  }, [dbContext?.sqliteClient, generateRandomEmailPrefix]);

  /**
   * Generate a random username using the shared alias generator.
   * Reuses the same logic as full alias generation but only updates the username field.
   */
  const generateRandomUsername = useCallback(async () => {
    const generatedData = await generateAlias();
    if (!generatedData) {
      return;
    }

    // Only update the username field
    setFieldValues(prev => ({
      ...prev,
      'login.username': generatedData.username
    }));
  }, [generateAlias]);

  /**
   * Check if alias fields are shown by default for the current item type.
   * Uses alias.first_name as the indicator since email is now a login field.
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
   * Auto-generate alias when alias fields are shown by default in create mode.
   */
  useEffect(() => {
    if (!isEditMode && aliasFieldsShownByDefault && !localLoading && dbContext?.sqliteClient && !aliasGeneratedRef.current) {
      aliasGeneratedRef.current = true;
      void handleGenerateAlias();
    }
  }, [isEditMode, aliasFieldsShownByDefault, localLoading, dbContext?.sqliteClient, handleGenerateAlias]);

  /**
   * Auto-focus the name input field when in add mode.
   */
  useEffect(() => {
    if (!isEditMode && !localLoading && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [isEditMode, localLoading]);

  /**
   * Handle field value change.
   */
  const handleFieldChange = useCallback((fieldKey: string, value: string | string[]) => {
    setFieldValues(prev => ({
      ...prev,
      [fieldKey]: value
    }));
  }, []);

  /**
   * Handle form submission.
   */
  const handleSave = useCallback(async () => {
    if (!item) {
      return;
    }

    try {
      // Build the fields array from fieldValues
      const fields: ItemField[] = [];

      /* Add system fields */
      applicableSystemFields.forEach(systemField => {
        const value = fieldValues[systemField.FieldKey];

        // Only include fields with non-empty values
        if (value && (Array.isArray(value) ? value.length > 0 : value.trim() !== '')) {
          fields.push({
            FieldKey: systemField.FieldKey,
            Label: systemField.FieldKey, // UI translates via fieldLabels.*
            FieldType: systemField.FieldType,
            Value: value,
            IsHidden: systemField.IsHidden,
            DisplayOrder: systemField.DefaultDisplayOrder,
            IsCustomField: false,
            EnableHistory: systemField.EnableHistory
          });
        }
      });

      // Add custom fields - always persist even if empty (only deleted when explicitly removed)
      customFields.forEach(customField => {
        const value = fieldValues[customField.tempId] || '';

        fields.push({
          FieldKey: customField.tempId,
          Label: customField.label,
          FieldType: customField.fieldType,
          Value: value,
          IsHidden: customField.isHidden,
          DisplayOrder: customField.displayOrder,
          IsCustomField: true,
          EnableHistory: false // Custom fields don't have history enabled by default
        });
      });

      let updatedItem: Item = {
        ...item,
        /*
         * For create mode, always generate a fresh ID to prevent UNIQUE constraint
         * violations if form persistence restored a previously saved item's ID.
         */
        Id: isEditMode ? item.Id : crypto.randomUUID().toUpperCase(),
        Fields: fields,
        UpdatedAt: new Date().toISOString()
      };

      // Fetch and attach favicon from URL if needed (handles deduplication internally)
      if (dbContext?.sqliteClient) {
        setLocalLoading(true);
        updatedItem = await FaviconService.fetchAndAttachFavicon(
          updatedItem,
          fieldValues['login.url'],
          dbContext.sqliteClient,
          webApi
        );
      }

      // Save to database and sync vault
      if (!dbContext?.sqliteClient) {
        throw new Error('Database not initialized');
      }

      /*
       * Use async mutation - saves locally and navigates immediately.
       * Sync happens in background, status shown via header indicator.
       */
      await executeVaultMutationAsync(async () => {
        setLocalLoading(false);

        if (isEditMode) {
          await dbContext.sqliteClient!.items.update(
            updatedItem,
            originalAttachmentIds,
            attachments,
            originalTotpCodeIds,
            totpCodes
          );

          // Delete passkeys marked for deletion
          if (passkeyIdsMarkedForDeletion.length > 0) {
            for (const passkeyId of passkeyIdsMarkedForDeletion) {
              await dbContext.sqliteClient!.passkeys.deleteById(passkeyId);
            }
          }
        } else {
          await dbContext.sqliteClient!.items.create(updatedItem, attachments, totpCodes);
        }
      });

      // Clear persisted form values after successful save
      void clearPersistedValues();

      /*
       * Navigate back after save:
       * - Edit mode: use navigate(-1) to return to the existing details page in history.
       *   This avoids creating duplicate history entries.
       * - Create mode: navigate to the new item's details page, replacing the add page.
       */
      if (isEditMode) {
        navigate(-1);
      } else {
        navigate(`/items/${updatedItem.Id}`, { replace: true });
      }
    } catch (err) {
      console.error('Error saving item:', err);
    }
  }, [item, fieldValues, applicableSystemFields, customFields, dbContext, isEditMode, executeVaultMutationAsync, navigate, originalAttachmentIds, attachments, originalTotpCodeIds, totpCodes, passkeyIdsMarkedForDeletion, webApi, clearPersistedValues]);

  /**
   * Handle delete action.
   */
  const handleDelete = useCallback(async () => {
    if (!item || !isEditMode || !dbContext?.sqliteClient) {
      return;
    }

    try {
      await executeVaultMutationAsync(async () => {
        await dbContext.sqliteClient!.items.trash(item.Id);
      });

      navigate('/items');
    } catch (err) {
      console.error('Error deleting item:', err);
    } finally {
      setShowDeleteModal(false);
    }
  }, [item, isEditMode, dbContext, executeVaultMutationAsync, navigate]);

  /**
   * Add custom field handler.
   */
  const handleAddCustomField = useCallback((label: string, fieldType: FieldType) => {
    /**
     * Custom fields are identified by having FieldDefinitionId set (not FieldKey).
     */
    const tempId = crypto.randomUUID();
    const newField: CustomFieldDefinition = {
      tempId,
      label,
      fieldType,
      isHidden: false,
      displayOrder: applicableSystemFields.length + customFields.length + 1
    };

    setCustomFields(prev => [...prev, newField]);
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
  }, []);

  /**
   * Update custom field label handler.
   */
  const handleUpdateCustomFieldLabel = useCallback((tempId: string, newLabel: string) => {
    setCustomFields(prev => prev.map(f =>
      f.tempId === tempId ? { ...f, label: newLabel } : f
    ));
  }, []);

  /**
   * Handle custom fields reorder (drag-and-drop).
   * Updates the displayOrder of all custom fields based on their new positions.
   */
  const handleCustomFieldsReorder = useCallback((reorderedFields: CustomFieldDefinition[]) => {
    setCustomFields(reorderedFields);
  }, []);

  /**
   * Handle item type change from dropdown.
   * Clears field values that don't apply to the new item type.
   */
  const handleTypeChange = useCallback((newType: ItemType) => {
    if (!item) {
      return;
    }

    const oldType = item.ItemType;

    // Clear field values that don't apply to the new type
    if (!isEditMode && oldType !== newType) {
      setFieldValues(prev => {
        const newValues: Record<string, string | string[]> = {};
        Object.entries(prev).forEach(([key, value]) => {
          // Check if this field applies to the new type
          const systemField = getSystemField(key);
          if (systemField) {
            // Keep the field only if it applies to the new type
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

      // Clear initially visible fields that don't apply to new type
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

    // Reset alias generated flag, so alias fields will be filled (again) if they are shown by the new type
    aliasGeneratedRef.current = false;

    /*
     * Update email field mode based on new item type
     * Login type: email mode (free text), Alias type: alias mode (domain chooser)
     */
    setIsLoginEmailInEmailMode(newType === ItemTypes.Login);

    setItem({
      ...item,
      ItemType: newType,
      Fields: isEditMode ? item.Fields : []
    });

    setShowTypeDropdown(false);
  }, [item, isEditMode]);

  /**
   * Remove notes section - clears value and removes from manually added fields.
   */
  const handleRemoveNotesSection = useCallback(() => {
    setFieldValues(prev => ({
      ...prev,
      'notes.content': ''
    }));
    setManuallyAddedFields(prev => {
      const newSet = new Set(prev);
      newSet.delete('notes.content');
      return newSet;
    });
  }, []);

  /**
   * Handle adding 2FA section.
   * Also opens the TOTP add form directly since the user's intent is to add a code.
   */
  const handleAdd2FA = useCallback((): void => {
    setShow2FA(true);
    // Auto-open the add form since user intends to add a TOTP code
    setTotpEditorState({
      isAddFormVisible: true,
      formData: { name: '', secretKey: '' }
    });
  }, []);

  /**
   * Handle adding attachments section.
   */
  const handleAddAttachments = useCallback((): void => {
    setShowAttachments(true);
  }, []);

  /**
   * Handle adding an optional system field (e.g., email for Login type, notes).
   */
  const handleAddOptionalField = useCallback((fieldKey: string): void => {
    setManuallyAddedFields(prev => new Set(prev).add(fieldKey));
  }, []);

  /**
   * Optional sections (non-field-based) for the AddFieldMenu.
   */
  const optionalSections = useMemo((): OptionalSection[] => {
    const sections: OptionalSection[] = [];
    // 2FA - only for types with login fields
    if (hasLoginFields) {
      sections.push({
        key: '2fa',
        isVisible: show2FA,
        onAdd: handleAdd2FA
      });
    }
    // Attachments - always available
    sections.push({
      key: 'attachments',
      isVisible: showAttachments,
      onAdd: handleAddAttachments
    });
    return sections;
  }, [hasLoginFields, show2FA, showAttachments, handleAdd2FA, handleAddAttachments]);

  /**
   * Handle removing an optional system field (e.g., email for Login type).
   * Only allowed for fields that were manually added (not shown by default).
   */
  const handleRemoveOptionalField = useCallback((fieldKey: string): void => {
    // Remove from manually added set
    setManuallyAddedFields(prev => {
      const newSet = new Set(prev);
      newSet.delete(fieldKey);
      return newSet;
    });
    // Clear the field value
    setFieldValues(prev => {
      const newValues = { ...prev };
      delete newValues[fieldKey];
      return newValues;
    });
  }, []);

  // Set header buttons
  useEffect(() => {
    const headerButtonsJSX = (
      <div className="flex items-center gap-2">
        {isEditMode && (
          <HeaderButton
            onClick={() => setShowDeleteModal(true)}
            title={t('items.deleteItemTitle')}
            iconType={HeaderIconType.DELETE}
            variant="danger"
          />
        )}
        <HeaderButton
          id="save-credential"
          onClick={handleSave}
          title={t('items.saveItem')}
          iconType={HeaderIconType.SAVE}
        />
      </div>
    );

    setHeaderButtons(headerButtonsJSX);

    return (): void => setHeaderButtons(null);
  }, [setHeaderButtons, isEditMode, t, handleSave]);

  /**
   * Render a field input based on field type.
   * @param onRemove - Optional callback to render an X button inside the input for removable fields
   */
  const renderFieldInput = useCallback((fieldKey: string, label: string, fieldType: FieldType, isHidden: boolean, isMultiValue: boolean, onRemove?: () => void): React.ReactNode => {
    const value = fieldValues[fieldKey] || '';

    // Handle multi-value fields
    if (isMultiValue) {
      // Ensure at least one empty input is always shown for multi-value fields
      const values = Array.isArray(value) && value.length > 0 ? value : value ? [value as string] : [''];

      return (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {label}
          </label>
          {values.map((val, idx) => (
            <div key={`${fieldKey}-${idx}`} className="relative">
              <input
                id={`${fieldKey}-${idx}`}
                type="text"
                value={val}
                onChange={(e) => {
                  const newValues = [...values];
                  newValues[idx] = e.target.value;
                  /*
                   * Filter empty values but keep raw value for storage (empty array is fine).
                   * The UI will still show at least one input due to the values initialization above.
                   */
                  handleFieldChange(fieldKey, newValues.filter(v => v.trim() !== ''));
                }}
                className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:text-white"
              />
              {idx === values.length - 1 && (
                <button
                  type="button"
                  onClick={() => handleFieldChange(fieldKey, [...values, ''])}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-primary-500 dark:hover:text-primary-400 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      );
    }

    // Single-value fields
    const stringValue = Array.isArray(value) ? value[0] || '' : value;

    /**
     * Wraps an input element with a remove button overlay for removable fields.
     * @param inputElement - The input element to wrap
     * @param hasLabel - Whether the input has a label (affects button positioning)
     * @returns The wrapped element with remove button, or the original element if not removable
     */
    const wrapWithRemoveButton = (inputElement: React.ReactNode, hasLabel: boolean = true): React.ReactNode => {
      if (!onRemove) {
        return inputElement;
      }
      return (
        <div className="relative">
          {inputElement}
          <button
            type="button"
            onClick={onRemove}
            className={`absolute right-2 ${hasLabel ? 'top-[38px]' : 'top-1/2'} -translate-y-1/2 w-6 h-6 flex items-center justify-center text-gray-300 hover:text-red-400 dark:text-gray-500 dark:hover:text-red-400 transition-colors`}
            title={t('common.delete')}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      );
    };

    switch (fieldType) {
      case FieldTypes.Password:
        return wrapWithRemoveButton(
          <PasswordField
            id={fieldKey}
            label={label}
            value={stringValue}
            onChange={(val) => handleFieldChange(fieldKey, val)}
            showPassword={showPassword}
            onShowPasswordChange={setShowPassword}
            initialSettings={passwordSettings}
            onSettingsChange={setPasswordSettings}
          />
        );

      case FieldTypes.Hidden:
        return wrapWithRemoveButton(
          <HiddenField
            id={fieldKey}
            label={label}
            value={stringValue}
            onChange={(val) => handleFieldChange(fieldKey, val)}
          />
        );

      case FieldTypes.TextArea:
        return wrapWithRemoveButton(
          <div>
            {label && (
              <label htmlFor={fieldKey} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {label}
              </label>
            )}
            <textarea
              id={fieldKey}
              value={stringValue}
              onChange={(e) => handleFieldChange(fieldKey, e.target.value)}
              rows={4}
              className={`w-full px-3 py-2 ${onRemove ? 'pr-10' : ''} border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:text-white`}
            />
          </div>
        );

      case FieldTypes.Email:
        /*
         * Use EmailDomainField for email fields to provide domain chooser functionality.
         * EmailDomainField handles its own remove button in the label, so don't wrap it.
         */
        return (
          <EmailDomainField
            id={fieldKey}
            value={stringValue}
            onChange={(value) => handleFieldChange(fieldKey, value)}
            onRemove={onRemove}
            onGenerateAlias={aliasFieldsShownByDefault ? handleGenerateAliasEmail : handleGenerateRandomEmail}
            isEmailMode={isLoginEmailInEmailMode}
            onEmailModeChange={setIsLoginEmailInEmailMode}
          />
        );

      case FieldTypes.URL:
      case FieldTypes.Phone:
      case FieldTypes.Number:
      case FieldTypes.Date:
      case FieldTypes.Text:
      default:
        // Use UsernameField for login.username when alias fields are shown (Alias type)
        if (fieldKey === 'login.username' && aliasFieldsShownByDefault) {
          return (
            <UsernameField
              id={fieldKey}
              label={label}
              value={stringValue}
              onChange={(value) => handleFieldChange(fieldKey, value)}
              onRegenerate={generateRandomUsername}
            />
          );
        }
        return wrapWithRemoveButton(
          <FormInput
            id={fieldKey}
            label={label}
            value={stringValue}
            onChange={(value) => handleFieldChange(fieldKey, value)}
            type="text"
          />
        );
    }

  }, [fieldValues, handleFieldChange, showPassword, t, handleGenerateAliasEmail, handleGenerateRandomEmail, aliasFieldsShownByDefault, generateRandomUsername, isLoginEmailInEmailMode, passwordSettings]);

  /**
   * Handle form submission via Enter key.
   */
  const handleFormSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    void handleSave();
  }, [handleSave]);

  /**
   * Get category title for display.
   */
  const getCategoryTitle = useCallback((category: string): string => {
    switch (category) {
      case FieldCategories.Login:
        return t('items.loginCredentials');
      case FieldCategories.Alias:
        return t('common.alias');
      case FieldCategories.Card:
        return t('items.cardInformation');
      default:
        return category;
    }
  }, [t]);

  /**
   * Render section action buttons for alias category.
   */
  const renderSectionActions = useCallback((category: string) => {
    // Only show actions for Alias category when alias fields are shown by default
    if (category === FieldCategories.Alias && aliasFieldsShownByDefault) {
      return (
        <>
          {/* Regenerate button */}
          <button
            type="button"
            onClick={handleGenerateAlias}
            className="p-1.5 text-gray-400 hover:text-primary-500 focus:outline-none"
            title={t('common.generate')}
          >
            <svg className='w-4 h-4' viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 4v6h-6"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          </button>
        </>
      );
    }
    return null;
  }, [aliasFieldsShownByDefault, handleGenerateAlias, t]);

  if (localLoading || !item) {
    return (
      <div className="flex justify-center items-center p-8">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <form onSubmit={handleFormSubmit} className="space-y-4">
      {/* Item Type Selector */}
      <ItemTypeSelector
        selectedType={item.ItemType}
        isEditMode={isEditMode}
        showDropdown={showTypeDropdown}
        onDropdownToggle={setShowTypeDropdown}
        onTypeChange={handleTypeChange}
        onRegenerateAlias={aliasFieldsShownByDefault && !isEditMode ? handleGenerateAlias : undefined}
      />

      {/* Item Name and Primary fields block */}
      <FormSection>
        <ItemNameInput
          inputRef={nameInputRef}
          value={item.Name || ''}
          onChange={(name) => setItem({ ...item, Name: name })}
          folders={folders}
          selectedFolderId={item.FolderId}
          onFolderChange={(folderId) => setItem({ ...item, FolderId: folderId })}
        />
        {/* Primary fields (like URL) shown below name */}
        {primaryFields.map(field => (
          <div key={field.FieldKey}>
            {renderFieldInput(
              field.FieldKey,
              t(`fieldLabels.${field.FieldKey}`, { defaultValue: field.FieldKey }),
              field.FieldType,
              field.IsHidden,
              field.IsMultiValue
            )}
          </div>
        ))}
      </FormSection>

      {/* Passkey Section - only show in edit mode for items with passkeys */}
      {isEditMode && item.HasPasskey && (
        <PasskeyEditor
          itemId={item.Id}
          passkeyIdsMarkedForDeletion={passkeyIdsMarkedForDeletion}
          onPasskeyMarkedForDeletion={setPasskeyIdsMarkedForDeletion}
        />
      )}

      {/* Render fields grouped by category */}
      {Object.keys(groupedSystemFields).map(category => {
        const categoryFields = groupedSystemFields[category];
        // Filter fields to only show those that should be visible
        const visibleFields = categoryFields.filter(field => shouldShowField(field));
        // Find email field for potential "+ Email" button (only for Login category)
        const emailField = category === FieldCategories.Login ? categoryFields.find(f => f.FieldKey === 'login.email') : null;
        const showEmailAddButton = emailField && !shouldShowField(emailField);

        // Sort login fields: email first, then username, then password, then others
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
              <div className="flex items-center gap-2">
                <span>{getCategoryTitle(category)}</span>
                {/* Show "+ Email" pill button next to Credentials header when email is hidden */}
                {showEmailAddButton && (
                  <button
                    type="button"
                    onClick={() => handleAddOptionalField('login.email')}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full transition-colors focus:outline-none text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 border border-dashed border-gray-300 dark:border-gray-600 hover:border-primary-400 dark:hover:border-primary-500"
                  >
                    <svg className="w-2.5 h-2.5 -ml-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    <span>{t('common.email')}</span>
                  </button>
                )}
              </div>
            }
            actions={renderSectionActions(category)}
          >
            {sortedVisibleFields.map(field => {
              // Check if this is an optional field that can be removed (manually added, not shown by default)
              const canRemoveField = item && manuallyAddedFields.has(field.FieldKey) && !isFieldShownByDefault(field, item.ItemType);

              return (
                <React.Fragment key={field.FieldKey}>
                  {renderFieldInput(
                    field.FieldKey,
                    t(`fieldLabels.${field.FieldKey}`, { defaultValue: field.FieldKey }),
                    field.FieldType,
                    field.IsHidden,
                    field.IsMultiValue,
                    canRemoveField ? (): void => handleRemoveOptionalField(field.FieldKey) : undefined
                  )}
                </React.Fragment>
              );
            })}
          </FormSection>
        );
      })}

      {/* Notes Section */}
      {notesField && visibleFieldKeys.has('notes.content') && (
        <FormSection
          title={t('common.notes')}
          actions={
            !shouldShowField(notesField) ? (
              <button
                type="button"
                onClick={handleRemoveNotesSection}
                className="p-1.5 text-gray-400 hover:text-red-500 focus:outline-none"
                title={t('common.delete')}
              >
                <svg className='w-4 h-4' viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
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

      {/* Custom Fields Section with Drag-and-Drop Reordering */}
      {customFields.length > 0 && (
        <FormSection title={t('common.customFields')}>
          <DraggableCustomFieldsList
            customFields={customFields}
            fieldValues={fieldValues}
            onFieldsReorder={handleCustomFieldsReorder}
            onFieldValueChange={(tempId, value) => handleFieldChange(tempId, value)}
            onFieldLabelChange={handleUpdateCustomFieldLabel}
            onFieldDelete={handleDeleteCustomField}
          />
        </FormSection>
      )}

      {/* 2FA TOTP Section - only for types with login fields */}
      {show2FA && hasLoginFields && (
        <TotpEditor
          totpCodes={totpCodes}
          onTotpCodesChange={setTotpCodes}
          originalTotpCodeIds={originalTotpCodeIds}
          isAddFormVisible={totpEditorState.isAddFormVisible}
          formData={totpEditorState.formData}
          onStateChange={setTotpEditorState}
        />
      )}

      {/* Attachments Section */}
      {showAttachments && (
        <AttachmentUploader
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          itemId={isEditMode ? id : undefined}
        />
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

      {/* Delete Confirmation Modal */}
      {isEditMode && (
        <Modal
          isOpen={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          title={t('items.deleteItemTitle')}
          message={t('items.deleteItemConfirm')}
          confirmText={t('common.delete')}
          cancelText={t('common.cancel')}
          onConfirm={handleDelete}
          variant="danger"
        />
      )}
    </form>
  );
};

export default ItemAddEdit;
