import  * as OTPAuth from 'otpauth';
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { sendMessage } from 'webext-bridge/popup';

import { useDb } from '@/entrypoints/popup/context/DbContext';

import type { TotpCode } from '@/utils/dist/core/models/vault';

type TotpBlockProps = {
  credentialId?: string;
  itemId?: string;
}

/**
 * This component shows TOTP codes for a credential or item.
 */
const TotpBlock: React.FC<TotpBlockProps> = ({ credentialId, itemId }) => {
  const { t } = useTranslation();
  const [totpCodes, setTotpCodes] = useState<TotpCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentCodes, setCurrentCodes] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const dbContext = useDb();

  /**
   * Gets the remaining seconds for the TOTP code.
   */
  const getRemainingSeconds = (step = 30): number => {
    const totp = new OTPAuth.TOTP({
      secret: 'dummy', // We only need this for timing calculations
      algorithm: 'SHA1',
      digits: 6,
      period: step
    });
    return totp.period - (Math.floor(Date.now() / 1000) % totp.period);
  };

  /**
   * Gets the remaining percentage for the TOTP code.
   */
  const getRemainingPercentage = (): number => {
    const remaining = getRemainingSeconds();
    // Invert the percentage so it counts down instead of up
    return Math.floor(((30.0 - remaining) / 30.0) * 100);
  };

  /**
   * Generates a TOTP code for a given secret key.
   */
  const generateTotpCode = (secretKey: string): string => {
    try {
      const totp = new OTPAuth.TOTP({
        secret: secretKey,
        algorithm: 'SHA1',
        digits: 6,
        period: 30
      });
      return totp.generate();
    } catch (error) {
      console.error('Error generating TOTP code:', error);
      return 'Error';
    }
  };

  /**
   * Copies a TOTP code to the clipboard.
   */
  const copyToClipboard = async (code: string, id: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(id);
      
      // Notify background script that clipboard was copied
      await sendMessage('CLIPBOARD_COPIED', { value: code }, 'background');

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
     * Loads the TOTP codes for the credential or item.
     */
    const loadTotpCodes = async (): Promise<void> => {
      if (!dbContext?.sqliteClient) {
        return;
      }

      try {
        let codes: TotpCode[] = [];
        if (itemId) {
          codes = dbContext.sqliteClient.getTotpCodesForItem(itemId);
        } else if (credentialId) {
          codes = dbContext.sqliteClient.getTotpCodesForCredential(credentialId);
        }
        setTotpCodes(codes);
      } catch (error) {
        console.error('Error loading TOTP codes:', error);
      } finally {
        setLoading(false);
      }
    };

    loadTotpCodes();
  }, [credentialId, itemId, dbContext?.sqliteClient]);

  useEffect(() => {
    /**
     * Updates the current TOTP codes.
     */
    const updateTotpCodes = (prevCodes: Record<string, string>): Record<string, string> => {
      const newCodes: Record<string, string> = {};
      totpCodes.forEach(code => {
        const generatedCode = generateTotpCode(code.SecretKey);
        // Only update if we have a valid code
        if (generatedCode !== 'Error') {
          newCodes[code.Id] = generatedCode;
        } else {
        // Keep the previous code if there's an error
          newCodes[code.Id] = prevCodes[code.Id] ?? 'Error';
        }
      });
      return newCodes;
    };

    // Generate initial codes
    const initialCodes: Record<string, string> = {};
    totpCodes.forEach(code => {
      initialCodes[code.Id] = generateTotpCode(code.SecretKey);
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
              aria-label={`Copy ${totpCode.Name} code`}
            >
              <div className="flex justify-between items-center gap-2">
                <div className="flex items-center flex-1">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white">{totpCode.Name}</h4>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex flex-col items-end">
                    <span className="text-lg font-bold text-gray-900 dark:text-white">
                      {currentCodes[totpCode.Id]}
                    </span>
                    <div className="text-xs">
                      {copiedId === totpCode.Id ? (
                        <span className="text-green-600 dark:text-green-400">{t('common.copied')}</span>
                      ) : (
                        <span className="text-gray-500 dark:text-gray-400">{getRemainingSeconds()}s</span>
                      )}
                    </div>
                  </div>
                  <div className="w-1 h-6 bg-gray-200 rounded-full dark:bg-gray-600">
                    <div
                      className="bg-blue-600 rounded-full transition-all"
                      style={{ height: `${getRemainingPercentage()}%`, width: '100%' }}
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