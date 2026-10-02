import { ItemTypes, type ItemType } from '@aliasvault/models/vault';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import FormLabel from '@/components/shared/FormLabel';
import Modal from '@/components/shared/Modal';
import { useDb } from '@/context/DbContext';
import { useLoading } from '@/context/LoadingContext';
import { useNotifications } from '@/context/NotificationContext';
import { useWebApi } from '@/context/WebApiContext';
import { useSaveItem } from '@/hooks/useSaveItem';
import { createNewItemEdit, type ItemEdit, setFieldValue } from '@/models/ItemEdit';
import { generateIdentity } from '@/utils/IdentityGenerator';
import { itemRoute } from '@/utils/ItemRoute';

import type { FolderRef } from '@aliasvault/client/database/repositories/FolderRepository';

/** The URL prefilled in the website field. */
const DEFAULT_SERVICE_URL = 'https://';

/** The icon of each item type in the type selector. */
const TYPE_ICON_PATHS: Record<ItemType, string> = {
  [ItemTypes.Login]: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z',
  [ItemTypes.Alias]: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  [ItemTypes.CreditCard]: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
  [ItemTypes.Note]: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
};

const ALL_TYPES: ItemType[] = [ItemTypes.Login, ItemTypes.Alias, ItemTypes.CreditCard, ItemTypes.Note];

type QuickCreateDialogProps = {
  /** The type selected when the dialog opens. */
  initialType: ItemType;
  onClose: () => void;
  /** `modal` centers it over the page; `popover` anchors it below its trigger (the parent is `relative`). */
  variant?: 'modal' | 'popover';
};

/**
 * Quick create form, as a modal or a popover: an alias is created in place with a random identity, the other types
 * continue on the create page with the entered values. New items land in the folder the user is looking at.
 */
