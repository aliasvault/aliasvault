import { fieldAppliesToType, FieldKey, getFieldConfigForType, getOptionalFieldsForItemType, getSystemField, getSystemFieldsForItemType, type ItemType, ItemTypes, SystemFieldRegistry } from '@aliasvault/models/vault';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import AttachmentUploader from '@/components/attachments/AttachmentUploader';
import DraggableCustomFieldsList from '@/components/forms/DraggableCustomFieldsList';
import EditFormRow from '@/components/forms/EditFormRow';
import EditPasswordFormRow from '@/components/forms/EditPasswordFormRow';
import EditUsernameFormRow from '@/components/forms/EditUsernameFormRow';
import EmailDomainField from '@/components/forms/EmailDomainField';
import MultiValueFormRow from '@/components/forms/MultiValueFormRow';
import RemovableSection from '@/components/forms/RemovableSection';
import AddFieldMenu from '@/components/items/AddFieldMenu';
import { buildFolderBreadcrumbs } from '@/components/items/FolderBreadcrumbs';
import FolderSelector from '@/components/items/FolderSelector';
import ItemTypeSelector from '@/components/items/ItemTypeSelector';
import LoadingIndicator from '@/components/loading/LoadingIndicator';
import type { BreadcrumbItem } from '@/components/shared/Breadcrumb';
import Button from '@/components/shared/Button';
import Card from '@/components/shared/Card';
import PageContent from '@/components/shared/PageContent';
import PageHeader from '@/components/shared/PageHeader';
import StickyActionBar from '@/components/shared/StickyActionBar';
import TotpCodes from '@/components/totp/TotpCodes';
import { useDb } from '@/context/DbContext';
import { useLoading } from '@/context/LoadingContext';
import { useNotifications } from '@/context/NotificationContext';
import { useWebApi } from '@/context/WebApiContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSaveItem } from '@/hooks/useSaveItem';
import {
  addCustomField, createNewItemEdit, DEFAULT_SERVICE_URL, getCustomFields, getFieldValue, getFieldValues, hasAliasValues, hasFieldValue,
  type ItemEdit, itemEditFromItem, removeCustomField, reorderCustomFields, setFieldValue, setFieldValues, setFolder, updateCustomField,
} from '@/models/ItemEdit';
import { waitForMinimumDuration } from '@/utils/Delay';
import { generateAliasEmail, generateIdentity, generateRandomEmail, generateUsername, type GeneratedAliasData } from '@/utils/IdentityGenerator';
import { itemRoute } from '@/utils/ItemRoute';

const MIN_SAVE_INDICATOR_MS = 250;

/**
 * A card section on the form.
 */
const Section: React.FC<{ title?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, children, className = '' }) => (
  <Card variant="section" className={className}>
    {title && <h3 className="mb-4 text-xl font-semibold dark:text-white flex items-center gap-2">{title}</h3>}
    <div className="grid gap-6">
      {children}
    </div>
  </Card>
);

/**
 * The passkey key icon.
 */
const PasskeyIcon: React.FC<{ className: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </svg>
);

/**
 * The item create and edit page.
 */
