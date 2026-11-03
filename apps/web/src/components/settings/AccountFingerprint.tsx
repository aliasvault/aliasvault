import { sharingText } from '@aliasvault/client/sharing/SharingView';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '@/components/shared/Icon';

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

/** How long the copy button shows that the code was copied. */
const COPIED_MS = 2000;

/**
 * The account's own fingerprint; clicking anywhere on it copies it. The fingerprint is not secret, so it is copied without the clipboard
 * clear timer that vault values get.
 */
const AccountFingerprint: React.FC<AccountFingerprintProps> = ({ code, id, className = '', variant = 'pill' }) => {
  const isSmall = variant === 'small';
  const { t } = useTranslation();
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    if (!isCopied) {
      return undefined;
    }

    const timer = setTimeout(() => setIsCopied(false), COPIED_MS);
    return (): void => clearTimeout(timer);
  }, [isCopied]);

  /**
   * Copy the code to the clipboard.
   */
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setIsCopied(true);
    } catch {
      // Clipboard access denied: the code stays visible to copy by hand.
    }
  };

  if (variant === 'bar') {
    return (
      <button
        type="button"
        onClick={() => void copy()}
        title={t('common.copyToClipboard')}
        className={`w-full flex items-center gap-3 rounded-lg pl-4 pr-2 py-2 text-left bg-primary-50 hover:bg-primary-100 dark:bg-primary-900/30 dark:hover:bg-primary-900/50 border border-primary-200 dark:border-primary-800 ${className}`}
      >
        <Icon name="shield-check" className="w-5 h-5 shrink-0 text-primary-500" />
        <span id={id} className="flex-1 min-w-0 font-mono text-base font-semibold tracking-wider whitespace-nowrap overflow-x-auto text-gray-900 dark:text-white">{code}</span>
        <span className="inline-flex shrink-0 items-center gap-1.5 px-3 py-1 text-sm font-medium text-primary-700 dark:text-primary-300">
          <Icon name={isCopied ? 'check' : 'duplicate'} className="w-4 h-4" />
          {isCopied && t('common.copiedShort')}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={t('common.copyToClipboard')}
      className={`inline-flex flex-wrap items-center rounded-full text-left bg-primary-50 hover:bg-primary-100 dark:bg-primary-900/30 dark:hover:bg-primary-900/50 border border-primary-200 dark:border-primary-800 ${isSmall ? 'gap-x-2 gap-y-0.5 pl-3 pr-1 py-1' : 'gap-x-3 gap-y-1 pl-4 pr-1.5 py-1.5'} ${className}`}
    >
      <Icon name="shield-check" className={`${isSmall ? 'w-4 h-4' : 'w-5 h-5'} shrink-0 text-primary-500`} />
      <span className={`${isSmall ? 'text-xs' : 'text-sm'} text-gray-700 dark:text-gray-300`}>{sharingText.yourFingerprint}</span>
      <span id={id} className={`font-mono ${isSmall ? 'text-sm' : 'text-base'} font-semibold tracking-wider whitespace-nowrap text-gray-900 dark:text-white`}>{code}</span>
      <span className={`inline-flex items-center gap-1.5 ${isSmall ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'} font-medium text-primary-700 dark:text-primary-300`}>
        <Icon name={isCopied ? 'check' : 'duplicate'} className={isSmall ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
        {isCopied && t('common.copiedShort')}
      </span>
    </button>
  );
};

export default AccountFingerprint;
