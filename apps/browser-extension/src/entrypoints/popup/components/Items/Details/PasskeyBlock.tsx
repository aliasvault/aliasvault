import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import LoadingSpinner from '@/entrypoints/popup/components/LoadingSpinner';
import { useDb } from '@/entrypoints/popup/context/DbContext';

import type { Passkey } from '@/utils/dist/core/models/vault';

type PasskeyBlockProps = {
  itemId: string;
}

/**
 * Passkey icon component.
 */
const PasskeyIcon: React.FC<{ className?: string }> = ({ className = "w-5 h-5" }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </svg>
);

/**
 * Display passkey information for an item in view mode.
 */
const PasskeyBlock: React.FC<PasskeyBlockProps> = ({ itemId }) => {
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
      const itemPasskeys = dbContext.sqliteClient.passkeys.getByItemId(itemId);
      setPasskeys(itemPasskeys);
    } catch (err) {
      console.error('Error loading passkeys:', err);
    } finally {
      setLoading(false);
    }
  }, [dbContext?.sqliteClient, itemId]);

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
    <div className="space-y-2">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
        {t('passkeys.passkey')}
      </h2>
      {passkeys.map((passkey) => (
        <div
          key={passkey.Id}
          className="p-3 rounded bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700"
        >
          <div className="flex items-start gap-2">
            <PasskeyIcon className="w-5 h-5 text-gray-600 dark:text-gray-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="mb-1">
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {passkey.DisplayName || t('passkeys.passkey')}
                </span>
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
      ))}
    </div>
  );
};

export default PasskeyBlock;
export { PasskeyIcon };
