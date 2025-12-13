import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { sendMessage } from 'webext-bridge/popup';

import AttachmentUploader from '@/entrypoints/popup/components/Credentials/Details/AttachmentUploader';
import PasskeyEditor from '@/entrypoints/popup/components/Credentials/Details/PasskeyEditor';
import TotpEditor from '@/entrypoints/popup/components/Credentials/Details/TotpEditor';
import Modal from '@/entrypoints/popup/components/Dialogs/Modal';
import AddFieldMenu from '@/entrypoints/popup/components/Forms/AddFieldMenu';
import EditableFieldLabel from '@/entrypoints/popup/components/Forms/EditableFieldLabel';
import EmailDomainField from '@/entrypoints/popup/components/Forms/EmailDomainField';
import { FormInput } from '@/entrypoints/popup/components/Forms/FormInput';
import FormSection from '@/entrypoints/popup/components/Forms/FormSection';
import HiddenField from '@/entrypoints/popup/components/Forms/HiddenField';
import PasswordField from '@/entrypoints/popup/components/Forms/PasswordField';
import UsernameField from '@/entrypoints/popup/components/Forms/UsernameField';
import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import ItemNameInput from '@/entrypoints/popup/components/Items/ItemNameInput';
import ItemTypeSelector from '@/entrypoints/popup/components/Items/ItemTypeSelector';
import LoadingSpinner from '@/entrypoints/popup/components/LoadingSpinner';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';
import useAliasGenerator from '@/entrypoints/popup/hooks/useAliasGenerator';
import { useVaultMutate } from '@/entrypoints/popup/hooks/useVaultMutate';

import { SKIP_FORM_RESTORE_KEY } from '@/utils/Constants';
import type { Item, ItemField, ItemType, FieldType, Attachment, TotpCode } from '@/utils/dist/core/models/vault';
import { FieldCategories, FieldTypes, ItemTypes, getSystemFieldsForItemType, isFieldShownByDefault } from '@/utils/dist/core/models/vault';
import { FaviconService } from '@/utils/FaviconService';
import { ServiceDetectionUtility } from '@/utils/serviceDetection/ServiceDetectionUtility';

import { browser } from '#imports';

// Valid item types from the shared model
const VALID_ITEM_TYPES: ItemType[] = [ItemTypes.Login, ItemTypes.Alias, ItemTypes.CreditCard, ItemTypes.Note];

// Default item type for new items
const DEFAULT_ITEM_TYPE: ItemType = ItemTypes.Login;

/**
 * Temporary custom field definition (before persisting to database)
 */
type CustomFieldDefinition = {
  tempId: string;
  label: string;
  fieldType: FieldType;
  isHidden: boolean;
  displayOrder: number;
};

/**
 * Persisted form data type used for JSON serialization.
 */
