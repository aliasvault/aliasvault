import React, { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '@/entrypoints/popup/components/Icons/Icon';

import type { UiIconName } from '@aliasvault/models/icons';

/**
 * Button configuration for form input.
 */
type FormInputButton = {
  icon: UiIconName;
  onClick: () => void;
  title?: string;
}

/**
 * Form input props.
 */
type FormInputProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password';
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  multiline?: boolean;
  rows?: number;
  error?: string;
  buttons?: FormInputButton[];
  showPassword?: boolean;
  onShowPasswordChange?: (show: boolean) => void;
}

/**
 * Form input component.
 */
export const FormInput = forwardRef<HTMLInputElement, FormInputProps>(({
  id,
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required = false,
  autoComplete,
  multiline = false,
  rows = 1,
  error,
  buttons = [],
  showPassword: controlledShowPassword,
  onShowPasswordChange
}, ref) => {
  const { t } = useTranslation();
  const [internalShowPassword, setInternalShowPassword] = React.useState(false);

  /**
   * Use controlled or uncontrolled showPassword state.
   * If controlledShowPassword is provided, use that value and call onShowPasswordChange.
   * Otherwise, use internal state.
   */
  const showPassword = controlledShowPassword !== undefined ? controlledShowPassword : internalShowPassword;

  /**
   * Set the showPassword state.
   * If controlledShowPassword is provided, use that value and call onShowPasswordChange.
   * Otherwise, use internal state.
   */
  const setShowPassword = (value: boolean): void => {
    if (controlledShowPassword !== undefined) {
      onShowPasswordChange?.(value);
    } else {
      setInternalShowPassword(value);
    }
  };

  const inputClasses = `mt-1 block text-sm w-full rounded-md ${
    error ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
  } text-gray-900 sm:text-sm rounded-lg shadow-sm border focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400 py-2 px-3`;

  // Add password visibility button if type is password
  const allButtons: FormInputButton[] = type === 'password'
    ? [...buttons, {
      icon: showPassword ? 'eye-off' : 'eye',
      /**
       * Toggle password visibility.
       */
      onClick: (): void => setShowPassword(!showPassword),
      title: showPassword ? t('common.hidePassword') : t('common.showPassword')
    }]
    : buttons;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <div className="relative">
        {multiline ? (
          <textarea
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={rows}
            placeholder={placeholder}
            className={inputClasses}
          />
        ) : (
          <input
            ref={ref}
            type={type === 'password' && !showPassword ? 'password' : 'text'}
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            autoComplete={autoComplete}
            className={inputClasses}
          />
        )}
        {allButtons.length > 0 && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
            {allButtons.map((button, index) => (
              <button
                type="button"
                key={index}
                onClick={button.onClick}
                title={button.title}
                className="p-1 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors duration-200"
              >
                <Icon name={button.icon} className="w-4 h-4" />
              </button>
            ))}
          </div>
        )}
      </div>
      {error && (
        <p className="mt-1 text-sm text-red-500">{error}</p>
      )}
    </div>
  );
});

FormInput.displayName = 'FormInput';