import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';
import { FormInputCopyToClipboard } from '@/entrypoints/popup/components/Forms/FormInputCopyToClipboard';
import { useDb } from '@/entrypoints/popup/context/DbContext';

import type { FieldHistory, FieldType } from '@/utils/dist/core/models/vault';
import { FieldTypes } from '@/utils/dist/core/models/vault';

type FieldHistoryModalProps = {
  isOpen: boolean;
  onClose: () => void;
  itemId: string;
  fieldKey: string;
  fieldLabel: string;
  fieldType: FieldType;
  isHidden: boolean;
}

/**
 * Modal component for displaying field value history.
 * Shows historical values with dates.
 * For hidden/password fields, values are masked by default.
 * For other fields, values are visible by default.
 */
const FieldHistoryModal: React.FC<FieldHistoryModalProps> = ({
  isOpen,
  onClose,
  itemId,
  fieldKey,
  fieldLabel,
  fieldType,
  isHidden
}) => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const [history, setHistory] = useState<FieldHistory[]>([]);
  const [loading, setLoading] = useState(true);

  // For non-hidden fields, show values by default
  const shouldMaskByDefault = isHidden || fieldType === FieldTypes.Password || fieldType === FieldTypes.Hidden;

  useEffect(() => {
    if (!isOpen || !dbContext?.sqliteClient) {
      return;
    }

    try {
      setLoading(true);
      const historyRecords = dbContext.sqliteClient.items.getFieldHistory(itemId, fieldKey);
      setHistory(historyRecords);
    } catch (error) {
      console.error('Error loading field history:', error);
    } finally {
      setLoading(false);
    }
  }, [isOpen, dbContext?.sqliteClient, itemId, fieldKey]);

  /**
   * Format a date string to a human readable format.
   */
  const formatDate = (dateString: string): string => {
    try {
      const date = new Date(dateString);
      return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateString;
    }
  };

  /**
   * Parse a value snapshot into an array of values.
   */
  const parseValueSnapshot = (snapshot: string): string[] => {
    try {
      return JSON.parse(snapshot);
    } catch {
      return [snapshot];
    }
  };

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onClose}
      title={`${fieldLabel} ${t('items.history')}`}
      maxWidth="max-w-2xl"
      bodyClassName="px-4 pb-4 pt-4 overflow-y-auto max-h-[60vh]"
    >
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : history.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          {t('items.noHistoryAvailable')}
        </div>
      ) : (
        <div className="space-y-3">
          {history.map((record) => {
            const values = parseValueSnapshot(record.ValueSnapshot);

            return (
              <div
                key={record.Id}
                className="rounded-lg p-4 border border-gray-200 dark:border-gray-700"
              >
                <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                  {formatDate(record.ChangedAt)}
                </div>

                {values.map((value, idx) => (
                  <div key={idx} className="mt-2">
                    <FormInputCopyToClipboard
                      id={`history-${record.Id}-${idx}`}
                      label=""
                      value={value}
                      type={shouldMaskByDefault ? 'password' : 'text'}
                    />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </ModalWrapper>
  );
};

export default FieldHistoryModal;
