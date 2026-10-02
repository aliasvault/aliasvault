import React from 'react';

import FormInput from '@/components/forms/FormInput';
import FormLabel from '@/components/shared/FormLabel';
import Icon from '@/components/shared/Icon';

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
      <FormLabel htmlFor={id}>{label}</FormLabel>
      <div className="space-y-2">
        {shown.map((value, index) => (
          <div key={index} className="relative">
            <FormInput id={`${id}-${index}`} value={value} onValueChange={next => onChange(shown.map((v, i) => i === index ? next : v))} onFocus={e => onFocus?.(index, e)} placeholder={placeholder} />
            {index === shown.length - 1 && (
              <button type="button" id={`add-${id}`} onClick={() => onChange([...shown, ''])} className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-primary-500 dark:hover:text-primary-400 transition-colors">
                <Icon name="plus-sm" className="w-5 h-5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
};

export default MultiValueFormRow;
