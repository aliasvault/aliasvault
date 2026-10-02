import React, { forwardRef, useState } from 'react';

import Icon from '@/components/shared/Icon';

type PasswordInputFieldProps = {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
};

/**
 * Password input with a show/hide toggle.
 */
const PasswordInputField = forwardRef<HTMLInputElement, PasswordInputFieldProps>(({ id, value, onValueChange, placeholder = '', autoFocus = false }, ref) => {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="relative">
      <input
        ref={ref}
        id={id}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        type={showPassword ? 'text' : 'password'}
        placeholder={placeholder}
        autoComplete="off"
        autoFocus={autoFocus}
        className="bg-gray-50 border border-gray-300 text-gray-900 sm:text-sm rounded-lg focus:outline-none focus:ring-primary-500 focus:border-primary-500 block w-full p-2.5 pr-10 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-primary-500 dark:focus:border-primary-500"
      />
      <button
        type="button"
        onClick={() => setShowPassword(!showPassword)}
        className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        aria-label={showPassword ? 'Hide password' : 'Show password'}>
        {showPassword ? (
          <Icon name="eye-off" className="w-5 h-5" />
        ) : (
          <Icon name="eye" className="w-5 h-5" />
        )}
      </button>
    </div>
  );
});

PasswordInputField.displayName = 'PasswordInputField';

export default PasswordInputField;
