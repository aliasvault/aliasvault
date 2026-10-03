import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '@/components/shared/Icon';
import Markdown from '@/components/shared/Markdown';
import Modal from '@/components/shared/Modal';

/**
 * The terms in a dialog, loaded from the Markdown version at `<termsUrl>.md`. Falls back to a link when that cannot be fetched.
 */
const TermsModal: React.FC<{ termsUrl: string; onClose: () => void }> = ({ termsUrl, onClose }) => {
  const { t } = useTranslation();
  const [terms, setTerms] = useState<string | null>(null);
  const [termsFailed, setTermsFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${termsUrl}.md`)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.text();
      })
      // The dialog has its own title, so the document's leading H1 is dropped.
      .then(text => !cancelled && setTerms(text.replace(/^\s*#\s[^\n]*\n/, '')))
      .catch((error: unknown) => {
        console.warn('Could not load the terms:', error);
        if (!cancelled) {
          setTermsFailed(true);
        }
      });
    return (): void => {
      cancelled = true;
    };
  }, [termsUrl]);

  useEffect(() => {
    /**
     * Escape closes the dialog.
     */
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return (): void => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return (
    <Modal id="terms-modal" zIndexClass="z-[1000]" panelClassName="w-full max-w-2xl flex flex-col max-h-[85vh]" onBackdropClick={onClose}>
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{t('auth.register.termsAndConditionsLink')}</h3>
        <div className="flex items-center gap-3">
          <a href={termsUrl} target="_blank" rel="noopener noreferrer" title={t('auth.register.termsAndConditionsLink')} className="text-gray-500 hover:text-primary-700 dark:text-gray-400 dark:hover:text-primary-400">
            <Icon name="external-link" className="w-5 h-5" />
          </a>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">
            <Icon name="x" className="w-6 h-6" />
          </button>
        </div>
      </div>
      <div className="p-4 overflow-y-auto">
        {termsFailed ? (
          <a href={termsUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-primary-700 dark:text-primary-400 hover:underline">
            {termsUrl}
            <Icon name="external-link" className="w-4 h-4" />
          </a>
        ) : terms === null ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">{t('common.loading')}</p>
        ) : (
          <Markdown content={terms} />
        )}
      </div>
      <div className="p-4 border-t border-gray-200 dark:border-gray-700">
        <button type="button" onClick={onClose} className="w-full py-2 px-4 bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-lg">
          {t('common.close')}
        </button>
      </div>
    </Modal>
  );
};

export default TermsModal;
