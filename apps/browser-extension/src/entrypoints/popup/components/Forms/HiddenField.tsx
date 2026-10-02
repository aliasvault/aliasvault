import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '@/entrypoints/popup/components/Icons/Icon';

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
            <Icon name={showValue ? 'eye-off' : 'eye'} className="w-5 h-5" />
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
