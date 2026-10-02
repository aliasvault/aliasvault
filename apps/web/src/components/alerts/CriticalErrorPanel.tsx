import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AlertMessageError from '@/components/alerts/AlertMessageError';
import SupportContact from '@/components/alerts/SupportContact';
import Button from '@/components/shared/Button';
import Icon from '@/components/shared/Icon';

type CriticalErrorPanelProps = {
  report?: string | null;
  title?: string;
  description?: string;
  onAction?: () => void;
  actionLabel?: string;
  hideSupportContact?: boolean;
  footer?: React.ReactNode;
};

/**
 * A blocking error that takes over the whole screen and shows the error details.
 */
const CriticalErrorPanel: React.FC<CriticalErrorPanelProps> = ({ report, title, description, onAction, actionLabel, hideSupportContact, footer }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [message, ...detailLines] = report?.split('\n') ?? [];
  const details = detailLines.join('\n').trim();

  /**
   * Copy the report and confirm it for a moment.
   */
  const copyReport = async (): Promise<void> => {
    if (!report) {
      return;
    }
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy the error report:', error);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6 py-8 overflow-y-auto bg-gray-100 dark:bg-gray-900">
      <div id="critical-error" className="relative p-6 sm:p-8 bg-white dark:bg-gray-700 rounded-lg sm:shadow-xl max-w-md w-full mx-auto">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{title ?? t('common.errors.vaultLoadErrorTitle')}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">{description ?? t('common.errors.vaultLoadError')}</p>

        {report && (
          <div id="critical-error-report">
            <AlertMessageError message={message} />
            {details && (
              <pre className="mt-3 max-h-48 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs text-gray-700 whitespace-pre-wrap break-all select-all dark:border-gray-600 dark:bg-gray-900/40 dark:text-gray-300">{details}</pre>
            )}
            <div className="mt-2 flex justify-end">
              <button type="button" id="copy-error-report" onClick={copyReport} className={`inline-flex items-center gap-1.5 text-sm font-medium hover:underline ${copied ? 'text-green-600 dark:text-green-400' : 'text-primary-700 dark:text-primary-500'}`}>
                <Icon name="clipboard" className="w-4 h-4" />
                {copied ? t('common.copiedShort') : t('app.vaultError.copyErrorDetails')}
              </button>
            </div>
          </div>
        )}

        {!hideSupportContact && <SupportContact report={report} className="mt-3" />}

        {onAction && (
          <Button id="critical-error-action" onClick={onAction} size="lg" additionalClasses="mt-6 w-full">{actionLabel ?? t('common.back')}</Button>
        )}
      </div>

      {footer && <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mt-6">{footer}</div>}
    </div>
  );
};

export default CriticalErrorPanel;
