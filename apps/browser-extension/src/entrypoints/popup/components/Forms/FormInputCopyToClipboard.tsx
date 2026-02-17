import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { sendMessage } from 'webext-bridge/popup';

import { ClipboardCopyService } from '@/entrypoints/popup/utils/ClipboardCopyService';

/**
 * Form input copy to clipboard props.
 */
type FormInputCopyToClipboardProps = {
  id: string;
  label: string;
  value: string;
  type?: 'text' | 'password';
  labelSuffix?: React.ReactNode;
}

const clipboardService = new ClipboardCopyService();

/**
 * Icon component for form input buttons.
 */
const Icon: React.FC<{ name: string }> = ({ name }) => {
  switch (name) {
    case 'visibility':
      return (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      );
    case 'visibility-off':
      return (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      );
    case 'copy':
      return (
        <>
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </>
      );
    case 'check':
      return (
        <>
          <polyline points="20 6 9 17 4 12" />
        </>
      );
    default:
      return null;
  }
};

/**
 * Form input copy to clipboard component.
 */
export const FormInputCopyToClipboard: React.FC<FormInputCopyToClipboardProps> = ({
  id,
  label,
  value,
  type = 'text',
  labelSuffix
}) => {
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const unsubscribe = clipboardService.subscribe((copiedId) : void => {
      setCopied(copiedId === id);
    });
    return () : void => {
      unsubscribe();
    };
  }, [id]);

  /**
   * Copy to clipboard.
   */
  const copyToClipboard = async () : Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      clipboardService.setCopied(id);

      // Notify background script that clipboard was copied
      await sendMessage('CLIPBOARD_COPIED', { value }, 'background');

      // Reset copied state after 2 seconds
      setTimeout(() => {
        if (clipboardService.getCopiedId() === id) {
          clipboardService.setCopied('');
        }
      }, 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  return (
    <div>
      <label htmlFor={id} className="block mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
        {labelSuffix}
      </label>
      <div className="relative">
        <input
          type={type === 'password' && !showPassword ? 'password' : 'text'}
          id={id}
          readOnly
          value={value}
          onClick={copyToClipboard}
          className={`w-full pl-3 py-2.5 bg-white border ${
            copied ? 'border-green-500 border-2' : 'border-gray-300'
          } text-gray-900 text-sm rounded-lg shadow-sm focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400 truncate ${
            type === 'password' ? 'pr-16' : 'pr-10'
          }`}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
          {copied ? (
            <button
              type="button"
              className="p-1 text-green-500 dark:text-green-400 transition-colors duration-200"
              title={t('common.copied')}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <Icon name="check" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={copyToClipboard}
              className="p-1 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors duration-200"
              title={t('common.copyToClipboard')}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <Icon name="copy" />
              </svg>
            </button>
          )}
          {type === 'password' && (
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="p-1 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors duration-200"
              title={showPassword ? t('common.hidePassword') : t('common.showPassword')}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <Icon name={showPassword ? 'visibility-off' : 'visibility'} />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};