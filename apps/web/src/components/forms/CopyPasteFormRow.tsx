import React from 'react';

import { useClipboardCopy } from '@/hooks/useClipboardCopy';

type CopyPasteFormRowProps = {
  id: string;
  label?: string | null;
  value: string;
};

/**
 * Read-only value that copies to the clipboard on click.
 */
const CopyPasteFormRow: React.FC<CopyPasteFormRowProps> = ({ id, label = null, value }) => {
  const { copied, copyToClipboard } = useClipboardCopy(id);

  return (
    <>
      {label !== null && label !== '' && (
        <label htmlFor={id} className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">{label}</label>
      )}
      <div className="relative flex-grow">
        <input type="text" autoComplete="off" id={id} className={`outline-0 shadow-sm bg-gray-50 border ${copied ? 'border-green-500 border-2' : 'border-gray-300'} text-gray-900 sm:text-sm rounded-lg block w-full p-2.5 pr-10 dark:bg-gray-700 ${copied ? 'dark:border-green-500' : 'dark:border-gray-600'} dark:placeholder-gray-400 dark:text-white`} value={value} onClick={() => void copyToClipboard(value)} readOnly />
        {copied && (
          <span className="absolute inset-y-0 right-0 flex items-center pr-3 text-green-500 dark:text-green-400">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"></path>
              <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"></path>
            </svg>
          </span>
        )}
      </div>
    </>
  );
};

export default CopyPasteFormRow;