type PersistedFormData = {
  itemId: string | null;
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
  showNotes: boolean;
  show2FA: boolean;
  showAttachments: boolean;
  manuallyAddedFields: string[];
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

  // Get item type and name from URL parameters (for create mode)
  const itemTypeParam = searchParams.get('type') as ItemType | null;
  const itemNameParam = searchParams.get('name');

  const { executeVaultMutationAsync } = useVaultMutate();
  const { setHeaderButtons } = useHeaderButtons();
  const { setIsInitialLoading } = useLoading();
  const { generateAlias, lastGeneratedValues } = useAliasGenerator();
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
  const [showNotes, setShowNotes] = useState(false);
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
   * The notes field (metadata.notes) - handled separately for collapsible UI.
   */
  const notesField = useMemo(() => {
    return applicableSystemFields.find(field => field.FieldKey === 'metadata.notes');
  }, [applicableSystemFields]);

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
    return applicableSystemFields.filter(field => field.Category === 'Primary');
  }, [applicableSystemFields]);

  /**
   * Group system fields by category for organized rendering.
   */
  const groupedSystemFields = useMemo(() => {
    const groups: Record<string, typeof applicableSystemFields> = {};

    applicableSystemFields.forEach(field => {
      // Skip metadata fields (notes) - handled separately
      if (field.Category === 'Metadata') {
        return;
      }
      // Skip primary fields - rendered in name block
      if (field.Category === 'Primary') {
        return;
      }

      const category = field.Category || 'Other';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(field);
    });

    return groups;
  }, [applicableSystemFields]);

  /**
   * Persists the current form values to storage.
   * @returns Promise that resolves when the form values are persisted
   */
  const persistFormValues = useCallback(async (): Promise<void> => {
    if (localLoading) {
      // Do not persist values if the page is still loading.
      return;
    }

    const persistedData: PersistedFormData = {
      itemId: id || null,
      item,
      fieldValues,
      customFields,
      totpEditorState,
      showNotes,
      show2FA,
      showAttachments,
      manuallyAddedFields: Array.from(manuallyAddedFields)
    };
    await sendMessage('PERSIST_FORM_VALUES', JSON.stringify(persistedData), 'background');
  }, [id, item, fieldValues, customFields, totpEditorState, showNotes, show2FA, showAttachments, manuallyAddedFields, localLoading]);

  /**
   * Loads persisted form values from storage.
   * @returns Promise that resolves when the form values are loaded
   */
  const loadPersistedValues = useCallback(async (): Promise<void> => {
    const persistedData = await sendMessage('GET_PERSISTED_FORM_VALUES', null, 'background') as string | null;

    try {
      let persistedDataObject: PersistedFormData | null = null;
      try {
        if (persistedData) {
          persistedDataObject = JSON.parse(persistedData) as PersistedFormData;
        }
      } catch (error) {
        console.error('Error parsing persisted data:', error);
      }

      if (!persistedDataObject) {
        return;
      }

      const isCurrentPage = persistedDataObject.itemId === (id || null);
      if (persistedDataObject && isCurrentPage) {
        // Restore item state
        if (persistedDataObject.item) {
          setItem(persistedDataObject.item);
        }
        // Restore field values
        if (persistedDataObject.fieldValues) {
          setFieldValues(persistedDataObject.fieldValues);
        }
        // Restore custom fields
        if (persistedDataObject.customFields) {
          setCustomFields(persistedDataObject.customFields);
        }
        // Restore TOTP editor state
        if (persistedDataObject.totpEditorState) {
          setTotpEditorState(persistedDataObject.totpEditorState);
        }
        // Restore visibility states
        if (persistedDataObject.showNotes !== undefined) {
          setShowNotes(persistedDataObject.showNotes);
        }
        if (persistedDataObject.show2FA !== undefined) {
          setShow2FA(persistedDataObject.show2FA);
        }
        if (persistedDataObject.showAttachments !== undefined) {
          setShowAttachments(persistedDataObject.showAttachments);
        }
        // Restore manually added fields
        if (persistedDataObject.manuallyAddedFields) {
          setManuallyAddedFields(new Set(persistedDataObject.manuallyAddedFields));
        }
      }
    } catch (error) {
      console.error('Error loading persisted data:', error);
    }
  }, [id]);

  /**
   * Clears persisted form values from storage.
   * @returns Promise that resolves when the form values are cleared
   */
  const clearPersistedValues = useCallback(async (): Promise<void> => {
    await sendMessage('CLEAR_PERSISTED_FORM_VALUES', null, 'background');
  }, []);

  /**
   * Watch for form changes and persist them.
   */
  useEffect(() => {
    if (!localLoading) {
      void persistFormValues();
    }
  }, [item, fieldValues, customFields, totpEditorState, showNotes, show2FA, showAttachments, manuallyAddedFields, persistFormValues, localLoading]);

  /**
   * Clear persisted values when the page is unmounted.
   */
  useEffect(() => {
    return (): void => {
      void clearPersistedValues();
    };
  }, [clearPersistedValues]);

  /**
   * Load item data if in edit mode, or initialize for create mode with service detection.
   */
  useEffect(() => {
    if (!dbContext?.sqliteClient || !id || !isEditMode) {
      // Create mode - initialize with defaults
      const effectiveType: ItemType = (itemTypeParam && VALID_ITEM_TYPES.includes(itemTypeParam))
        ? itemTypeParam
        : DEFAULT_ITEM_TYPE;

      /*
       * Get URL parameters for service detection (e.g., from content script popout)
       * Use searchParams from react-router which handles hash-based routing correctly
       */
      const serviceNameFromUrl = searchParams.get('serviceName');
      const serviceUrlFromUrl = searchParams.get('serviceUrl');
      const currentUrl = searchParams.get('currentUrl');

      /**
       * Initialize service detection from URL parameters or current tab.
       */
      const initializeWithServiceDetection = async (): Promise<void> => {
        let detectedName = itemNameParam || '';
        let detectedUrl = '';

        try {
          // If URL parameters are present (e.g., from content script popout), use them
          if (serviceNameFromUrl || serviceUrlFromUrl || currentUrl) {
            if (serviceNameFromUrl) {
              detectedName = decodeURIComponent(serviceNameFromUrl);
            }
            if (serviceUrlFromUrl) {
              detectedUrl = decodeURIComponent(serviceUrlFromUrl);
            }

            // If we have currentUrl but missing serviceName or serviceUrl, derive them
            if (currentUrl && (!serviceNameFromUrl || !serviceUrlFromUrl)) {
              const decodedCurrentUrl = decodeURIComponent(currentUrl);
              const serviceInfo = ServiceDetectionUtility.getServiceInfoFromTab(decodedCurrentUrl);

              if (!serviceNameFromUrl && serviceInfo.suggestedNames.length > 0) {
                detectedName = serviceInfo.suggestedNames[0];
              }
              if (!serviceUrlFromUrl && serviceInfo.serviceUrl) {
                detectedUrl = serviceInfo.serviceUrl;
              }
            }
          } else {
            // Otherwise, detect from current active tab (for dashboard case)
            const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });

            if (activeTab?.url) {
              const serviceInfo = ServiceDetectionUtility.getServiceInfoFromTab(
                activeTab.url,
                activeTab.title
              );

              if (serviceInfo.suggestedNames.length > 0 && !detectedName) {
                detectedName = serviceInfo.suggestedNames[0];
              }
              if (serviceInfo.serviceUrl) {
                detectedUrl = serviceInfo.serviceUrl;
              }
            }
          }
        } catch (error) {
          console.error('Error detecting service information:', error);
        }

        // Create the new item with detected values
        const newItem: Item = {
          Id: crypto.randomUUID().toUpperCase(),
          Name: detectedName,
          ItemType: effectiveType,
          FolderId: null,
          Fields: [],
          CreatedAt: new Date().toISOString(),
          UpdatedAt: new Date().toISOString()
        };

        setItem(newItem);

        // Set the detected URL in field values if we have one
        if (detectedUrl) {
          setFieldValues(prev => ({
            ...prev,
            'login.url': detectedUrl
          }));
        }

        // Check if notes should be shown by default for this type
        const typeFields = getSystemFieldsForItemType(effectiveType);
        const notesFieldDef = typeFields.find(f => f.FieldKey === 'metadata.notes');
        if (notesFieldDef && isFieldShownByDefault(notesFieldDef, effectiveType)) {
          setShowNotes(true);
        }

        // Load folders
        if (dbContext?.sqliteClient) {
          const allFolders = dbContext.sqliteClient.getAllFolders();
          setFolders(allFolders);
        }

        // Check if we should skip form restoration (e.g., when opened from popout button)
        const result = await browser.storage.local.get([SKIP_FORM_RESTORE_KEY]);
        if (result[SKIP_FORM_RESTORE_KEY]) {
          // Clear the flag after using it
          await browser.storage.local.remove([SKIP_FORM_RESTORE_KEY]);
          // Don't load persisted values
        } else {
          // Load persisted form values normally
          await loadPersistedValues();
        }

        setLocalLoading(false);
        setIsInitialLoading(false);
      };

      void initializeWithServiceDetection();
      return;
    }

    try {
      const result = dbContext.sqliteClient.getItemById(id);
      if (result) {
        setItem(result);

        // Load folders
        const allFolders = dbContext.sqliteClient.getAllFolders();
        setFolders(allFolders);

        // Initialize field values from existing fields
        const initialValues: Record<string, string | string[]> = {};
        const existingCustomFields: CustomFieldDefinition[] = [];
        const fieldsWithValues = new Set<string>();

        result.Fields.forEach(field => {
          initialValues[field.FieldKey] = field.Value;
          // Track fields that have values so they stay visible even if cleared
          fieldsWithValues.add(field.FieldKey);

          // If field key starts with "custom_", it's a custom field
          if (field.FieldKey.startsWith('custom_')) {
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
        setCustomFields(existingCustomFields);
        setInitiallyVisibleFields(fieldsWithValues);

        // Load TOTP codes for this item
        const itemTotpCodes = dbContext.sqliteClient.getTotpCodesForItem(id);
        setTotpCodes(itemTotpCodes);
        setOriginalTotpCodeIds(itemTotpCodes.map(tc => tc.Id));
        if (itemTotpCodes.length > 0) {
          setShow2FA(true);
        }

        // Load attachments for this item
        const itemAttachments = dbContext.sqliteClient.getAttachmentsForItem(id);
        setAttachments(itemAttachments);
        setOriginalAttachmentIds(itemAttachments.map(a => a.Id));
        if (itemAttachments.length > 0) {
          setShowAttachments(true);
        }

        setLocalLoading(false);
        setIsInitialLoading(false);
      } else {
        console.error('Item not found');
        navigate('/credentials');
      }
    } catch (err) {
      console.error('Error loading item:', err);
      setLocalLoading(false);
      setIsInitialLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbContext?.sqliteClient, id, isEditMode, itemTypeParam, itemNameParam, navigate, setIsInitialLoading, searchParams]);

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
   * Generate only the alias email (for Login type email field).
   * Generates a random identity and uses it to create an email address.
   */
  const handleGenerateAliasEmail = useCallback(async () => {
    const generatedData = await generateAlias();
    if (!generatedData) {
      return;
    }

    // Only update the email field
    setFieldValues(prev => ({
      ...prev,
      'login.email': generatedData.email
    }));
  }, [generateAlias]);

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
            DisplayOrder: systemField.DefaultDisplayOrder
          });
        }
      });

      // Add custom fields
      customFields.forEach(customField => {
        const value = fieldValues[customField.tempId];

        // Only include fields with non-empty values
        if (value && (Array.isArray(value) ? value.length > 0 : value.trim() !== '')) {
          fields.push({
            FieldKey: customField.tempId,
            Label: customField.label,
            FieldType: customField.fieldType,
            Value: value,
            IsHidden: customField.isHidden,
            DisplayOrder: customField.displayOrder
          });
        }
      });

      let updatedItem: Item = {
        ...item,
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
          await dbContext.sqliteClient!.updateItem(
            updatedItem,
            originalAttachmentIds,
            attachments,
            originalTotpCodeIds,
            totpCodes
          );

          // Delete passkeys marked for deletion
          if (passkeyIdsMarkedForDeletion.length > 0) {
            for (const passkeyId of passkeyIdsMarkedForDeletion) {
              await dbContext.sqliteClient!.deletePasskeyById(passkeyId);
            }
          }
        } else {
          await dbContext.sqliteClient!.createItem(updatedItem, attachments, totpCodes);
        }
      });

      // Clear persisted form values after successful save
      void clearPersistedValues();

      /*
       * Navigate to details page, replacing the add/edit page in history.
       * This way pressing back goes to items list, not back to the edit form.
       */
      navigate(`/items/${updatedItem.Id}`, { replace: true });
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
        await dbContext.sqliteClient!.deleteItemById(item.Id);
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
    const tempId = `custom_${crypto.randomUUID()}`;
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
   * Handle item type change from dropdown.
   */
  const handleTypeChange = useCallback((newType: ItemType) => {
    if (!item) {
      return;
    }

    // When switching FROM Alias type to another type, clear alias and login fields (except URL)
    if (!isEditMode && item.ItemType === ItemTypes.Alias && newType !== ItemTypes.Alias) {
      setFieldValues(prev => {
        const newValues: Record<string, string | string[]> = {};
        // Only preserve non-alias and non-login fields, plus login.url
        Object.entries(prev).forEach(([key, value]) => {
          if (key === 'login.url') {
            newValues[key] = value;
          } else if (!key.startsWith('alias.') && !key.startsWith('login.')) {
            newValues[key] = value;
          }
        });
        return newValues;
      });
    }

    // Check field visibility based on model config for the new type
    const newTypeFields = getSystemFieldsForItemType(newType);

    // Check if alias fields should be shown by default for the new type (for auto-generation)
    const newAliasField = newTypeFields.find(f => f.Category === FieldCategories.Alias);
    const aliasShownByDefault = newAliasField ? isFieldShownByDefault(newAliasField, newType) : false;
    if (aliasShownByDefault && !isEditMode) {
      aliasGeneratedRef.current = false;
    }

    // Check if notes should be shown by default for the new type
    const newNotesField = newTypeFields.find(f => f.FieldKey === 'metadata.notes');
    const notesShownByDefault = newNotesField ? isFieldShownByDefault(newNotesField, newType) : false;
    setShowNotes(notesShownByDefault || (isEditMode && !!fieldValues['metadata.notes']));

    // Update 2FA visibility - supported for types with login fields
    const newTypeHasLoginFields = newTypeFields.some(f => f.FieldKey === 'login.username' || f.FieldKey === 'login.password');
    if (!newTypeHasLoginFields && show2FA) {
      setShow2FA(false);
    }

    setItem({
      ...item,
      ItemType: newType,
      Fields: isEditMode ? item.Fields : []
    });

    setShowTypeDropdown(false);
  }, [item, isEditMode, fieldValues, show2FA]);

  /**
   * Remove notes section - clears value and hides the section.
   */
  const handleRemoveNotesSection = useCallback(() => {
    setFieldValues(prev => ({
      ...prev,
      'metadata.notes': ''
    }));
    setShowNotes(false);
  }, []);

  /**
   * Handle adding notes section.
   */
  const handleAddNotes = useCallback((): void => {
    setShowNotes(true);
  }, []);

  /**
   * Handle adding 2FA section.
   */
  const handleAdd2FA = useCallback((): void => {
    setShow2FA(true);
  }, []);

  /**
   * Handle adding attachments section.
   */
  const handleAddAttachments = useCallback((): void => {
    setShowAttachments(true);
  }, []);

  /**
   * Handle adding an optional system field (e.g., email for Login type).
   */
  const handleAddOptionalField = useCallback((fieldKey: string): void => {
    setManuallyAddedFields(prev => new Set(prev).add(fieldKey));
  }, []);

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
            title={t('credentials.deleteCredential')}
            iconType={HeaderIconType.DELETE}
            variant="danger"
          />
        )}
        <HeaderButton
          id="save-credential"
          onClick={handleSave}
          title={t('credentials.saveCredential')}
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
      const values = Array.isArray(value) ? value : value ? [value] : [''];

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
                  handleFieldChange(fieldKey, newValues.filter(v => v.trim() !== ''));
                }}
                placeholder={`${label} ${idx + 1}`}
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
            <label htmlFor={fieldKey} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {label}
            </label>
            <textarea
              id={fieldKey}
              value={stringValue}
              onChange={(e) => handleFieldChange(fieldKey, e.target.value)}
              rows={4}
              className={`w-full px-3 py-2 ${onRemove ? 'pr-10' : ''} border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:text-white`}
              placeholder={label}
            />
          </div>
        );

      case FieldTypes.Email:
        /*
         * Use EmailDomainField for email fields to provide domain chooser functionality.
         * For login.email (Login type), default to free text mode instead of domain chooser.
         * EmailDomainField handles its own remove button in the label, so don't wrap it.
         */
        return (
          <EmailDomainField
            id={fieldKey}
            label={label}
            value={stringValue}
            onChange={(value) => handleFieldChange(fieldKey, value)}
            defaultToFreeText={fieldKey === 'login.email'}
            onRemove={onRemove}
            onGenerateAlias={fieldKey === 'login.email' ? handleGenerateAliasEmail : undefined}
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
            placeholder={label}
          />
        );
    }

  }, [fieldValues, handleFieldChange, showPassword, t, handleGenerateAliasEmail, aliasFieldsShownByDefault, generateRandomUsername]);

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
        return t('common.credentials');
      case FieldCategories.Alias:
        return t('credentials.alias');
      case FieldCategories.Card:
        return t('credentials.cardInformation');
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
            title={t('credentials.generateRandomAlias')}
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
        const emailField = category === 'Login' ? categoryFields.find(f => f.FieldKey === 'login.email') : null;
        const showEmailAddButton = emailField && !shouldShowField(emailField);

        // Sort login fields: email first, then username, then password, then others
        const sortedVisibleFields = category === 'Login'
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

      {/* Custom Fields Section */}
      {customFields.length > 0 && (
        <FormSection title={t('common.customFields')}>
          {customFields.map(field => (
            <div key={field.tempId}>
              <EditableFieldLabel
                htmlFor={field.tempId}
                label={field.label}
                onLabelChange={(newLabel) => handleUpdateCustomFieldLabel(field.tempId, newLabel)}
                onDelete={() => handleDeleteCustomField(field.tempId)}
              />
              {renderFieldInput(
                field.tempId,
                '',
                field.fieldType,
                field.isHidden,
                false
              )}
            </div>
          ))}
        </FormSection>
      )}

      {/* Notes Section */}
      {notesField && (showNotes || isEditMode || fieldValues['metadata.notes']) && (
        <FormSection
          title={t('credentials.notes')}
          actions={
            !isEditMode && !shouldShowField(notesField) ? (
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
            t(`fieldLabels.${notesField.FieldKey}`, { defaultValue: notesField.FieldKey }),
            notesField.FieldType,
            notesField.IsHidden,
            notesField.IsMultiValue
          )}
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
        />
      )}

      {/* Add Field Menu */}
      <AddFieldMenu
        isEditMode={isEditMode}
        supports2FA={hasLoginFields}
        visibility={{
          showNotes,
          show2FA,
          showAttachments
        }}
        callbacks={{
          onAddNotes: handleAddNotes,
          onAdd2FA: handleAdd2FA,
          onAddAttachments: handleAddAttachments,
          onAddCustomField: handleAddCustomField
        }}
      />

      {/* Delete Confirmation Modal */}
      {isEditMode && (
        <Modal
          isOpen={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          title={t('credentials.deleteCredentialTitle')}
          message={t('credentials.deleteCredentialConfirmation')}
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
