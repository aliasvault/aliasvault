import { generateTotpCode, getTotpRemainingSeconds } from '@aliasvault/client/items/TotpUtility';
import { normalizeTotpPeriod, type TotpCode } from '@aliasvault/models/vault';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClipboardCopy } from '@/hooks/useClipboardCopy';

type TotpViewerProps = {
  totpCodes: TotpCode[];
};

/**
 * The current code of a TOTP entry, or empty when the secret is unusable.
 */
const codeOf = (totpCode: TotpCode): string => generateTotpCode(totpCode.SecretKey, totpCode) ?? '';

/**
 * A single TOTP row with its countdown.
 */
const TotpRow: React.FC<{ totpCode: TotpCode; tick: number }> = ({ totpCode, tick }) => {
  const { t } = useTranslation();
  const { copied, copyToClipboard } = useClipboardCopy(totpCode.Id);
  const code = codeOf(totpCode);
  const period = normalizeTotpPeriod(totpCode.Period);
  const remaining = getTotpRemainingSeconds(totpCode);
  const percentage = Math.floor(((period - remaining) / period) * 100);
  void tick;

  return (
    <button type="button" onClick={() => void copyToClipboard(code)} className="group w-full text-left p-2 ps-3 pe-3 bg-gray-50 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors dark:bg-gray-700 dark:border-gray-600 dark:hover:bg-gray-600">
      <div className="flex justify-between items-center gap-2">
        <div className="flex items-center flex-1">
          <span className="text-sm font-medium text-gray-900 dark:text-white">{totpCode.Name.length > 0 ? totpCode.Name : t('sharedResources.TotpDefaultName')}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex flex-col items-end">
            <div className="totp-code text-lg font-bold text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
              {code}
            </div>
            <div className="text-xs">
              {copied
                ? <span className="text-green-600 dark:text-green-400">{t('components.main.components.totpCodes.totpViewer.CopiedMessage')}</span>
                : <span className="text-gray-500 dark:text-gray-400">{remaining}s</span>}
            </div>
          </div>
          <div className="w-1.5 h-8 bg-gray-200 rounded-full dark:bg-gray-600">
            <div className="bg-blue-600 rounded-full transition-all" style={{ height: `${percentage}%`, width: '100%' }}></div>
          </div>
        </div>
      </div>
    </button>
  );
};

/**
 * Shows the live two-factor codes of an item.
 */
const TotpViewer: React.FC<TotpViewerProps> = ({ totpCodes }) => {
  const { t } = useTranslation();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick(v => v + 1), 1000);
    return (): void => clearInterval(timer);
  }, []);

  return (
    <div className="p-4 mb-4 bg-white border border-gray-200 rounded-lg shadow-sm 2xl:col-span-2 dark:border-gray-700 sm:p-6 dark:bg-gray-800">
      <div className="flex justify-between">
        <div>
          <h3 className="mb-4 text-xl font-semibold dark:text-white">{t('components.main.components.totpCodes.totpViewer.TwoFactorAuthenticationTitle')}</h3>
        </div>
      </div>

      {totpCodes.length === 0 ? (
        <div className="flex flex-col justify-center">
          <p className="text-gray-500 dark:text-gray-400">{t('components.main.components.totpCodes.totpViewer.NoTotpCodesMessage')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 mt-4">
          {totpCodes.map(totpCode => <TotpRow key={totpCode.Id} totpCode={totpCode} tick={tick} />)}
        </div>
      )}
    </div>
  );
};

export default TotpViewer;
