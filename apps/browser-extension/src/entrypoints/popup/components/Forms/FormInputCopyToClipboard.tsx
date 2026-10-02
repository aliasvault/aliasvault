import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '@/entrypoints/popup/components/Icons/Icon';
import { ClipboardCopyService } from '@/entrypoints/popup/utils/ClipboardCopyService';

import { logExpected } from '@/utils/Diagnostics';
import { sendMessage } from '@/utils/messaging/ExtensionMessaging';

/**
 * Form input copy to clipboard props.
 */
type FormInputCopyToClipboardProps = {
  id: string;
  label: string;
  value: string;
  type?: 'text' | 'password';
  labelSuffix?: React.ReactNode;
  /** The item this field belongs to. Copying it counts as a use; omit where the value has no item. */
  itemId?: string;
  manifestId?: string;
}

const clipboardService = new ClipboardCopyService();

/**
 * Form input copy to clipboard component.
 */
export const FormInputCopyToClipboard: React.FC<FormInputCopyToClipboardProps> = ({
  id,
  label,
  value,
  type = 'text',
  labelSuffix,
  itemId,
  manifestId
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
      await sendMessage('CLIPBOARD_COPIED');

      // Record the use against the item this field belongs to, where one is known.
      if (itemId && manifestId) {
        sendMessage('RECORD_ITEM_USAGE', { itemId, manifestId, action: 'copy' }).catch(() => {
          // Ignore errors
        });
      }

      // Reset copied state after 2 seconds
      setTimeout(() => {
        if (clipboardService.getCopiedId() === id) {
          clipboardService.setCopied('');
        }
      }, 2000);
    } catch (err) {
      logExpected('[Clipboard] Copying the value failed', err);
    }
  };

  const isRevealedPassword = type === 'password' && showPassword;

  return (
    <div>
      <label htmlFor={id} className="block mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
        {labelSuffix}
      </label>
      <div className="relative">
        {isRevealedPassword ? (
          /* Revealed passwords are rendered as wrapping text so long values stay fully readable instead of being truncated. */
          <div
            id={id}
            onClick={copyToClipboard}
            className={`w-full pl-3 py-2.5 pr-16 bg-white border ${
              copied ? 'border-green-500 border-2' : 'border-gray-300'
            } text-gray-900 text-sm rounded-lg shadow-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white break-all whitespace-pre-wrap cursor-pointer min-h-[42px]`}
          >
            {value}
          </div>
        ) : (
          <input
            type={type === 'password' ? 'password' : 'text'}
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
        )}
        <div className={`absolute right-2 flex items-center gap-2 ${isRevealedPassword ? 'top-2' : 'top-1/2 -translate-y-1/2'}`}>
          {copied ? (
            <button
              type="button"
              className="p-1 text-green-500 dark:text-green-400 transition-colors duration-200"
              title={t('common.copiedShort')}
            >
              <Icon name="check" className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={copyToClipboard}
              className="p-1 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors duration-200"
              title={t('common.copyToClipboard')}
            >
              <Icon name="duplicate" className="w-4 h-4" />
            </button>
          )}
          {type === 'password' && (
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="p-1 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors duration-200"
              title={showPassword ? t('common.hidePassword') : t('common.showPassword')}
            >
              <Icon name={showPassword ? 'eye-off' : 'eye'} className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};