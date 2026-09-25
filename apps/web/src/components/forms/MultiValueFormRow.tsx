import React from 'react';

import { EDIT_INPUT_CLASSES } from '@/components/forms/EditFormRow';

type MultiValueFormRowProps = {
  id: string;
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  onFocus?: (index: number, event: React.FocusEvent<HTMLInputElement>) => void;
  placeholder?: string;
};

/**
 * A list of text inputs for a multi-value field, with a plus button on the last one.
 */
const MultiValueFormRow: React.FC<MultiValueFormRowProps> = ({ id, label, values, onChange, onFocus, placeholder = '' }) => {
  const shown = values.length === 0 ? [''] : values;

  return (
    <>
      <label htmlFor={id} className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">{label}</label>
      <div className="space-y-2">
        {shown.map((value, index) => (
          <div key={index} className="relative">
            <input type="text" id={`${id}-${index}`} autoComplete="off" className={EDIT_INPUT_CLASSES} value={value} onChange={e => onChange(shown.map((v, i) => i === index ? e.target.value : v))} onFocus={e => onFocus?.(index, e)} placeholder={placeholder} autoCapitalize="off" autoCorrect="off" />
            {index === shown.length - 1 && (
              <button type="button" id={`add-${id}`} onClick={() => onChange([...shown, ''])} className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-primary-500 dark:hover:text-primary-400 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
};

export default MultiValueFormRow;
