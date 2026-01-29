import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import {
  TotpBlock,
  AttachmentBlock,
  FieldBlock,
  PasskeyBlock
} from '@/entrypoints/popup/components/Items/Details';
import ItemIcon from '@/entrypoints/popup/components/Items/ItemIcon';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { PopoutUtility } from '@/entrypoints/popup/utils/PopoutUtility';

import type { Item } from '@/utils/dist/core/models/vault';
import { FieldCategories, FieldTypes, ItemTypes } from '@/utils/dist/core/models/vault';
import { groupFieldsByCategory } from '@/utils/dist/core/models/vault';

import { EmailPreview } from '../../components/EmailPreview';

/**
 * Item details page with dynamic field rendering.
 */
const ItemDetails: React.FC = (): React.ReactElement => {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const dbContext = useDb();
  const [item, setItem] = useState<Item | null>(null);
  const { setIsInitialLoading } = useLoading();
  const { setHeaderButtons } = useHeaderButtons();

  /**
   * Open the item details in a new expanded popup.
   */
  const openInNewPopup = useCallback((): void => {
    PopoutUtility.openInNewPopup(`/items/${id}`);
  }, [id]);

  /**
   * Navigate to the edit page for this item.
   */
  const handleEdit = useCallback((): void => {
    navigate(`/items/${id}/edit`);
  }, [id, navigate]);

  useEffect(() => {
    if (PopoutUtility.isPopup()) {
      window.history.replaceState({}, '', `popup.html#/items`);
      window.history.pushState({}, '', `popup.html#/items/${id}`);
    }

    if (!dbContext?.sqliteClient || !id) {
      return;
    }

    try {
      const result = dbContext.sqliteClient.items.getById(id);
      if (result) {
        setItem(result);
        setIsInitialLoading(false);
      } else {
        console.error('Item not found');
        navigate('/items');
      }
    } catch (err) {
      console.error('Error loading item:', err);
    }
  }, [dbContext.sqliteClient, id, navigate, setIsInitialLoading]);

  // Set header buttons on mount and clear on unmount
  useEffect((): (() => void) => {
    const headerButtonsJSX = (
      <div className="flex items-center gap-2">
        {!PopoutUtility.isPopup() && (
          <HeaderButton
            onClick={openInNewPopup}
            title={t('common.openInNewWindow')}
            iconType={HeaderIconType.EXPAND}
          />
        )}
        <HeaderButton
          onClick={handleEdit}
          title={t('items.editItem')}
          iconType={HeaderIconType.EDIT}
        />
      </div>
    );
    setHeaderButtons(headerButtonsJSX);
    return () => {};
  }, [setHeaderButtons, handleEdit, openInNewPopup, t]);

  // Clear header buttons on unmount
  useEffect((): (() => void) => {
    return () => setHeaderButtons(null);
  }, [setHeaderButtons]);

  if (!item) {
    return <div>{t('common.loading')}</div>;
  }

  // Extract URL fields for prominent display
  const urlFields = item.Fields.filter(field => field.FieldType === FieldTypes.URL && field.Value);

  // Create a modified item without URL fields for grouping
  const itemWithoutUrls = {
    ...item,
    Fields: item.Fields.filter(field => field.FieldType !== FieldTypes.URL)
  };

  // Group fields by category for organized display (excluding URLs)
  const groupedFields = groupFieldsByCategory(itemWithoutUrls);

  return (
    <div className="space-y-4">
      {/* Header with name, logo, and URLs */}
      <div className="flex justify-between items-start">
        <div className="flex items-start gap-3">
          <ItemIcon item={item} className="w-12 h-12 rounded-lg" />
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">
              {item.Name || t('items.untitled')}
            </h1>
            {/* Display URLs prominently below title */}
            {urlFields.length > 0 && (
              <div className="mt-1 space-y-1">
                {urlFields.flatMap((urlField) => {
                  // Handle both single string and array of strings
                  const urlValues = Array.isArray(urlField.Value) ? urlField.Value : [urlField.Value];

                  return urlValues.map((urlValue, idx) => {
                    const isValidUrl = /^https?:\/\//i.test(urlValue);

                    return isValidUrl ? (
                      <a
                        key={`${urlField.FieldKey}-${idx}`}
                        href={urlValue}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 break-all text-sm"
                      >
                        {urlValue}
                      </a>
                    ) : (
                      <span
                        key={`${urlField.FieldKey}-${idx}`}
                        className="block text-gray-500 dark:text-gray-300 break-all text-sm"
                      >
                        {urlValue}
                      </span>
                    );
                  });
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Email block with recent emails - only for Login and Alias types with email field */}
      {(item.ItemType === ItemTypes.Login || item.ItemType === ItemTypes.Alias) && ((): React.ReactNode => {
        const emailField = item.Fields.find(f => f.FieldKey === 'login.email');
        const emailValue = emailField?.Value;
        const email = Array.isArray(emailValue) ? emailValue[0] : emailValue;
        return email ? <EmailPreview email={email} /> : null;
      })()}

      {/* TOTP codes - only for Login and Alias types, shown at top */}
      {(item.ItemType === ItemTypes.Login || item.ItemType === ItemTypes.Alias) && (
        <TotpBlock itemId={item.Id} />
      )}

      {/* Passkeys - only for Login and Alias types */}
      {(item.ItemType === ItemTypes.Login || item.ItemType === ItemTypes.Alias) && item.HasPasskey && (
        <PasskeyBlock itemId={item.Id} />
      )}

      {/* Notes - shown at top for Note type (primary content) */}
      {item.ItemType === ItemTypes.Note && groupedFields[FieldCategories.Notes] && groupedFields[FieldCategories.Notes].length > 0 && (
        groupedFields[FieldCategories.Notes].map((field) => (
          <div key={field.FieldKey} className="space-y-2">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              {t(`fieldLabels.${field.FieldKey}`, { defaultValue: field.Label || field.FieldKey })}
            </h2>
            <FieldBlock field={field} itemId={item.Id} hideLabel />
          </div>
        ))
      )}

      {/* Render fields dynamically by category */}
      {Object.keys(groupedFields).length > 0 && (
        <>
          {groupedFields[FieldCategories.Login] && groupedFields[FieldCategories.Login].length > 0 && (
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                {t('common.credentials')}
              </h2>
              {groupedFields[FieldCategories.Login].map((field) => (
                <FieldBlock key={field.FieldKey} field={field} itemId={item.Id} />
              ))}
            </div>
          )}

          {groupedFields[FieldCategories.Alias] && groupedFields[FieldCategories.Alias].length > 0 && (
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                {t('common.alias')}
              </h2>
              {groupedFields[FieldCategories.Alias].map((field) => (
                <FieldBlock key={field.FieldKey} field={field} itemId={item.Id} />
              ))}
            </div>
          )}

          {groupedFields[FieldCategories.Card] && groupedFields[FieldCategories.Card].length > 0 && (
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                {t('items.cardInformation')}
              </h2>
              {groupedFields[FieldCategories.Card].map((field) => (
                <FieldBlock key={field.FieldKey} field={field} itemId={item.Id} />
              ))}
            </div>
          )}

          {/* Notes - shown before custom fields for non-Note types */}
          {item.ItemType !== ItemTypes.Note && groupedFields[FieldCategories.Notes] && groupedFields[FieldCategories.Notes].length > 0 && (
            groupedFields[FieldCategories.Notes].map((field) => (
              <div key={field.FieldKey} className="space-y-2">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  {t(`fieldLabels.${field.FieldKey}`, { defaultValue: field.Label || field.FieldKey })}
                </h2>
                <FieldBlock field={field} itemId={item.Id} hideLabel />
              </div>
            ))
          )}

          {/* Custom Fields */}
          {groupedFields[FieldCategories.Custom] && groupedFields[FieldCategories.Custom].length > 0 && (
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                {t('common.customFields')}
              </h2>
              {groupedFields[FieldCategories.Custom].map((field) => (
                <FieldBlock key={field.FieldKey} field={field} itemId={item.Id} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Attachments - shown at bottom */}
      <AttachmentBlock itemId={item.Id} />

      {/* Tags */}
      {item.Tags && item.Tags.length > 0 && (
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('items.tags')}
          </label>
          <div className="flex flex-wrap gap-2">
            {item.Tags.map((tag) => (
              <span
                key={tag.Id}
                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
              >
                {tag.Name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ItemDetails;
