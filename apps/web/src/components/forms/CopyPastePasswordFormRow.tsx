import React, { useState } from 'react';

import FormLabel from '@/components/shared/FormLabel';
import Icon from '@/components/shared/Icon';
import { useClipboardCopy } from '@/hooks/useClipboardCopy';

import type { ItemRef } from '@aliasvault/client/database/ItemRef';

type CopyPastePasswordFormRowProps = {
  id: string;
  label?: string;
  value: string;
  item?: ItemRef;
};

/**
 * Read-only masked value that copies to the clipboard on click, with a show/hide toggle.
 */
const CopyPastePasswordFormRow: React.FC<CopyPastePasswordFormRowProps> = ({ id, label = '', value, item }) => {
  const { copied, copyToClipboard } = useClipboardCopy(id, item);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const borderClasses = `${copied ? 'border-green-500 border-2' : 'border-gray-300'} ${copied ? 'dark:border-green-500' : 'dark:border-gray-600'}`;

  return (
    <>
      {label !== '' && <FormLabel htmlFor={id}>{label}</FormLabel>}
      <div className="relative">
        {isPasswordVisible ? (
          <div id={id} className={`outline-0 shadow-sm bg-gray-50 border ${borderClasses} text-gray-900 sm:text-sm rounded-lg block w-full p-2.5 pr-20 min-h-[42px] break-all cursor-pointer dark:bg-gray-700 dark:text-white`} onClick={() => void copyToClipboard(value)}>{value}</div>
        ) : (
          <input type="password" id={id} className={`outline-0 shadow-sm bg-gray-50 border ${borderClasses} text-gray-900 sm:text-sm rounded-lg block w-full p-2.5 pr-20 dark:bg-gray-700 dark:placeholder-gray-400 dark:text-white`} value={value} onClick={() => void copyToClipboard(value)} readOnly />
        )}
        <button type="button" className="absolute inset-y-1 right-1 flex items-center justify-center w-10 h-8 text-gray-500 bg-gray-200 rounded-md shadow-sm hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors duration-200 dark:bg-gray-600 dark:hover:bg-gray-500 dark:text-gray-300" onClick={() => setIsPasswordVisible(v => !v)}>
          <Icon name={isPasswordVisible ? 'eye' : 'eye-off'} className="w-5 h-5" />
        </button>
        {copied && (
          <span className="absolute top-1 h-8 right-10 flex items-center pr-3 text-green-500 dark:text-green-400">
            <Icon name="clipboard" className="w-5 h-5" />
          </span>
        )}
      </div>
    </>
  );
};

export default CopyPastePasswordFormRow;
