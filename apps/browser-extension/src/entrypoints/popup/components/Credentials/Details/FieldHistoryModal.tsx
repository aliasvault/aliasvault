import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { FormInputCopyToClipboard } from '@/entrypoints/popup/components/Forms/FormInputCopyToClipboard';
import { useDb } from '@/entrypoints/popup/context/DbContext';

import type { FieldHistory, FieldType } from '@/utils/dist/core/models/vault';

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
  const shouldMaskByDefault = isHidden || fieldType === 'Password' || fieldType === 'Hidden';

  useEffect(() => {
    if (!isOpen || !dbContext?.sqliteClient) {
      return;
    }

    try {
      setLoading(true);
      const historyRecords = dbContext.sqliteClient.getFieldHistory(itemId, fieldKey);
      setHistory(historyRecords);
    } catch (error) {
      console.error('Error loading field history:', error);
    } finally {
      setLoading(false);
    }
  }, [isOpen, dbContext?.sqliteClient, itemId, fieldKey]);

  if (!isOpen) {
    return null;
  }

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
   * Handle click on backdrop to close modal.
   */
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    // Only close if clicking directly on the backdrop/container, not the modal content
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black bg-opacity-80 transition-opacity" onClick={onClose} />

      {/* Modal container - clicking here (outside modal content) closes */}
      <div
        className="fixed inset-0 flex items-center justify-center p-4"
        onClick={handleBackdropClick}
      >
        <div className="relative transform overflow-hidden rounded-lg bg-white dark:bg-gray-800 px-4 pb-4 pt-5 text-left shadow-xl transition-all w-full max-w-2xl max-h-[80vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold leading-6 text-gray-900 dark:text-white">
              {fieldLabel} {t('credentials.history')}
            </h3>
            <button
              type="button"
              className="text-gray-400 hover:text-gray-500 focus:outline-none"
              onClick={onClose}
            >
              <span className="sr-only">{t('common.close')}</span>
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
              </div>
            ) : history.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                {t('credentials.noHistoryAvailable')}
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
          </div>
        </div>
      </div>
    </div>
  );
};

export default FieldHistoryModal;
