import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppInfo } from '@/utils/AppInfo';
import { VaultProcessingError } from '@/utils/types/errors/VaultProcessingError';

/**
 * Vault error report props.
 */
type VaultErrorReportProps = {
  /** The vault-processing error to surface (its message + stack drive the copyable report). */
  error: VaultProcessingError;
};

/**
 * Renders a vault-processing error with an expandable technical-details section and a copy-to-clipboard button.
 *
 * Mirrors the mobile app's vault-error screen: the underlying failure (decrypt/materialize/format mismatch) is a
 * client-side problem that a generic "server unreachable" message hides, so we show the real error and let the
 * user copy a support-ready report (source, versions, message, stack trace).
 */
const VaultErrorReport: React.FC<VaultErrorReportProps> = ({ error }) => {
  const { t } = useTranslation();
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  /**
   * Build the plain-text, support-ready error report copied to the clipboard.
   */
  const buildErrorReport = (): string => {
    return [
      `Source: ${error.source}`,
      `Extension: ${AppInfo.VERSION}`,
      `Browser: ${navigator.userAgent}`,
      `Error: ${error.message || t('common.errors.unknownError')}`,
      '',
      'Stack trace:',
      error.stack ?? 'No stack trace available',
    ].join('\n');
  };

  /**
   * Copy the error report to the clipboard and briefly flip the button to a "copied" state.
   */
  const copyErrorReport = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(buildErrorReport());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy error report:', err);
    }
  };

  return (
    <div className="mb-4 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/30 p-3">
      <p className="text-sm text-red-700 dark:text-red-300">
        {t('common.errors.vaultLoadError')}
      </p>
      <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400 break-words">
        {error.message || t('common.errors.unknownError')}
      </p>

      <button
        type="button"
        onClick={() => setShowDetails(!showDetails)}
        className="mt-2 text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 focus:outline-none"
      >
        {showDetails ? t('common.hideDetails') : t('common.showDetails')}
      </button>

      {showDetails && (
        <>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-red-100 dark:bg-gray-900 p-2 text-[11px] leading-snug text-red-900 dark:text-red-200 select-text">
            {buildErrorReport()}
          </pre>
          <button
            type="button"
            onClick={copyErrorReport}
            className={`mt-2 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white focus:outline-none focus:ring-2 focus:ring-offset-1 ${
              copied
                ? 'bg-green-600 hover:bg-green-600 focus:ring-green-500'
                : 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
            }`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {copied ? (
                <polyline points="20 6 9 17 4 12" />
              ) : (
                <>
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </>
              )}
            </svg>
            {copied ? t('common.copied') : t('common.copyToClipboard')}
          </button>
        </>
      )}
    </div>
  );
};

export default VaultErrorReport;
