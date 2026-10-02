import { FieldTypes } from '@aliasvault/models/vault';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import CopyPasteFormRow from '@/components/forms/CopyPasteFormRow';
import CopyPastePasswordFormRow from '@/components/forms/CopyPastePasswordFormRow';
import type { DisplayField } from '@/components/items/DisplayField';
import FieldHistoryModal from '@/components/items/FieldHistoryModal';
import FormLabel from '@/components/shared/FormLabel';
import Icon from '@/components/shared/Icon';
import { useDb } from '@/context/DbContext';

import type { ItemRef } from '@aliasvault/client/database/ItemRef';

type FieldBlockProps = {
  field: DisplayField;
  item: ItemRef;
  fullWidth?: boolean;
  /** Hide the label when the section header already names the field. */
  hideLabel?: boolean;
};

/**
 * snake_case to Title Case.
 */
const formatFieldName = (fieldName: string): string => fieldName.split('_').map(w => w.length > 0 ? w[0].toUpperCase() + w.slice(1) : '').join(' ');

/**
 * The label of a field: the custom label, the localized system label, or the key made readable.
 */
export function useFieldLabel(field: DisplayField): string {
  const { t } = useTranslation();
  return useMemo(() => {
    if (field.IsCustomField) {
      return field.Label.length > 0 ? field.Label : formatFieldName(field.FieldKey);
    }
    if (field.FieldKey.length > 0) {
      const key = `fieldLabels.${field.FieldKey}`;
      const localized = t(key, { defaultValue: '' });
      if (localized.length > 0) {
        return localized;
      }
      const parts = field.FieldKey.split('.');
      if (parts.length > 1) {
        return formatFieldName(parts[1]);
      }
    }
    return formatFieldName(field.FieldKey);
  }, [field.FieldKey, field.IsCustomField, field.Label, t]);
}

/**
 * Text with http(s) links made clickable.
 */
const TextWithLinks: React.FC<{ text: string }> = ({ text }) => {
  const parts = text.split(/(https?:\/\/[^\s<>"]+)/g);
  return (
    <>
      {parts.map((part, index) => /^https?:\/\//.test(part)
        ? <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="text-primary-600 dark:text-primary-400 hover:underline">{part}</a>
        : <React.Fragment key={index}>{part}</React.Fragment>)}
    </>
  );
};

/**
 * Renders a single item field by its type.
 */
const FieldBlock: React.FC<FieldBlockProps> = ({ field, item, fullWidth = false, hideLabel = false }) => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const label = useFieldLabel(field);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyCount, setHistoryCount] = useState(0);
  const fieldId = field.FieldKey.length > 0 ? field.FieldKey.replace(/\./g, '-') : field.Label;
  const widthClass = fullWidth ? 'col-span-6' : 'col-span-6 sm:col-span-3';

  /*
   * The history icon only shows when there is history that differs from the current value: a single record equal
   * to the current value is the snapshot taken on the last save, not a change.
   */
  useEffect(() => {
    if (!field.EnableHistory || !dbContext.sqliteClient || field.FieldKey.length === 0 || showHistoryModal) {
      return;
    }
    const records = dbContext.sqliteClient.items.getFieldHistory({ Id: item.Id, ManifestId: item.ManifestId }, field.FieldKey);
    if (records.length > 1) {
      setHistoryCount(records.length);
    } else if (records.length === 1) {
      setHistoryCount(records[0].ValueSnapshot !== JSON.stringify([field.Value].filter(v => v.trim().length > 0)) ? 1 : 0);
    } else {
      setHistoryCount(0);
    }
  }, [dbContext.sqliteClient, field.EnableHistory, field.FieldKey, field.Value, item.Id, item.ManifestId, showHistoryModal]);

  const labelElement = (
    <FormLabel htmlFor={fieldId}>
      {label}
      {field.EnableHistory && historyCount > 0 && (
        <button type="button" className="ml-2 inline-flex items-center text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 focus:outline-none" title={t('items.viewHistory')} onClick={() => setShowHistoryModal(true)}>
          <Icon name="clock" className="h-4 w-4" />
        </button>
      )}
    </FormLabel>
  );

  /**
   * The field body by type.
   */
  const renderField = (): React.ReactNode => {
    switch (field.FieldType) {
      case FieldTypes.Password:
      case FieldTypes.Hidden:
        return (
          <div className={widthClass}>
            {labelElement}
            <CopyPastePasswordFormRow id={fieldId} label="" value={field.Value} item={item} />
          </div>
        );
      case FieldTypes.TextArea:
        return (
          <div className="col-span-6">
            {!hideLabel && labelElement}
            <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg text-gray-900 dark:text-white whitespace-pre-wrap text-sm">
              <TextWithLinks text={field.Value} />
            </div>
          </div>
        );
      case FieldTypes.URL:
        return (
          <div className="col-span-6">
            {labelElement}
            {field.Value.length > 0 && (/^https?:\/\//i.test(field.Value)
              ? <a href={field.Value} target="_blank" rel="noopener noreferrer" className="text-primary-600 dark:text-primary-400 hover:underline break-all">{field.Value}</a>
              : <span className="text-gray-700 dark:text-gray-300 break-all">{field.Value}</span>)}
          </div>
        );
      default:
        return (
          <div className={widthClass}>
            {labelElement}
            <CopyPasteFormRow id={fieldId} label="" value={field.Value} item={item} />
          </div>
        );
    }
  };

  return (
    <>
      {renderField()}
      {showHistoryModal && (
        <FieldHistoryModal item={item} fieldKey={field.FieldKey} fieldLabel={label} isHidden={field.FieldType === FieldTypes.Password || field.FieldType === FieldTypes.Hidden} onClose={() => setShowHistoryModal(false)} />
      )}
    </>
  );
};

export default FieldBlock;
