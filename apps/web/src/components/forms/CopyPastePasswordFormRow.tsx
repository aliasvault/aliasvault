import React, { useState } from 'react';

import { useClipboardCopy } from '@/hooks/useClipboardCopy';

type CopyPastePasswordFormRowProps = {
  id: string;
  label?: string;
  value: string;
};

/**
 * Read-only masked value that copies to the clipboard on click, with a show/hide toggle.
 */
const CopyPastePasswordFormRow: React.FC<CopyPastePasswordFormRowProps> = ({ id, label = '', value }) => {
  const { copied, copyToClipboard } = useClipboardCopy(id);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const borderClasses = `${copied ? 'border-green-500 border-2' : 'border-gray-300'} ${copied ? 'dark:border-green-500' : 'dark:border-gray-600'}`;

  return (
    <>
      {label !== '' && <label htmlFor={id} className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">{label}</label>}
      <div className="relative">
        {isPasswordVisible ? (
          <div id={id} className={`outline-0 shadow-sm bg-gray-50 border ${borderClasses} text-gray-900 sm:text-sm rounded-lg block w-full p-2.5 pr-20 min-h-[42px] break-all cursor-pointer dark:bg-gray-700 dark:text-white`} onClick={() => void copyToClipboard(value)}>{value}</div>
        ) : (
          <input type="password" id={id} className={`outline-0 shadow-sm bg-gray-50 border ${borderClasses} text-gray-900 sm:text-sm rounded-lg block w-full p-2.5 pr-20 dark:bg-gray-700 dark:placeholder-gray-400 dark:text-white`} value={value} onClick={() => void copyToClipboard(value)} readOnly />
        )}
        <button type="button" className="absolute inset-y-1 right-1 flex items-center justify-center w-10 h-8 text-gray-500 bg-gray-200 rounded-md shadow-sm hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors duration-200 dark:bg-gray-600 dark:hover:bg-gray-500 dark:text-gray-300" onClick={() => setIsPasswordVisible(v => !v)}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            {isPasswordVisible ? (
              <>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
              </>
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path>
            )}
          </svg>
        </button>
        {copied && (
          <span className="absolute top-1 h-8 right-10 flex items-center pr-3 text-green-500 dark:text-green-400">
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

export default CopyPastePasswordFormRow;
