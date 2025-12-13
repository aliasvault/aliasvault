import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import LoadingSpinner from '@/entrypoints/popup/components/LoadingSpinner';
import { useDb } from '@/entrypoints/popup/context/DbContext';

import type { Passkey } from '@/utils/dist/core/models/vault';

import { PasskeyIcon } from './PasskeyBlock';

type PasskeyEditorProps = {
  itemId: string;
  passkeyIdsMarkedForDeletion: string[];
  onPasskeyMarkedForDeletion: (passkeyIds: string[]) => void;
}

/**
 * Edit passkey information for an item (supports marking for deletion).
 * Passkeys cannot be manually created or edited - only deleted.
 */
const PasskeyEditor: React.FC<PasskeyEditorProps> = ({
  itemId,
  passkeyIdsMarkedForDeletion,
  onPasskeyMarkedForDeletion
}) => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!dbContext?.sqliteClient || !itemId) {
      setLoading(false);
      return;
    }

    try {
      const itemPasskeys = dbContext.sqliteClient.getPasskeysByItemId(itemId);
      setPasskeys(itemPasskeys);
    } catch (err) {
      console.error('Error loading passkeys:', err);
    } finally {
      setLoading(false);
    }
  }, [dbContext?.sqliteClient, itemId]);

  /**
   * Mark a passkey for deletion.
   */
  const handleMarkForDeletion = (passkeyId: string): void => {
    if (!passkeyIdsMarkedForDeletion.includes(passkeyId)) {
      onPasskeyMarkedForDeletion([...passkeyIdsMarkedForDeletion, passkeyId]);
    }
  };

  /**
   * Undo marking a passkey for deletion.
   */
  const handleUndoDeletion = (passkeyId: string): void => {
    onPasskeyMarkedForDeletion(passkeyIdsMarkedForDeletion.filter(id => id !== passkeyId));
  };

  if (loading) {
    return (
      <div className="flex justify-center p-2">
        <LoadingSpinner />
      </div>
    );
  }

  if (passkeys.length === 0) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
      <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
        {t('passkeys.passkey')}
      </h2>
      <div className="space-y-3">
        {passkeys.map((passkey) => {
          const isMarkedForDeletion = passkeyIdsMarkedForDeletion.includes(passkey.Id);

          if (isMarkedForDeletion) {
            return (
              <div
                key={passkey.Id}
                className="p-3 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
              >
                <div className="flex items-start gap-2">
                  <PasskeyIcon className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-sm font-medium text-red-900 dark:text-red-100">
                        {t('passkeys.passkeyMarkedForDeletion')}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleUndoDeletion(passkey.Id)}
                        className="text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                        title={t('common.undo')}
                      >
                        <svg
                          className="w-4 h-4"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M3 7v6h6" />
                          <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" />
                        </svg>
                      </button>
                    </div>
                    <p className="text-xs text-red-800 dark:text-red-200">
                      {t('passkeys.passkeyWillBeDeleted')}
                    </p>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div
              key={passkey.Id}
              className="p-3 rounded bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700"
            >
              <div className="flex items-start gap-2">
                <PasskeyIcon className="w-5 h-5 text-gray-600 dark:text-gray-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {passkey.DisplayName || t('passkeys.passkey')}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleMarkForDeletion(passkey.Id)}
                      className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                      title={t('common.delete')}
                    >
                      <svg
                        className="w-4 h-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <line x1="10" y1="11" x2="10" y2="17" />
                        <line x1="14" y1="11" x2="14" y2="17" />
                      </svg>
                    </button>
                  </div>
                  <div className="space-y-1 mb-2">
                    {passkey.RpId && (
                      <div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {t('passkeys.site')}:{' '}
                        </span>
                        <span className="text-sm text-gray-900 dark:text-white">
                          {passkey.RpId}
                        </span>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    {t('passkeys.helpText')}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PasskeyEditor;
