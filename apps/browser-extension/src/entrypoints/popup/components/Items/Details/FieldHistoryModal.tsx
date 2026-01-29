import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';
import { FormInputCopyToClipboard } from '@/entrypoints/popup/components/Forms/FormInputCopyToClipboard';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useVaultMutate } from '@/entrypoints/popup/hooks/useVaultMutate';

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
  const { executeVaultMutationAsync } = useVaultMutate();
  const [history, setHistory] = useState<FieldHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // For non-hidden fields, show values by default
  const shouldMaskByDefault = isHidden || fieldType === FieldTypes.Password || fieldType === FieldTypes.Hidden;

  /**
   * Load field history from the database.
   */
  const loadHistory = useCallback(async (): Promise<void> => {
    if (!dbContext?.sqliteClient) {
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
  }, [dbContext?.sqliteClient, itemId, fieldKey]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    loadHistory();
  }, [isOpen, dbContext?.sqliteClient, itemId, fieldKey, loadHistory]);

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

  /**
   * Handle delete of a history record.
   */
  const handleDelete = async (historyId: string): Promise<void> => {
    if (!dbContext?.sqliteClient) {
      return;
    }

    try {
      // Use vault mutation to delete and sync in background
      await executeVaultMutationAsync(async () => {
        await dbContext.sqliteClient!.items.deleteFieldHistory(historyId);
      });
      // Reload history after deletion
      loadHistory();
      setConfirmDeleteId(null);
    } catch (error) {
      console.error('Error deleting field history:', error);
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
            const isConfirmingDelete = confirmDeleteId === record.Id;

            return (
              <div
                key={record.Id}
                className="rounded-lg p-4 border border-gray-200 dark:border-gray-700"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    {formatDate(record.ChangedAt)}
                  </div>
                  {isConfirmingDelete ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleDelete(record.Id)}
                        className="text-xs px-2 py-1 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium"
                      >
                        {t('common.confirm')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(record.Id)}
                      className="text-xs px-2 py-1 text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 transition-colors"
                      title={t('common.delete')}
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                      </svg>
                    </button>
                  )}
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