const QuickCreateDialog: React.FC<QuickCreateDialogProps> = ({ initialType, onClose, variant = 'modal' }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const dbContext = useDb();
  const { showLoading, hideLoading } = useLoading();
  const notifications = useNotifications();
  const webApi = useWebApi();
  const { saveItem } = useSaveItem();
  const [isCreating, setIsCreating] = useState(false);
  const [itemType, setItemType] = useState<ItemType>(initialType);
  const [serviceName, setServiceName] = useState('');
  const [serviceUrl, setServiceUrl] = useState(DEFAULT_SERVICE_URL);
  const [nameError, setNameError] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => nameInputRef.current?.focus(), 50);
    return (): void => clearTimeout(timer);
  }, [itemType]);

  useEffect(() => {
    /**
     * Escape closes the dialog.
     */
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return (): void => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  /**
   * The folder the user is looking at, if any.
   */
  const getCurrentFolderFromUrl = (): FolderRef | null => {
    const match = /^\/items\/folder\/([^/]+)\/([^/]+)/.exec(location.pathname);
    return match ? { ManifestId: decodeURIComponent(match[1]), Id: decodeURIComponent(match[2]) } : null;
  };

  /**
   * Create an alias right away with a random identity.
   */
  const createAlias = async (): Promise<void> => {
    if (isCreating) {
      return;
    }
    setIsCreating(true);
    showLoading(t('items.quickCreate.creatingNewAliasMessage'));
    try {
      let edit: ItemEdit = { ...createNewItemEdit(getCurrentFolderFromUrl(), dbContext.sqliteClient?.getPersonalManifestId() ?? null), ItemType: ItemTypes.Alias, ServiceName: serviceName.trim() };
      if (serviceUrl !== DEFAULT_SERVICE_URL) {
        edit = setFieldValue(edit, 'login.url', serviceUrl);
      }
      const identity = dbContext.sqliteClient ? await generateIdentity(dbContext.sqliteClient, webApi) : null;
      if (identity) {
        edit = setFieldValue(edit, 'login.username', identity.username);
        edit = setFieldValue(edit, 'login.password', identity.password);
        edit = setFieldValue(edit, 'login.email', identity.email);
        edit = setFieldValue(edit, 'alias.first_name', identity.firstName);
        edit = setFieldValue(edit, 'alias.last_name', identity.lastName);
        edit = setFieldValue(edit, 'alias.gender', identity.gender);
        edit = setFieldValue(edit, 'alias.birthdate', identity.birthdate);
      }
      const saved = await saveItem(edit);
      notifications.addSuccessMessage(t('items.toasts.itemCreated'));
      onClose();
      navigate(itemRoute(saved));
    } catch (error) {
      console.error('Error creating alias:', error);
      notifications.addErrorMessage(t('items.quickCreate.createItemErrorMessage'), true);
    } finally {
      hideLoading();
      setIsCreating(false);
    }
  };

  /**
   * Create the alias in place, or continue to the create page with the entered values.
   */
  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (serviceName.trim().length === 0) {
      setNameError(t('validation.serviceNameRequired'));
      return;
    }
    if (itemType === ItemTypes.Alias) {
      void createAlias();
      return;
    }
    const params = new URLSearchParams();
    params.set('type', itemType);
    params.set('name', serviceName.trim());
    if (serviceUrl !== DEFAULT_SERVICE_URL) {
      params.set('url', serviceUrl);
    }
    const folder = getCurrentFolderFromUrl();
    if (folder) {
      params.set('folderId', folder.Id);
      params.set('folderManifestId', folder.ManifestId);
    }
    onClose();
    navigate(`/items/create?${params.toString()}`);
  };

  /**
   * The popup title for the selected type.
   */
  const getPopupTitle = (): string => {
    switch (itemType) {
      case ItemTypes.Alias: return t('items.quickCreate.createNewAliasTitle');
      case ItemTypes.CreditCard: return t('items.quickCreate.createNewCreditCardTitle');
      case ItemTypes.Note: return t('items.quickCreate.createNewNoteTitle');
      default: return t('items.quickCreate.createNewLoginTitle');
    }
  };

  /**
   * The name placeholder for the selected type.
   */
  const getNamePlaceholder = (): string => {
    switch (itemType) {
      case ItemTypes.Alias: return t('items.addEdit.serviceNamePlaceholder');
      case ItemTypes.CreditCard: return t('items.quickCreate.namePlaceholderCard');
      case ItemTypes.Note: return t('items.quickCreate.namePlaceholderNote');
      default: return t('items.addEdit.serviceNamePlaceholder');
    }
  };

  /**
   * The display name of an item type.
   */
  const getTypeDisplayName = (type: ItemType): string => {
    switch (type) {
      case ItemTypes.Alias: return t('common.alias');
      case ItemTypes.CreditCard: return t('items.quickCreate.typeCard');
      case ItemTypes.Note: return t('itemTypes.note.title');
      default: return t('items.quickCreate.typeLogin');
    }
  };

  const form = (
    <>
      <div className="mb-4">
        <div className="flex gap-1">
          {ALL_TYPES.map(type => (
            <button
              key={type}
              type="button"
              id={`quickIdentityType_${type}`}
              onClick={() => setItemType(type)}
              className={`flex-1 px-2 py-2 text-xs font-medium rounded-md transition-colors flex flex-col items-center gap-1 ${itemType === type ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 border border-primary-300 dark:border-primary-700' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border border-transparent'}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={TYPE_ICON_PATHS[type]} /></svg>
              <span>{getTypeDisplayName(type)}</span>
            </button>
          ))}
        </div>
      </div>

      <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">{getPopupTitle()}</h3>
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <FormLabel htmlFor="serviceName">{t('items.itemName')}</FormLabel>
          <input
            ref={nameInputRef}
            id="serviceName"
            type="text"
            value={serviceName}
            onChange={(e) => {
              setServiceName(e.target.value); setNameError(''); 
            }}
            placeholder={getNamePlaceholder()}
            className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-primary-500 dark:focus:border-primary-500" />
          {nameError && <div className="validation-message text-sm mt-1">{nameError}</div>}
        </div>
        {(itemType === ItemTypes.Login || itemType === ItemTypes.Alias) && (
          <div className="mb-4">
            <FormLabel htmlFor="serviceUrl">{t('fieldLabels.login.url')}</FormLabel>
            <input
              id="serviceUrl"
              type="text"
              value={serviceUrl}
              onChange={(e) => setServiceUrl(e.target.value)}
              onFocus={(e) => {
                if (e.target.value === DEFAULT_SERVICE_URL) {
                  setTimeout(() => e.target.setSelectionRange(DEFAULT_SERVICE_URL.length, DEFAULT_SERVICE_URL.length), 1); 
                } 
              }}
              className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-primary-500 dark:focus:border-primary-500" />
          </div>
        )}
        <div className="flex justify-between items-center">
          <button id="quickIdentitySubmit" type="submit" className={`${itemType === ItemTypes.Alias ? 'bg-green-600 hover:bg-green-700' : 'bg-primary-600 hover:bg-primary-700'} text-white font-bold py-2 px-4 rounded flex items-center gap-2`}>
            {itemType === ItemTypes.Alias ? t('common.create') : (
              <>
                {t('common.continue')}
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                </svg>
              </>
            )}
          </button>
        </div>
      </form>
    </>
  );

  if (variant === 'popover') {
    return (
      <div id="quickIdentityPopup" className="absolute right-0 top-full z-50 mt-3 p-4 bg-white rounded-lg shadow-xl border border-gray-200 dark:bg-gray-800 dark:border-gray-600" style={{ width: 'min(400px, calc(100vw - 20px))' }}>
        {form}
      </div>
    );
  }

  return (
    <Modal id="quickIdentityPopup" position="top" panelClassName="p-4 sm:p-5 w-full max-w-md" onBackdropClick={onClose}>
      {form}
    </Modal>
  );
};

export default QuickCreateDialog;
