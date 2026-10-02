import React from 'react';

import FormLabel from '@/components/shared/FormLabel';
import Icon from '@/components/shared/Icon';
import { useClipboardCopy } from '@/hooks/useClipboardCopy';

import type { ItemRef } from '@aliasvault/client/database/ItemRef';

type CopyPasteFormRowProps = {
  id: string;
  label?: string | null;
  value: string;
  item?: ItemRef;
};

/**
 * Read-only value that copies to the clipboard on click.
 */
const CopyPasteFormRow: React.FC<CopyPasteFormRowProps> = ({ id, label = null, value, item }) => {
  const { copied, copyToClipboard } = useClipboardCopy(id, item);

  return (
    <>
      {label !== null && label !== '' && (
        <FormLabel htmlFor={id}>{label}</FormLabel>
      )}
      <div className="relative flex-grow">
        <input type="text" autoComplete="off" id={id} className={`outline-0 shadow-sm bg-gray-50 border ${copied ? 'border-green-500 border-2' : 'border-gray-300'} text-gray-900 sm:text-sm rounded-lg block w-full p-2.5 pr-10 dark:bg-gray-700 ${copied ? 'dark:border-green-500' : 'dark:border-gray-600'} dark:placeholder-gray-400 dark:text-white`} value={value} onClick={() => void copyToClipboard(value)} readOnly />
        {copied && (
          <span className="absolute inset-y-0 right-0 flex items-center pr-3 text-green-500 dark:text-green-400">
            <Icon name="clipboard" className="w-5 h-5" />
          </span>
        )}
      </div>
    </>
  );
};

export default CopyPasteFormRow;
