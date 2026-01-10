import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

interface IHiddenFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  showValue?: boolean;
  onShowValueChange?: (show: boolean) => void;
}

/**
 * Hidden field component with show/hide toggle (like password field but without generation).
 * Used for sensitive data that doesn't need password generation features.
 */
const HiddenField: React.FC<IHiddenFieldProps> = ({
  id,
  label,
  value,
  onChange,
  placeholder,
  error,
  showValue: controlledShowValue,
  onShowValueChange
}) => {
  const { t } = useTranslation();
  const [internalShowValue, setInternalShowValue] = useState(false);

  // Use controlled or uncontrolled showValue state
  const showValue = controlledShowValue !== undefined ? controlledShowValue : internalShowValue;

  /**
   * Set the showValue state.
   */
  const setShowValue = useCallback((show: boolean): void => {
    if (controlledShowValue !== undefined) {
      onShowValueChange?.(show);
    } else {
      setInternalShowValue(show);
    }
  }, [controlledShowValue, onShowValueChange]);

  const toggleValueVisibility = useCallback(() => {
    setShowValue(!showValue);
  }, [showValue, setShowValue]);

  return (
    <div className="space-y-2">
      {/* Label */}
      <label htmlFor={id} className="block text-sm font-medium text-gray-900 dark:text-white">
        {label}
      </label>

      {/* Hidden Input with Show/Hide Button */}
      <div className="flex">
        <div className="relative flex-grow">
          <input
            type={showValue ? 'text' : 'password'}
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="outline-0 text-sm shadow-sm border border-gray-300 bg-gray-50 text-gray-900 sm:text-sm rounded-l-lg block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
          />
        </div>
        <div className="flex">
          {/* Show/Hide Value Button */}
          <button
            type="button"
            onClick={toggleValueVisibility}
            className="px-3 text-gray-500 dark:text-white bg-gray-200 hover:bg-gray-300 focus:ring-4 focus:outline-none focus:ring-gray-300 font-medium rounded-r-lg text-sm dark:bg-gray-600 dark:hover:bg-gray-700 dark:focus:ring-gray-800"
            title={showValue ? t('common.hidePassword') : t('common.showPassword')}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {showValue ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              ) : (
                <>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
};

export default HiddenField;
