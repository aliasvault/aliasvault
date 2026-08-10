import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useDb } from '@/entrypoints/popup/context/DbContext';

import type { TotpCode } from '@/utils/dist/core/models/vault';
import { sendMessage } from '@/utils/messaging/ExtensionMessaging';
import { generateTotpCode, getTotpElapsedPercentage, getTotpRemainingSeconds } from '@/utils/TotpUtility';

/**
 * Formats a TOTP code with a space in the middle for better readability, e.g. "XXX XXX" or "XXXX XXXX".
 */
const formatTotpCode = (code: string | undefined): string => {
  if (!code) {
    return '';
  }
  if (code.length % 2 === 0) {
    const half = code.length / 2;
    return `${code.slice(0, half)} ${code.slice(half)}`;
  }
  return code;
};

type TotpBlockProps = {
  itemId: string;
}

/**
 * This component shows TOTP codes for an item.
 */
const TotpBlock: React.FC<TotpBlockProps> = ({ itemId }) => {
  const { t } = useTranslation();
  const [totpCodes, setTotpCodes] = useState<TotpCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentCodes, setCurrentCodes] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const dbContext = useDb();

  /**
   * Copies a TOTP code to the clipboard.
   */
  const copyToClipboard = async (code: string, id: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(id);
      
      // Notify background script that clipboard was copied
      await sendMessage('CLIPBOARD_COPIED');

      /*
       * Record the use against the item. The auto-copy that follows an autofill deliberately does not go
       * through here: that interaction is already counted as an autofill, and would otherwise count twice.
       */
      sendMessage('RECORD_ITEM_USAGE', { itemId, action: 'copy' }).catch(() => {
        // Ignore errors
      });

      // Reset copied state after 2 seconds
      setTimeout(() => {
        setCopiedId(null);
      }, 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  useEffect(() => {
    /**
     * Loads the TOTP codes for the item.
     */
    const loadTotpCodes = async (): Promise<void> => {
      if (!dbContext?.sqliteClient || !itemId) {
        return;
      }

      try {
        const codes = dbContext.sqliteClient.items.getTotpCodesForItem(itemId);
        setTotpCodes(codes);
      } catch (error) {
        console.error('Error loading TOTP codes:', error);
      } finally {
        setLoading(false);
      }
    };

    loadTotpCodes();
  }, [itemId, dbContext?.sqliteClient]);

  useEffect(() => {
    /**
     * Updates the current TOTP codes.
     */
    const updateTotpCodes = (prevCodes: Record<string, string>): Record<string, string> => {
      const newCodes: Record<string, string> = {};
      totpCodes.forEach(code => {
        // Keep the previous code when generation fails, so a single bad tick doesn't blank the display.
        newCodes[code.Id] = generateTotpCode(code.SecretKey, code) ?? prevCodes[code.Id] ?? 'Error';
      });
      return newCodes;
    };

    // Generate initial codes
    const initialCodes: Record<string, string> = {};
    totpCodes.forEach(code => {
      initialCodes[code.Id] = generateTotpCode(code.SecretKey, code) ?? 'Error';
    });
    setCurrentCodes(initialCodes);

    // Set up interval to refresh codes
    const intervalId = setInterval(() => {
      setCurrentCodes(updateTotpCodes);
    }, 1000);

    // Clean up interval on unmount or when totpCodes change
    return () : void => {
      clearInterval(intervalId);
    };
  }, [totpCodes]);

  if (loading) {
    return (
      <div className="text-gray-500 dark:text-gray-400 mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">{t('common.twoFactorAuthentication')}</h2>
        {t('common.loadingTotpCodes')}
      </div>
    );
  }

  if (totpCodes.length === 0) {
    return null;
  }

  return (
    <div className="mb-4">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('common.twoFactorAuthentication')}</h2>
        <div className="grid grid-cols-1 gap-2">
          {totpCodes.map(totpCode => (
            <button
              key={totpCode.Id}
              className={`w-full text-left p-2 ps-3 pe-3 rounded bg-white dark:bg-gray-800 shadow hover:shadow-md transition-all border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700`}
              onClick={() => copyToClipboard(currentCodes[totpCode.Id], totpCode.Id)}
              aria-label={`Copy ${totpCode.Name || t('totp.defaultName')} code`}
            >
              <div className="flex justify-between items-center gap-2">
                <div className="flex items-center flex-1">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white">{totpCode.Name || t('totp.defaultName')}</h4>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex flex-col items-end">
                    <span className="text-lg font-bold text-gray-900 dark:text-white">
                      {formatTotpCode(currentCodes[totpCode.Id])}
                    </span>
                    <div className="text-xs">
                      {copiedId === totpCode.Id ? (
                        <span className="text-green-600 dark:text-green-400">{t('common.copied')}</span>
                      ) : (
                        <span className="text-gray-500 dark:text-gray-400">{getTotpRemainingSeconds(totpCode)}s</span>
                      )}
                    </div>
                  </div>
                  <div className="w-1 h-6 bg-gray-200 rounded-full dark:bg-gray-600">
                    <div
                      className="bg-blue-600 rounded-full transition-all"
                      style={{ height: `${getTotpElapsedPercentage(totpCode)}%`, width: '100%' }}
                    />
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default TotpBlock;