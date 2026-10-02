import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import CopyPasteFormRow from '@/components/forms/CopyPasteFormRow';
import CopyPastePasswordFormRow from '@/components/forms/CopyPastePasswordFormRow';
import Icon from '@/components/shared/Icon';
import Modal from '@/components/shared/Modal';
import Text from '@/components/shared/Text';
import { useDb } from '@/context/DbContext';
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
  const { executeVaultMutationInBackground } = useVaultMutate();
  const [isLoading, setIsLoading] = useState(true);
  const [records, setRecords] = useState<FieldHistory[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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
    await executeVaultMutationInBackground(async () => {
      await dbContext.sqliteClient?.items.deleteFieldHistory(historyId, item.ManifestId);
    });
    setConfirmDeleteId(null);
    loadHistory();
  };

  return (
    <Modal id="fieldHistoryModal" onBackdropClick={onClose} panelClassName="w-full max-w-2xl flex flex-col max-h-[90vh]">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            {t('items.history')} - {fieldLabel}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300" title={t('common.close')} aria-label={t('common.close')}>
            <Icon name="x" className="h-6 w-6" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex justify-center items-center py-8">
            <Icon name="spinner" className="animate-spin h-8 w-8 text-gray-500" />
          </div>
        ) : records.length === 0 ? (
          <Text variant="muted" className="text-center py-8">{t('items.noHistoryAvailable')}</Text>
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
                        <span className="text-sm text-gray-500 dark:text-gray-400">{t('items.fieldHistory.deleteConfirm')}</span>
                        <button type="button" onClick={() => void deleteRecord(record.Id)} className="text-sm px-2 py-1 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium">
                          {t('common.confirm')}
                        </button>
                        <button type="button" onClick={() => setConfirmDeleteId(null)} className="text-sm px-2 py-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                          {t('common.cancel')}
                        </button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setConfirmDeleteId(record.Id)} className="text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 transition-colors" title={t('common.delete')}>
                        <Icon name="trash" className="h-4 w-4" />
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

    </Modal>
  );
};

export default FieldHistoryModal;