const ItemAddEdit: React.FC = () => {
  const { manifestId, id } = useParams<{ manifestId: string; id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const dbContext = useDb();
  const notifications = useNotifications();
  const { showLoading, hideLoading } = useLoading();
  const { saveItem } = useSaveItem();
  const webApi = useWebApi();
  const editMode = id !== undefined;
  const tk = 'pages.main.items.addEdit';
  usePageTitle(editMode ? t(`${tk}.EditItemTitle`) : t(`${tk}.AddItemTitle`));

  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<ItemEdit>(() => ({ Id: '', ManifestId: '', ItemType: ItemTypes.Login, ServiceName: '', FolderId: null, CreatedAt: '', Fields: [], Attachments: [], TotpCodes: [], Passkeys: [] }));
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [passkeyMarkedForDeletion, setPasskeyMarkedForDeletion] = useState(false);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [show2FA, setShow2FA] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [manuallyAddedFields, setManuallyAddedFields] = useState<Set<string>>(new Set());
  const [initiallyVisibleFields, setInitiallyVisibleFields] = useState<Set<string>>(new Set());
  const [breadcrumbItems, setBreadcrumbItems] = useState<BreadcrumbItem[]>([]);
  const [nameError, setNameError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const originalTotpCodeIds = useRef<string[]>([]);
  const originalAttachmentIds = useRef<string[]>([]);
  const lastGenerated = useRef<GeneratedAliasData | null>(null);

  /**
   * Apply a change to the form.
   */
  const update = useCallback((updater: (current: ItemEdit) => ItemEdit): void => setEdit(current => updater(current)), []);

  /**
   * Fill the alias fields with a random identity. Username, password and email are only replaced when empty or
   * still the last generated value, so manual entries survive a regenerate.
   */
  const generateRandomAlias = useCallback(async (current: ItemEdit): Promise<ItemEdit> => {
    const client = dbContext.sqliteClient;
    const generated = client ? await generateIdentity(client, webApi) : null;
    if (!generated) {
      return current;
    }
    const currentUsername = getFieldValue(current, FieldKey.LoginUsername);
    const currentPassword = getFieldValue(current, FieldKey.LoginPassword);
    const currentEmail = getFieldValue(current, FieldKey.LoginEmail);
    const previous = lastGenerated.current;
    lastGenerated.current = generated;

    let next = current;
    next = setFieldValue(next, FieldKey.AliasFirstName, generated.firstName);
    next = setFieldValue(next, FieldKey.AliasLastName, generated.lastName);
    next = setFieldValue(next, FieldKey.AliasGender, generated.gender);
    next = setFieldValue(next, FieldKey.AliasBirthdate, generated.birthdate);
    if (currentUsername.trim().length === 0 || currentUsername === previous?.username) {
      next = setFieldValue(next, FieldKey.LoginUsername, generated.username);
    }
    if (currentPassword.trim().length === 0 || currentPassword === previous?.password) {
      next = setFieldValue(next, FieldKey.LoginPassword, generated.password);
      setIsPasswordVisible(true);
    }
    if (currentEmail.trim().length === 0 || currentEmail === previous?.email || currentEmail.startsWith('@')) {
      next = setFieldValue(next, FieldKey.LoginEmail, generated.email);
    }
    return next;
  }, [dbContext.sqliteClient, webApi]);

  /**
   * Switch the item type, dropping the fields that do not apply to the new type.
   */
  const handleItemTypeChange = useCallback(async (current: ItemEdit, newType: ItemType): Promise<ItemEdit> => {
    if (current.ItemType === newType) {
      return current;
    }
    let next: ItemEdit = { ...current, ItemType: newType };
    for (const definition of Object.values(SystemFieldRegistry)) {
      if (!fieldAppliesToType(definition, newType)) {
        next = setFieldValue(next, definition.FieldKey, '');
      }
    }
    /**
     * Whether a field key applies to the new type.
     */
    const applies = (fieldKey: string): boolean => {
      const definition = getSystemField(fieldKey);
      return !definition || fieldAppliesToType(definition, newType);
    };
    setManuallyAddedFields(prev => new Set([...prev].filter(applies)));
    setInitiallyVisibleFields(prev => new Set([...prev].filter(applies)));

    if (newType === ItemTypes.Alias && !editMode && !hasAliasValues(next)) {
      next = await generateRandomAlias(next);
    }
    return next;
  }, [editMode, generateRandomAlias]);

  // Load the item (edit) or prefill the form from the quick create widget's query (create).
  useEffect(() => {
    const client = dbContext.sqliteClient;
    if (!client) {
      return;
    }
    let cancelled = false;

    /**
     * Set up the form.
     */
    const initialize = async (): Promise<void> => {
      setLoading(true);
      setManuallyAddedFields(new Set());
      setInitiallyVisibleFields(new Set());
      setPasskeyMarkedForDeletion(false);
      setNameError('');
      const allFolders = client.folders.getAll();

      if (editMode) {
        if (!manifestId) {
          return;
        }
        const ref = { Id: id, ManifestId: manifestId };
        const item = client.items.getById(ref);
        if (!item) {
          notifications.addErrorMessage(t(`${tk}.ItemNotExistError`));
          navigate('/items', { replace: true });
          return;
        }
        const totpCodes = client.items.getTotpCodesForItem(ref);
        const attachments = client.items.getAttachmentsForItem(ref);
        const passkeys = client.passkeys.getByItemId(ref);
        let loaded = itemEditFromItem(item, totpCodes, attachments, passkeys);
        originalTotpCodeIds.current = loaded.TotpCodes.map(c => c.Id);
        originalAttachmentIds.current = loaded.Attachments.map(a => a.Id);
        setInitiallyVisibleFields(new Set(getSystemFieldsForItemType(loaded.ItemType).filter(f => hasFieldValue(loaded, f.FieldKey)).map(f => f.FieldKey)));
        setShow2FA(loaded.TotpCodes.length > 0);
        setShowAttachments(loaded.Attachments.length > 0);
        if (!hasFieldValue(loaded, FieldKey.LoginUrl)) {
          loaded = setFieldValue(loaded, FieldKey.LoginUrl, DEFAULT_SERVICE_URL);
        }
        const crumbs = loaded.FolderId ? buildFolderBreadcrumbs({ Id: loaded.FolderId, ManifestId: loaded.ManifestId }, allFolders) : [];
        crumbs.push({ displayName: t(`${tk}.ViewItemBreadcrumb`), url: itemRoute(ref) });
        crumbs.push({ displayName: t(`${tk}.EditItemBreadcrumb`) });
        if (!cancelled) {
          setEdit(loaded);
          setBreadcrumbItems(crumbs);
          setLoading(false);
        }
        return;
      }

      const params = new URLSearchParams(location.search);
      const folderId = params.get('folderId');
      const folderManifestId = params.get('folderManifestId');
      const folder = folderId && folderManifestId ? allFolders.find(f => f.Id === folderId && f.ManifestId === folderManifestId) ?? null : null;
      let created = createNewItemEdit(folder, client.getPersonalManifestId());
      const name = params.get('name');
      const url = params.get('url');
      const type = params.get('type');
      if (name) {
        created = { ...created, ServiceName: name };
      }
      if (url) {
        created = setFieldValue(created, FieldKey.LoginUrl, url);
      }
      if (type && Object.values(ItemTypes).includes(type as ItemType)) {
        created = await handleItemTypeChange(created, type as ItemType);
      }
      originalTotpCodeIds.current = [];
      originalAttachmentIds.current = [];
      setShow2FA(false);
      setShowAttachments(false);
      const crumbs = folder ? buildFolderBreadcrumbs(folder, allFolders) : [];
      crumbs.push({ displayName: t(`${tk}.AddNewItemBreadcrumb`) });
      if (!cancelled) {
        setEdit(created);
        setBreadcrumbItems(crumbs);
        setLoading(false);
        setTimeout(() => document.getElementById('service-name')?.focus(), 50);
      }
    };

    void initialize();
    return (): void => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbContext.sqliteClient, editMode, manifestId, id, location.search]);

  const hasLoginFields = edit.ItemType === ItemTypes.Login || edit.ItemType === ItemTypes.Alias;

  /**
   * Whether a system field is on the form: it applies to the type and was added, was there on load, has a value or
   * shows by default.
   */
  const shouldShowField = (fieldKey: string): boolean => {
    const definition = getSystemField(fieldKey);
    if (!definition || !fieldAppliesToType(definition, edit.ItemType)) {
      return false;
    }
    if (manuallyAddedFields.has(fieldKey) || initiallyVisibleFields.has(fieldKey) || hasFieldValue(edit, fieldKey)) {
      return true;
    }
    return getFieldConfigForType(definition, edit.ItemType)?.ShowByDefault ?? false;
  };

  /**
   * Whether a field is optional for the type and can be removed.
   */
  const canRemoveField = (fieldKey: string): boolean => {
    const definition = getSystemField(fieldKey);
    const config = definition ? getFieldConfigForType(definition, edit.ItemType) : undefined;
    return config !== undefined && !config.ShowByDefault;
  };

  const visibleFieldKeys = new Set(getSystemFieldsForItemType(edit.ItemType).filter(f => shouldShowField(f.FieldKey)).map(f => f.FieldKey));

  /**
   * Show an optional field.
   */
  const addOptionalField = (fieldKey: string): void => setManuallyAddedFields(prev => new Set([...prev, fieldKey]));

  /**
   * Hide an optional field and clear it.
   */
  const removeOptionalField = (fieldKey: string): void => {
    setManuallyAddedFields(prev => new Set([...prev].filter(k => k !== fieldKey)));
    setInitiallyVisibleFields(prev => new Set([...prev].filter(k => k !== fieldKey)));
    update(current => setFieldValue(current, fieldKey, ''));
  };

  /**
   * Show the 2FA section, restoring codes removed with it.
   */
  const add2FASection = (): void => {
    setShow2FA(true);
    update(current => ({ ...current, TotpCodes: current.TotpCodes.map(c => c.IsDeleted ? { ...c, IsDeleted: false } : c) }));
  };

  /**
   * Hide the 2FA section: existing codes are soft deleted, new ones dropped.
   */
  const remove2FASection = (): void => {
    setShow2FA(false);
    update(current => ({ ...current, TotpCodes: current.TotpCodes.filter(c => originalTotpCodeIds.current.includes(c.Id)).map(c => ({ ...c, IsDeleted: true })) }));
  };

  /**
   * Show the attachments section, restoring attachments removed with it.
   */
  const addAttachmentsSection = (): void => {
    setShowAttachments(true);
    update(current => ({ ...current, Attachments: current.Attachments.map(a => a.IsDeleted ? { ...a, IsDeleted: false } : a) }));
  };

  /**
   * Hide the attachments section: existing attachments are soft deleted, new ones dropped.
   */
  const removeAttachmentsSection = (): void => {
    setShowAttachments(false);
    update(current => ({ ...current, Attachments: current.Attachments.filter(a => originalAttachmentIds.current.includes(a.Id)).map(a => ({ ...a, IsDeleted: true })) }));
  };

  /**
   * Put the cursor after the URL placeholder when the field still holds it.
   */
  const onFocusUrlInput = (index: number, event: React.FocusEvent<HTMLInputElement>): void => {
    if (getFieldValues(edit, FieldKey.LoginUrl)[index] !== DEFAULT_SERVICE_URL) {
      return;
    }
    const input = event.target;
    setTimeout(() => input.setSelectionRange(DEFAULT_SERVICE_URL.length, DEFAULT_SERVICE_URL.length), 1);
  };

  /**
   * Regenerate the alias identity.
   */
  const onGenerateRandomAlias = async (): Promise<void> => setEdit(await generateRandomAlias(edit));

  /**
   * Regenerate the username.
   */
  const onGenerateUsername = async (): Promise<void> => {
    if (!dbContext.sqliteClient) {
      return;
    }
    const username = await generateUsername(dbContext.sqliteClient, edit);
    update(current => setFieldValue(current, FieldKey.LoginUsername, username));
  };

  /**
   * Regenerate the email address, from the identity for an alias and at random for a login.
   */
  const onGenerateEmail = async (): Promise<void> => {
    if (!dbContext.sqliteClient) {
      return;
    }
    const email = edit.ItemType === ItemTypes.Alias ? await generateAliasEmail(dbContext.sqliteClient, edit) : await generateRandomEmail(dbContext.sqliteClient);
    update(current => setFieldValue(current, FieldKey.LoginEmail, email));
  };

  /**
   * Save the item and go to its page.
   */
  const save = async (): Promise<void> => {
    if (isSaving) {
      return;
    }
    if (edit.ServiceName.trim().length === 0) {
      setNameError(t('validationMessages.ServiceNameRequired'));
      return;
    }
    setNameError('');
    setIsSaving(true);
    showLoading(t(`${tk}.SavingVaultMessage`));
    const startedAt = Date.now();
    try {
      const saved = await saveItem(edit, { original: editMode && manifestId ? { Id: edit.Id, ManifestId: manifestId } : undefined, originalAttachmentIds: originalAttachmentIds.current, originalTotpCodeIds: originalTotpCodeIds.current, deletePasskeys: passkeyMarkedForDeletion });
      // Keep the saving indicator up for a moment: a save that completes instantly reads as a flicker.
      await waitForMinimumDuration(startedAt, MIN_SAVE_INDICATOR_MS);
      notifications.addSuccessMessage(editMode ? t(`${tk}.ItemUpdatedSuccess`) : t(`${tk}.ItemCreatedSuccess`));
      navigate(itemRoute(saved));
    } catch (error) {
      console.error('Error saving item:', error);
      notifications.addErrorMessage(t(`${tk}.ErrorSavingItem`), true);
    } finally {
      hideLoading();
      setIsSaving(false);
    }
  };

  /**
   * Leave without saving.
   */
  const cancel = (): void => {
    navigate(editMode && manifestId ? itemRoute({ Id: id, ManifestId: manifestId }) : '/items/');
  };

  const customFields = getCustomFields(edit);
  const passkey = editMode ? edit.Passkeys[0] : undefined;
  const optionalSystemFields = getOptionalFieldsForItemType(edit.ItemType);

  const addFieldMenu = (
    <AddFieldMenu
      optionalSystemFields={optionalSystemFields}
      visibleFieldKeys={visibleFieldKeys}
      show2FA={show2FA}
      showAttachments={showAttachments}
      hasLoginFields={hasLoginFields}
      customFieldCount={customFields.length}
      onAddSystemField={addOptionalField}
      onAddCustomField={(label, fieldType) => update(current => addCustomField(current, label, fieldType))}
      onAdd2FA={add2FASection}
      onAddAttachments={addAttachmentsSection}
    />
  );

  const emailField = (
    <EmailDomainField
      id="email"
      value={getFieldValue(edit, FieldKey.LoginEmail)}
      onChange={value => update(current => setFieldValue(current, FieldKey.LoginEmail, value))}
      defaultToEmailMode={edit.ItemType === ItemTypes.Login}
      onRemove={!passkey && canRemoveField(FieldKey.LoginEmail) ? (): void => removeOptionalField(FieldKey.LoginEmail) : undefined}
      onGenerateAlias={() => void onGenerateEmail()}
    />
  );

  const usernameField = (
    <EditUsernameFormRow id="username" label={t(`${tk}.UsernameLabel`)} value={getFieldValue(edit, FieldKey.LoginUsername)} onChange={value => update(current => setFieldValue(current, FieldKey.LoginUsername, value))} onGenerateNewUsername={() => void onGenerateUsername()} />
  );

  const passwordField = (
    <EditPasswordFormRow id="password" label={t(`${tk}.PasswordLabel`)} value={getFieldValue(edit, FieldKey.LoginPassword)} onChange={value => update(current => setFieldValue(current, FieldKey.LoginPassword, value))} showPassword={isPasswordVisible} />
  );

  /**
   * A plain text field bound to a system field.
   */
  const textField = (fieldKey: string, inputId: string, label: string, placeholder: string = ''): React.ReactNode => (
    <EditFormRow id={inputId} label={label} placeholder={placeholder} value={getFieldValue(edit, fieldKey)} onChange={value => update(current => setFieldValue(current, fieldKey, value))} />
  );

  /**
   * A masked field bound to a system field.
   */
  const secretField = (fieldKey: string, inputId: string, label: string): React.ReactNode => (
    <EditPasswordFormRow id={inputId} label={label} value={getFieldValue(edit, fieldKey)} onChange={value => update(current => setFieldValue(current, fieldKey, value))} showPassword={false} showGenerateButtons={false} />
  );

  return (
    <>
      <PageHeader
        breadcrumbItems={breadcrumbItems}
        title={editMode ? t(`${tk}.EditItemTitle`) : t(`${tk}.AddItemTitle`)}
        description={editMode ? t(`${tk}.EditItemDescription`) : t(`${tk}.AddItemDescription`)}
        customActions={(
          <>
            <Button color="success" onClick={() => void save()}>{t(`${tk}.SaveItemButton`)}</Button>
            <Button color="danger" onClick={cancel}>{t('sharedResources.Cancel')}</Button>
          </>
        )}
      />

      {loading ? <LoadingIndicator /> : (
        <PageContent>
          <form onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}>
            <div className="grid grid-cols-1 px-4 pt-6 md:grid-cols-2 lg:grid-cols-3 md:gap-4 dark:bg-gray-900">
              <div className="col-span-1 md:col-span-1 lg:col-span-1">
                <ItemTypeSelector selectedType={edit.ItemType} onSelectedTypeChange={(type) => {
                  void handleItemTypeChange(edit, type).then(setEdit);
                }} showDropdown={showTypeDropdown} onShowDropdownChange={setShowTypeDropdown} />

                <div className="p-4 mb-4 bg-white border-2 border-primary-600 rounded-lg shadow-sm 2xl:col-span-2 dark:border-gray-700 sm:p-6 dark:bg-gray-800">
                  <h3 className="mb-4 text-xl font-semibold dark:text-white">{t(`${tk}.ServiceSectionHeader`)}</h3>
                  <div className="grid gap-6">
                    <div className="col-span-6 sm:col-span-3">
                      <EditFormRow id="service-name" label={t(`${tk}.ServiceNameLabel`)} placeholder={t(`${tk}.ServiceNamePlaceholder`)} value={edit.ServiceName} onChange={(value) => {
                        setNameError('');
                        update(current => ({ ...current, ServiceName: value }));
                      }} />
                      {nameError.length > 0 && <div className="validation-message text-red-600 dark:text-red-400 text-sm mt-1">{nameError}</div>}
                      <FolderSelector selectedFolder={edit.FolderId ? { Id: edit.FolderId, ManifestId: edit.ManifestId } : null} onSelectedFolderChange={folder => update(current => setFolder(current, folder, dbContext.sqliteClient?.getPersonalManifestId() ?? null))} />
                    </div>
                    {shouldShowField(FieldKey.LoginUrl) && (
                      <div className="col-span-6 sm:col-span-3">
                        <MultiValueFormRow id="service-url" label={t(`${tk}.ServiceUrlLabel`)} values={getFieldValues(edit, FieldKey.LoginUrl)} onChange={values => update(current => setFieldValues(current, FieldKey.LoginUrl, values))} onFocus={onFocusUrlInput} />
                      </div>
                    )}
                  </div>
                </div>

                {show2FA && hasLoginFields && (
                  <div className="col-span-1 md:col-span-1 lg:col-span-1">
                    <TotpCodes
                      totpCodes={edit.TotpCodes}
                      onTotpCodesChange={totpCodes => update(current => ({ ...current, TotpCodes: totpCodes }))}
                      canRemove={!edit.TotpCodes.some(c => !c.IsDeleted)}
                      onRemove={remove2FASection}
                      itemDisplayName={edit.ServiceName}
                      itemUsername={getFieldValue(edit, FieldKey.LoginUsername) || getFieldValue(edit, FieldKey.LoginEmail)}
                    />
                  </div>
                )}

                {shouldShowField(FieldKey.NotesContent) && edit.ItemType !== ItemTypes.Note && (
                  <div className="col-span-1 md:col-span-1 lg:col-span-1">
                    <RemovableSection canRemove={canRemoveField(FieldKey.NotesContent)} onRemove={() => removeOptionalField(FieldKey.NotesContent)}>
                      <div className="col-span-6 sm:col-span-3">
                        <EditFormRow type="textarea" id="notes" label={t(`${tk}.NotesLabel`)} labelStyle="header" value={getFieldValue(edit, FieldKey.NotesContent)} onChange={value => update(current => setFieldValue(current, FieldKey.NotesContent, value))} />
                      </div>
                    </RemovableSection>
                  </div>
                )}

                {showAttachments && (
                  <div className="col-span-1 md:col-span-1 lg:col-span-1">
                    <RemovableSection title={t(`${tk}.AttachmentsSectionHeader`)} canRemove onRemove={removeAttachmentsSection}>
                      <div className="col-span-6 sm:col-span-3">
                        <AttachmentUploader attachments={edit.Attachments} onAttachmentsChange={attachments => update(current => ({ ...current, Attachments: attachments }))} />
                      </div>
                    </RemovableSection>
                  </div>
                )}

                <div className="hidden lg:block mb-4">{addFieldMenu}</div>
              </div>

              <div className="col-span-1 md:col-span-1 lg:col-span-2">
                {hasLoginFields && (
                  <Section className="overflow-visible" title={(
                    <>
                      <span>{t(`${tk}.LoginDetailsSectionHeader`)}</span>
                      {edit.ItemType === ItemTypes.Login && !shouldShowField(FieldKey.LoginEmail) && (
                        <button type="button" onClick={() => addOptionalField(FieldKey.LoginEmail)} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full transition-colors focus:outline-none text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 border border-dashed border-gray-300 dark:border-gray-600 hover:border-primary-400 dark:hover:border-primary-500">
                          <svg className="w-2.5 h-2.5 -ml-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                          </svg>
                          <span>{t('sharedResources.Email')}</span>
                        </button>
                      )}
                    </>
                  )}>
                    {passkey ? (
                      <>
                        <div className="col-span-6">{usernameField}</div>
                        {!passkeyMarkedForDeletion ? (
                          <div className="col-span-6">
                            <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
                              <div className="flex items-start gap-3">
                                <PasskeyIcon className="w-5 h-5 text-gray-600 dark:text-gray-400 mt-0.5 flex-shrink-0" />
                                <div className="flex-1">
                                  <div className="mb-1 flex items-center justify-between">
                                    <span className="text-sm font-semibold text-gray-900 dark:text-white">{t(`${tk}.PasskeyLabel`)}</span>
                                    <button type="button" onClick={() => setPasskeyMarkedForDeletion(true)} className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300" title={t(`${tk}.DeletePasskeyButton`)}>
                                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="3 6 5 6 21 6" />
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                        <line x1="10" y1="11" x2="10" y2="17" />
                                        <line x1="14" y1="11" x2="14" y2="17" />
                                      </svg>
                                    </button>
                                  </div>
                                  <div className="space-y-1 mb-2">
                                    {passkey.RpId.trim().length > 0 && (
                                      <div>
                                        <span className="text-xs text-gray-500 dark:text-gray-400">{t(`${tk}.PasskeySiteLabel`)}: </span>
                                        <span className="text-sm text-gray-900 dark:text-white">{passkey.RpId}</span>
                                      </div>
                                    )}
                                    {(passkey.DisplayName ?? '').trim().length > 0 && (
                                      <div>
                                        <span className="text-xs text-gray-500 dark:text-gray-400">{t(`${tk}.PasskeyDisplayNameLabel`)}: </span>
                                        <span className="text-sm text-gray-900 dark:text-white">{passkey.DisplayName}</span>
                                      </div>
                                    )}
                                  </div>
                                  <p className="text-xs text-gray-600 dark:text-gray-400">{t(`${tk}.PasskeyHelpText`)}</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="col-span-6">
                            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                              <div className="flex items-start gap-3">
                                <PasskeyIcon className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                                <div className="flex-1">
                                  <div className="mb-1 flex items-center justify-between">
                                    <span className="text-sm font-semibold text-red-900 dark:text-red-100">{t(`${tk}.PasskeyMarkedForDeletion`)}</span>
                                    <button type="button" onClick={() => setPasskeyMarkedForDeletion(false)} className="text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300" title={t(`${tk}.UndoButton`)}>
                                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M3 7v6h6" />
                                        <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" />
                                      </svg>
                                    </button>
                                  </div>
                                  <p className="text-xs text-red-800 dark:text-red-200">{t(`${tk}.PasskeyWillBeDeleted`)}</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                        <div className="col-span-6">{emailField}</div>
                        <div className="col-span-6">{passwordField}</div>
                      </>
                    ) : (
                      <>
                        {shouldShowField(FieldKey.LoginEmail) && <div className="col-span-6">{emailField}</div>}
                        <div className="col-span-6">{usernameField}</div>
                        <div className="col-span-6">{passwordField}</div>
                      </>
                    )}
                  </Section>
                )}

                {edit.ItemType === ItemTypes.Alias && (
                  <div className="col-span-1 md:col-span-1 lg:col-span-2">
                    <Card variant="section">
                      <h3 className="mb-4 text-xl font-semibold dark:text-white flex items-center justify-between gap-2">
                        <span>{t(`${tk}.AliasSectionHeader`)}</span>
                        <button type="button" id="generate-random-alias" onClick={() => void onGenerateRandomAlias()} className="p-1.5 text-gray-400 hover:text-primary-500 transition-colors focus:outline-none" title={t('sharedResources.Generate')}>
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M23 4v6h-6" />
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                          </svg>
                        </button>
                      </h3>
                      <div className="grid gap-6">
                        <div className="col-span-6 sm:col-span-3">{textField(FieldKey.AliasFirstName, 'first-name', t(`${tk}.FirstNameLabel`))}</div>
                        <div className="col-span-6 sm:col-span-3">{textField(FieldKey.AliasLastName, 'last-name', t(`${tk}.LastNameLabel`))}</div>
                        <div className="col-span-6 sm:col-span-3">{textField(FieldKey.AliasGender, 'gender', t(`${tk}.GenderLabel`))}</div>
                        <div className="col-span-6 sm:col-span-3">{textField(FieldKey.AliasBirthdate, 'birthdate', t(`${tk}.BirthDateLabel`))}</div>
                      </div>
                    </Card>
                  </div>
                )}

                {edit.ItemType === ItemTypes.CreditCard && (
                  <div className="col-span-1 md:col-span-1 lg:col-span-2">
                    <Section title={t(`${tk}.CardDetailsSectionHeader`)}>
                      <div className="col-span-6">{textField(FieldKey.CardCardholderName, 'cardholder-name', t(`${tk}.CardholderNameLabel`))}</div>
                      <div className="col-span-6">{secretField(FieldKey.CardNumber, 'card-number', t(`${tk}.CardNumberLabel`))}</div>
                      <div className="col-span-3">{textField(FieldKey.CardExpiryMonth, 'expiry-month', t(`${tk}.ExpiryMonthLabel`), 'MM')}</div>
                      <div className="col-span-3">{textField(FieldKey.CardExpiryYear, 'expiry-year', t(`${tk}.ExpiryYearLabel`), 'YYYY')}</div>
                      <div className="col-span-6 sm:col-span-3">{secretField(FieldKey.CardCvv, 'cvv', t(`${tk}.CardCvvLabel`))}</div>
                      {shouldShowField(FieldKey.CardPin) && (
                        <div className="col-span-6 sm:col-span-3 relative">
                          {secretField(FieldKey.CardPin, 'pin', t(`${tk}.CardPinLabel`))}
                          {canRemoveField(FieldKey.CardPin) && (
                            <button type="button" onClick={() => removeOptionalField(FieldKey.CardPin)} className="absolute top-0 right-0 text-gray-400 hover:text-red-500 transition-colors" title={t(`${tk}.RemoveField`)}>
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </div>
                      )}
                    </Section>
                  </div>
                )}

                {edit.ItemType === ItemTypes.Note && (
                  <div className="col-span-1 md:col-span-1 lg:col-span-2">
                    <Section title={t(`${tk}.NotesLabel`)}>
                      <div className="col-span-6">
                        <EditFormRow type="textarea" id="notes" label="" value={getFieldValue(edit, FieldKey.NotesContent)} onChange={value => update(current => setFieldValue(current, FieldKey.NotesContent, value))} />
                      </div>
                    </Section>
                  </div>
                )}

                {customFields.length > 0 && (
                  <div className="col-span-1 md:col-span-1 lg:col-span-2">
                    <Card variant="section">
                      <h3 className="mb-4 text-xl font-semibold dark:text-white">{t(`${tk}.CustomFieldsSectionHeader`)}</h3>
                      <DraggableCustomFieldsList
                        customFields={customFields}
                        onReorder={reordered => update(current => reorderCustomFields(current, reordered))}
                        onValueChange={(fieldKey, value) => update(current => ({ ...current, Fields: current.Fields.map(f => f.FieldKey === fieldKey ? { ...f, Value: value } : f) }))}
                        onFieldUpdate={(fieldKey, label, fieldType) => update(current => updateCustomField(current, fieldKey, label, fieldType))}
                        onDelete={fieldKey => update(current => removeCustomField(current, fieldKey))}
                      />
                    </Card>
                  </div>
                )}

                <div className="col-span-1 md:col-span-1 lg:col-span-2 mb-4">{addFieldMenu}</div>
              </div>
            </div>
            <button type="submit" className="hidden">{t(`${tk}.SaveItemButton`)}</button>
          </form>

          <StickyActionBar>
            <Button color="success" onClick={() => void save()}>{t(`${tk}.SaveItemButton`)}</Button>
            <Button color="danger" onClick={cancel}>{t('sharedResources.Cancel')}</Button>
          </StickyActionBar>
        </PageContent>
      )}
    </>
  );
};

export default ItemAddEdit;
