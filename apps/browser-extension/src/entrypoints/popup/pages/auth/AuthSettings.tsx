import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import * as Yup from 'yup';

import LanguageSwitcher from '@/entrypoints/popup/components/LanguageSwitcher';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';

import { AppInfo } from '@/utils/AppInfo';
import { GLOBAL_AUTOFILL_POPUP_ENABLED_KEY, DISABLED_SITES_KEY, VAULT_LOCKED_DISMISS_UNTIL_KEY } from '@/utils/Constants';

import { storage } from '#imports';

type ApiOption = {
  label: string;
  value: string;
};

const DEFAULT_OPTIONS: ApiOption[] = [
  { label: 'Aliasvault.net', value: AppInfo.DEFAULT_API_URL },
  { label: 'Self-hosted', value: 'custom' }
];

// Validation schema for URLs
/**
 * Creates a URL validation schema with localized error messages.
 */
const createUrlSchema = (t: (key: string) => string): Yup.ObjectSchema<{apiUrl: string; clientUrl: string}> => Yup.object().shape({
  apiUrl: Yup.string()
    .required(t('validation.apiUrlRequired'))
    .test('is-valid-api-url', t('settings.validation.apiUrlInvalid'), (value: string | undefined) => {
      if (!value) {
        return true; // Allow empty for non-custom option
      }
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    }),
  clientUrl: Yup.string()
    .required(t('validation.clientUrlRequired'))
    .test('is-valid-client-url', t('settings.validation.clientUrlInvalid'), (value: string | undefined) => {
      if (!value) {
        return true; // Allow empty for non-custom option
      }
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    })
});

/**
 * Auth settings page only shown when user is not logged in.
 */
