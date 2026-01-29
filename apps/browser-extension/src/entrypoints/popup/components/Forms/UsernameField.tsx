import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

interface IUsernameFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  onRegenerate: () => void;
}

/**
 * Username field component with regenerate functionality.
 */
const UsernameField: React.FC<IUsernameFieldProps> = ({
  id,
  label,
  value,
  onChange,
  placeholder,
  error,
  onRegenerate
}) => {
  const { t } = useTranslation();

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  }, [onChange]);

  const handleRegenerate = useCallback(() => {
    onRegenerate();
  }, [onRegenerate]);

  return (
    <div className="space-y-2">
      {/* Label */}
      <label htmlFor={id} className="block text-sm font-medium text-gray-900 dark:text-white">
        {label}
      </label>

      {/* Username Input with Button */}
      <div className="flex">
        <div className="relative flex-grow">
          <input
            type="text"
            id={id}
            value={value}
            onChange={handleInputChange}
            placeholder={placeholder}
            className="outline-0 text-sm shadow-sm bg-gray-50 border border-gray-300 text-gray-900 sm:text-sm rounded-l-lg block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
          />
        </div>
        <div className="flex">
          {/* Generate Username Button */}
          <button
            type="button"
            onClick={handleRegenerate}
            className="px-3 text-gray-500 dark:text-white bg-gray-200 hover:bg-gray-300 focus:ring-4 focus:outline-none focus:ring-gray-300 font-medium rounded-r-lg text-sm dark:bg-gray-600 dark:hover:bg-gray-700 dark:focus:ring-gray-800"
            title={t('common.generate')}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
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

export default UsernameField;