import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { FormInputCopyToClipboard } from '@/entrypoints/popup/components/Forms/FormInputCopyToClipboard';
import { useDb } from '@/entrypoints/popup/context/DbContext';

import type { ItemField } from '@/utils/dist/core/models/vault';
import { FieldTypes } from '@/utils/dist/core/models/vault';

import FieldHistoryModal from './FieldHistoryModal';

type FieldBlockProps = {
  field: ItemField;
  itemId?: string;
  /** Whether to hide the label (useful when label is already shown as section header) */
  hideLabel?: boolean;
}

/**
 * Convert URLs in text to clickable links (same as NotesBlock).
 */
const convertUrlsToLinks = (text: string): string => {
  const urlPattern = /(https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,})/g;

  return text.replace(urlPattern, (url) => {
    const href = url.startsWith('http') ? url : `http://${url}`;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300">${url}</a>`;
  });
};

/**
 * Dynamic field block component that renders based on field type.
 * Uses the same FormInputCopyToClipboard component as existing credential blocks.
 */
const FieldBlock: React.FC<FieldBlockProps> = ({ field, itemId, hideLabel = false }) => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyCount, setHistoryCount] = useState<number>(0);

  /* Get translated label for this field. System fields use fieldLabels.* translations, custom fields use their stored label */
  const label = field.IsCustomField
    ? (field.Label || field.FieldKey)
    : t(`fieldLabels.${field.FieldKey}`, { defaultValue: field.FieldKey });

  // Check if this field has history enabled
  const hasHistoryEnabled = field.EnableHistory === true;

  /**
   * Check if there's meaningful history available.
   * Only show history icon if:
   * 1. There are more than 1 history records, OR
   * 2. There is exactly 1 history record but its value differs from current value
   */
  useEffect(() => {
    if (hasHistoryEnabled && itemId && dbContext?.sqliteClient) {
      try {
        const history = dbContext.sqliteClient.items.getFieldHistory(itemId, field.FieldKey);

        if (history.length > 1) {
          // Multiple history records - always show icon
          setHistoryCount(history.length);
        } else if (history.length === 1) {
          // Single history record - check if value differs from current
          const currentValues = Array.isArray(field.Value) ? field.Value : [field.Value];
          const currentValueJson = JSON.stringify(currentValues.filter(v => v && v.trim() !== ''));
          const historyValueJson = history[0].ValueSnapshot;

          // Only show icon if history value differs from current value
          if (currentValueJson !== historyValueJson) {
            setHistoryCount(1);
          } else {
            setHistoryCount(0);
          }
        } else {
          setHistoryCount(0);
        }
      } catch (error) {
        console.error('[FieldBlock] Error checking history:', error);
      }
    }
  }, [hasHistoryEnabled, itemId, field.FieldKey, field.Value, dbContext?.sqliteClient]);

  // Skip rendering if no value
  if (!field.Value || (typeof field.Value === 'string' && field.Value.trim() === '')) {
    return null;
  }

  const values = Array.isArray(field.Value) ? field.Value : [field.Value];

  // Handle multi-value fields (like multiple URLs)
  if (values.length > 1) {
    return (
      <div className="space-y-2">
        {values.map((value, idx) => (
          <FormInputCopyToClipboard
            key={`${field.FieldKey}-${idx}`}
            id={`${field.FieldKey}-${idx}`}
            label={idx === 0 ? label : `${label} ${idx + 1}`}
            value={value}
            type={field.FieldType === FieldTypes.Password ? 'password' : 'text'}
          />
        ))}
      </div>
    );
  }

  const value = values[0];

  // History button component that can be added to any field label
  const HistoryButton = historyCount > 0 && itemId ? (
    <button
      type="button"
      onClick={() => setShowHistoryModal(true)}
      className="ml-2 inline-flex items-center text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 focus:outline-none"
      title={t('items.viewHistory')}
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    </button>
  ) : null;

  // History modal component
  const HistoryModal = showHistoryModal && itemId ? (
    <FieldHistoryModal
      isOpen={showHistoryModal}
      onClose={() => setShowHistoryModal(false)}
      itemId={itemId}
      fieldKey={field.FieldKey}
      fieldLabel={label}
      fieldType={field.FieldType}
      isHidden={field.IsHidden}
    />
  ) : null;

  // Render based on field type
  switch (field.FieldType) {
    case FieldTypes.Password:
    case FieldTypes.Hidden:
      return (
        <>
          <FormInputCopyToClipboard
            id={field.FieldKey}
            label={label}
            value={value}
            type="password"
            labelSuffix={HistoryButton}
          />
          {HistoryModal}
        </>
      );

    case FieldTypes.TextArea:
      // Use NotesBlock-style rendering for multi-line text
      return (
        <div>
          {!hideLabel && (
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {label}
            </label>
          )}
          <div className="p-4 bg-gray-50 rounded-lg dark:bg-gray-700">
            <p
              className="text-gray-900 dark:text-gray-100 whitespace-pre-wrap"
              dangerouslySetInnerHTML={{ __html: convertUrlsToLinks(value) }}
            />
          </div>
        </div>
      );

    case FieldTypes.Email:
    case FieldTypes.URL:
    case FieldTypes.Phone:
    case FieldTypes.Date:
    case FieldTypes.Number:
    case FieldTypes.Text:
    default:
      return (
        <>
          <FormInputCopyToClipboard
            id={field.FieldKey}
            label={label}
            value={value}
            type="text"
            labelSuffix={HistoryButton}
          />
          {HistoryModal}
        </>
      );
  }
};

export default FieldBlock;
