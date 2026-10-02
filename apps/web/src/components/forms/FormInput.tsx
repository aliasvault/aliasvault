import React from 'react';

type FormInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'className'> & {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  multiline?: boolean;
  attached?: 'none' | 'right';
  trailingSpace?: 'none' | 'sm' | 'lg';
};

/**
 * Text input (or textarea) of the item form.
 */
const FormInput: React.FC<FormInputProps> = ({ id, value, onValueChange, multiline = false, attached = 'none', trailingSpace = 'sm', ...rest }) => {
  const padding = trailingSpace === 'lg' ? 'pr-16' : trailingSpace === 'sm' ? 'pr-10' : '';
  const className = `outline-0 shadow-sm bg-gray-50 border border-gray-300 text-gray-900 sm:text-sm ${attached === 'right' ? 'rounded-l-lg' : 'rounded-lg'} block w-full p-2.5 ${padding} dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white`;

  if (multiline) {
    return <textarea id={id} style={{ height: '200px' }} className={className} value={value} onChange={e => onValueChange(e.target.value)} placeholder={rest.placeholder} autoCapitalize="off" autoCorrect="off" />;
  }
  return <input type="text" id={id} autoComplete="off" autoCapitalize="off" autoCorrect="off" className={className} value={value} onChange={e => onValueChange(e.target.value)} {...rest} />;
};

export default FormInput;
