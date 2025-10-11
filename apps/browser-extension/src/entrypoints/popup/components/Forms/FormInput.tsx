import React, { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Button configuration for form input.
 */
type FormInputButton = {
  icon: string;
  onClick: () => void;
  title?: string;
}

/**
 * Icon component for form input buttons.
 */
const Icon: React.FC<{ name: string }> = ({ name }) => {
  switch (name) {
    case 'visibility':
      return (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      );
    case 'visibility-off':
      return (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      );
    case 'refresh':
      return (
        <>
          <path d="M23 4v6h-6" />
          <path d="M1 20v-6h6" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </>
      );
    case 'settings':
      return (
        <>
          <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </>
      );
    default:
      return null;
  }
};

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
  const allButtons = type === 'password'
    ? [...buttons, {
      icon: showPassword ? 'visibility-off' : 'visibility',
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
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <Icon name={button.icon} />
                </svg>
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