const AuthSettings: React.FC = () => {
  const { t } = useTranslation();
  const [selectedOption, setSelectedOption] = useState<string>('');
  const [customUrl, setCustomUrl] = useState<string>('');
  const [customClientUrl, setCustomClientUrl] = useState<string>('');
  const [isGloballyEnabled, setIsGloballyEnabled] = useState<boolean>(true);
  const [errors, setErrors] = useState<{ apiUrl?: string; clientUrl?: string }>({});
  const { setIsInitialLoading } = useLoading();

  const urlSchema = createUrlSchema(t);

  useEffect(() => {
    /**
     * Load the stored settings from the storage.
     */
    const loadStoredSettings = async () : Promise<void> => {
      const apiUrl = await storage.getItem('local:apiUrl') as string;
      const clientUrl = await storage.getItem('local:clientUrl') as string;
      const globallyEnabled = await storage.getItem(GLOBAL_AUTOFILL_POPUP_ENABLED_KEY) !== false; // Default to true if not set
      const dismissUntil = await storage.getItem(VAULT_LOCKED_DISMISS_UNTIL_KEY) as number;

      if (dismissUntil) {
        setIsGloballyEnabled(false);
      } else {
        setIsGloballyEnabled(globallyEnabled);
      }

      const matchingOption = DEFAULT_OPTIONS.find(opt => opt.value === apiUrl);

      if (matchingOption) {
        setSelectedOption(matchingOption.value);
      } else if (apiUrl) {
        setSelectedOption('custom');
        setCustomUrl(apiUrl);
        setCustomClientUrl(clientUrl ?? '');
      } else {
        setSelectedOption(DEFAULT_OPTIONS[0].value);
      }
      setIsInitialLoading(false);
    };

    loadStoredSettings();
  }, [setIsInitialLoading]);

  /**
   * Handle option change
   */
  const handleOptionChange = async (e: React.ChangeEvent<HTMLSelectElement>) : Promise<void> => {
    const value = e.target.value;
    setSelectedOption(value);
    if (value !== 'custom') {
      await storage.setItem('local:apiUrl', '');
      await storage.setItem('local:clientUrl', '');
      setCustomUrl('');
      setCustomClientUrl('');
      setErrors({});
    }
  };

  /**
   * Handle custom API URL change
   */
  const handleCustomUrlChange = async (e: React.ChangeEvent<HTMLInputElement>) : Promise<void> => {
    const value = e.target.value;
    setCustomUrl(value);

    try {
      await urlSchema.validateAt('apiUrl', { apiUrl: value });
      setErrors(prev => ({ ...prev, apiUrl: undefined }));
      await storage.setItem('local:apiUrl', value);
    } catch (error: unknown) {
      if (error instanceof Yup.ValidationError) {
        setErrors(prev => ({ ...prev, apiUrl: error.message }));
        // On error we revert back to the aliasvault.net official hosted instance.
        await storage.setItem('local:apiUrl', AppInfo.DEFAULT_API_URL);
        await storage.setItem('local:clientUrl', AppInfo.DEFAULT_CLIENT_URL);
      }
    }
  };

  /**
   * Handle custom client URL change
   */
  const handleCustomClientUrlChange = async (e: React.ChangeEvent<HTMLInputElement>) : Promise<void> => {
    const value = e.target.value;
    setCustomClientUrl(value);

    try {
      await urlSchema.validateAt('clientUrl', { clientUrl: value });
      setErrors(prev => ({ ...prev, clientUrl: undefined }));
      await storage.setItem('local:clientUrl', value);
    } catch (error: unknown) {
      if (error instanceof Yup.ValidationError) {
        setErrors(prev => ({ ...prev, clientUrl: error.message }));
      }
    }
  };

  /**
   * Toggle global popup.
   */
  const toggleGlobalPopup = async () : Promise<void> => {
    const newGloballyEnabled = !isGloballyEnabled;

    await storage.setItem(GLOBAL_AUTOFILL_POPUP_ENABLED_KEY, newGloballyEnabled);

    if (newGloballyEnabled) {
      // Reset all disabled sites when enabling globally
      await storage.setItem(DISABLED_SITES_KEY, []);
      await storage.setItem(VAULT_LOCKED_DISMISS_UNTIL_KEY, 0);
    }

    setIsGloballyEnabled(newGloballyEnabled);
  };

  return (
    <div className="p-4">
      {/* Language Settings Section */}
      <div className="mb-6">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-gray-900 dark:text-white">{t('common.language')}</p>
          <LanguageSwitcher variant="dropdown" size="sm" />
        </div>
      </div>

      <div className="mb-6">
        <label htmlFor="api-connection" className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
          {t('settings.serverUrl')}
        </label>
        <select
          value={selectedOption}
          onChange={handleOptionChange}
          className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
        >
          {DEFAULT_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {selectedOption === 'custom' && (
        <>
          <div className="mb-6">
            <label htmlFor="custom-client-url" className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
              Custom client URL
            </label>
            <input
              id="custom-client-url"
              type="text"
              value={customClientUrl}
              onChange={handleCustomClientUrlChange}
              placeholder="https://my-aliasvault-instance.com"
              className={`w-full bg-gray-50 border ${errors.clientUrl ? 'border-red-500' : 'border-gray-300'} text-gray-900 text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white`}
            />
            {errors.clientUrl && (
              <p className="mt-1 text-sm text-red-500">{errors.clientUrl}</p>
            )}
          </div>
          <div className="mb-6">
            <label htmlFor="custom-api-url" className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
              Custom API URL
            </label>
            <input
              id="custom-api-url"
              type="text"
              value={customUrl}
              onChange={handleCustomUrlChange}
              placeholder="https://my-aliasvault-instance.com/api"
              className={`w-full bg-gray-50 border ${errors.apiUrl ? 'border-red-500' : 'border-gray-300'} text-gray-900 text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white`}
            />
            {errors.apiUrl && (
              <p className="mt-1 text-sm text-red-500">{errors.apiUrl}</p>
            )}
          </div>
        </>
      )}

      {/* Autofill Popup Settings Section */}
      <div className="mb-6">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-gray-900 dark:text-white">{t('settings.autofillEnabled')}</p>
          <button
            onClick={toggleGlobalPopup}
            className={`px-4 py-2 rounded-md transition-colors ${
              isGloballyEnabled
                ? 'bg-green-200 text-green-800 hover:bg-green-300 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50'
                : 'bg-red-200 text-red-800 hover:bg-red-300 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50'
            }`}
          >
            {isGloballyEnabled ? t('common.enabled', 'Enabled') : t('common.disabled', 'Disabled')}
          </button>
        </div>
      </div>

      <div className="text-center text-gray-400 dark:text-gray-600">
        {t('settings.version')}: {AppInfo.VERSION}
      </div>
    </div>
  );
};

export default AuthSettings;
