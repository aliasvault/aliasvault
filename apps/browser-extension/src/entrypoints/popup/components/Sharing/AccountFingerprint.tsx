import { sharingText } from '@aliasvault/client/sharing/SharingView';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '@/entrypoints/popup/components/Icons/Icon';

/**
 * How the fingerprint is shown.
 */
export type AccountFingerprintVariant = 'pill' | 'small' | 'bar';

type AccountFingerprintProps = {
  code: string;
  id?: string;
  className?: string;
  variant?: AccountFingerprintVariant;
};

/**
 * The account's own fingerprint in a pill; clicking anywhere on it copies it.
 */
const AccountFingerprint: React.FC<AccountFingerprintProps> = ({ code, id, className = '', variant = 'pill' }) => {
  const isSmall = variant === 'small';
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 2000);
    return (): void => clearTimeout(timer);
  }, [copied]);

  /**
   * Copy the fingerprint. It is not secret, so it stays on the clipboard instead of going through the auto-clearing copy.
   */
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard access denied; the fingerprint stays visible to copy by hand.
    }
  };

  if (variant === 'bar') {
    return (
      <button type="button" onClick={() => void copy()} title={t('common.copyToClipboard')} className={`w-full flex items-center gap-2 rounded-lg pl-3 pr-1.5 py-1.5 text-left bg-primary-50 hover:bg-primary-100 dark:bg-primary-900/30 dark:hover:bg-primary-900/50 border border-primary-200 dark:border-primary-800 ${className}`}>
        <Icon name="shield-check" className="w-4 h-4 shrink-0 text-primary-500" />
        <span id={id} className="flex-1 min-w-0 font-mono text-sm font-semibold tracking-wider whitespace-nowrap overflow-x-auto text-gray-900 dark:text-white">{code}</span>
        <span className="inline-flex shrink-0 items-center gap-1 px-1.5 py-1 text-xs font-medium text-primary-600 dark:text-primary-400">
          <Icon name={copied ? 'check' : 'duplicate'} className="w-4 h-4" />
          {copied && t('common.copiedShort')}
        </span>
      </button>
    );
  }

  return (
    <button type="button" onClick={() => void copy()} title={t('common.copyToClipboard')} className={`inline-flex flex-wrap items-center rounded-full text-left bg-primary-50 hover:bg-primary-100 dark:bg-primary-900/30 dark:hover:bg-primary-900/50 border border-primary-200 dark:border-primary-800 ${isSmall ? 'gap-x-1.5 gap-y-0.5 pl-2.5 pr-1 py-0.5' : 'gap-x-2 gap-y-1 px-3 py-1.5'} ${className}`}>
      <Icon name="shield-check" className={`${isSmall ? 'w-3.5 h-3.5' : 'w-4 h-4'} shrink-0 text-primary-500`} />
      <span className="text-xs text-gray-700 dark:text-gray-300">{sharingText.yourFingerprint}</span>
      <span id={id} className={`font-mono ${isSmall ? 'text-xs' : 'text-sm'} font-semibold tracking-wider whitespace-nowrap text-gray-900 dark:text-white`}>{code}</span>
      <span className="inline-flex items-center gap-1 p-1 text-primary-600 dark:text-primary-400">
        <Icon name={copied ? 'check' : 'duplicate'} className={isSmall ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
        {copied && <span className="text-xs">{t('common.copiedShort')}</span>}
      </span>
    </button>
  );
};

export default AccountFingerprint;
