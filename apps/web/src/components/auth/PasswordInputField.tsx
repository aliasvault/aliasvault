import React, { forwardRef, useState } from 'react';

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
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path>
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
          </svg>
        )}
      </button>
    </div>
  );
});

PasswordInputField.displayName = 'PasswordInputField';

export default PasswordInputField;
