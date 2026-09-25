import React, { forwardRef } from 'react';

type InputTextFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
};

/**
 * Text input with the auth form styling.
 */
const InputTextField = forwardRef<HTMLInputElement, InputTextFieldProps>(({ id, value, onValueChange, ...rest }, ref) => (
  <input
    ref={ref}
    id={id}
    value={value}
    onChange={(e) => onValueChange(e.target.value)}
    className="bg-gray-50 border border-gray-300 text-gray-900 sm:text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-primary-500 dark:focus:border-primary-500"
    {...rest}
  />
));

InputTextField.displayName = 'InputTextField';

export default InputTextField;
