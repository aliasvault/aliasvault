import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import CopyPasteFormRow from '@/components/forms/CopyPasteFormRow';
import CopyPastePasswordFormRow from '@/components/forms/CopyPastePasswordFormRow';
import { useDb } from '@/context/DbContext';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useVaultMutate } from '@/hooks/useVaultMutate';

import type { ItemRef } from '@aliasvault/client/database/ItemRef';
import type { FieldHistory } from '@aliasvault/models/vault';

type FieldHistoryModalProps = {
  item: ItemRef;
  fieldKey: string;
  fieldLabel: string;
  isHidden: boolean;
  onClose: () => void;
};

/**
 * The values in a history snapshot, or the raw snapshot when it is not a JSON list.
 */
const parseValueSnapshot = (snapshot: string): string[] => {
  try {
    const values: unknown = JSON.parse(snapshot);
    return Array.isArray(values) ? values.map(String) : [snapshot];
  } catch {
    return [snapshot];
  }
};

/**
 * "MMM d, yyyy h:mm tt".
 */
const formatDate = (value: string): string => new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * Modal listing the past values of a field.
 */
const FieldHistoryModal: React.FC<FieldHistoryModalProps> = ({ item, fieldKey, fieldLabel, isHidden, onClose }) => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const { executeVaultMutationAsync } = useVaultMutate();
  const [isLoading, setIsLoading] = useState(true);
  const [records, setRecords] = useState<FieldHistory[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useClickOutside([panelRef], onClose, true);

  /**
   * Load the history records.
   */
  const loadHistory = useCallback((): void => {
    setIsLoading(true);
    setRecords(dbContext.sqliteClient?.items.getFieldHistory({ Id: item.Id, ManifestId: item.ManifestId }, fieldKey) ?? []);
    setIsLoading(false);
  }, [dbContext.sqliteClient, fieldKey, item.Id, item.ManifestId]);

  useEffect(() => loadHistory(), [loadHistory]);

  useEffect(() => {
    /**
     * Escape and Enter close the modal.
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === 'Enter') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return (): void => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  /**
   * Delete a history record and sync.
   */
  const deleteRecord = async (historyId: string): Promise<void> => {
    await executeVaultMutationAsync(async () => {
      await dbContext.sqliteClient?.items.deleteFieldHistory(historyId, item.ManifestId);
    });
    setConfirmDeleteId(null);
    loadHistory();
  };

  return (
    <div className="modal-dialog fixed inset-0 z-50 overflow-auto bg-gray-500 bg-opacity-75 flex items-center justify-center">
      <div ref={panelRef} id="fieldHistoryModal" className="relative bg-white dark:bg-gray-800 w-full max-w-2xl flex flex-col rounded-lg shadow-xl max-h-[90vh] border-2 border-gray-300 dark:border-gray-600">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              {t('components.fields.fieldHistoryModal.HistoryTitle')} - {fieldLabel}
            </h2>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300" title={t('sharedResources.Close')} aria-label={t('sharedResources.Close')}>
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex justify-center items-center py-8">
              <svg className="animate-spin h-8 w-8 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
          ) : records.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-center py-8">{t('components.fields.fieldHistoryModal.NoHistoryAvailable')}</p>
          ) : (
            <div className="space-y-4">
              {records.map((record) => {
                const values = parseValueSnapshot(record.ValueSnapshot);
                return (
                  <div key={record.Id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm text-gray-500 dark:text-gray-400">{formatDate(record.ChangedAt)}</div>
                      {confirmDeleteId === record.Id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 dark:text-gray-400">{t('components.fields.fieldHistoryModal.DeleteConfirm')}</span>
                          <button type="button" onClick={() => void deleteRecord(record.Id)} className="text-xs px-2 py-1 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium">
                            {t('sharedResources.Confirm')}
                          </button>
                          <button type="button" onClick={() => setConfirmDeleteId(null)} className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                            {t('sharedResources.Cancel')}
                          </button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => setConfirmDeleteId(record.Id)} className="text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 transition-colors" title={t('sharedResources.Delete')}>
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                          </svg>
                        </button>
                      )}
                    </div>
                    {values.map((value, index) => (
                      <div key={index} className="mb-2 last:mb-0">
                        {isHidden
                          ? <CopyPastePasswordFormRow id={`history-${record.Id}-${index}`} label="" value={value} />
                          : <CopyPasteFormRow id={`history-${record.Id}-${index}`} label="" value={value} />}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default FieldHistoryModal;
