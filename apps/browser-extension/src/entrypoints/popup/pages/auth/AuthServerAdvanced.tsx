import { cleanProxyHeaders, headerNameError, toRequestHeaders } from '@aliasvault/client/platform/ProxyHeaders';
import { apiUrlFromServerUrl, toServerUrlFields, withApiUrl } from '@aliasvault/client/platform/ServerUrl';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '@/entrypoints/popup/components/Icons/Icon';
import { SettingsSectionTitle, SettingsTextField } from '@/entrypoints/popup/components/Settings/SettingsMenu';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useServerUrlStore } from '@/entrypoints/popup/hooks/useServerUrlStore';

import { StorageKeys } from '@/utils/constants/storageKeys';

import type { ProxyHeader } from '@aliasvault/client/platform/ProxyHeaders';
import type { ServerUrlErrors, ServerUrlFields } from '@aliasvault/client/platform/ServerUrl';

import { storage } from '#imports';

const EMPTY_HEADER: ProxyHeader = { name: '', value: '' };

/**
 * Advanced settings of a self-hosted server (API URL and custom proxy headers), only shown when the user is not logged in.
 */
const AuthServerAdvanced: React.FC = () => {
  const { t } = useTranslation();
  const { setIsInitialLoading } = useLoading();
  const [serverFields, setServerFields] = useState<ServerUrlFields>(() => toServerUrlFields('', ''));
  const [apiUrlInput, setApiUrlInput] = useState('');
  const [errors, setErrors] = useState<ServerUrlErrors>({});
  const [headers, setHeaders] = useState<ProxyHeader[]>([]);
  const [visibleValues, setVisibleValues] = useState<boolean[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const serverUrlStore = useServerUrlStore(setErrors);

  useEffect(() => {
    /**
     * Load the stored API URL and headers.
     */
    const loadSettings = async (): Promise<void> => {
      const fields = toServerUrlFields(await storage.getItem(StorageKeys.API_URL) as string | null, await storage.getItem(StorageKeys.CLIENT_URL) as string | null);
      setServerFields(fields);
      setApiUrlInput(fields.isCustomApiUrl ? fields.apiUrl : '');
      const stored = Object.entries(toRequestHeaders(await storage.getItem(StorageKeys.CUSTOM_PROXY_HEADERS))).map(([name, value]) => ({ name, value }));
      setHeaders(stored);
      setVisibleValues(stored.map(() => false));
      setIsLoaded(true);
      setIsInitialLoading(false);
    };
    loadSettings();
  }, [setIsInitialLoading]);

  useEffect(() => {
    if (isLoaded) {
      storage.setItem(StorageKeys.CUSTOM_PROXY_HEADERS, cleanProxyHeaders(headers));
    }
  }, [headers, isLoaded]);

  /**
   * Update the API URL right away, and store it shortly after; an empty API URL means the server URL + /api.
   */
  const handleApiUrlChange = (value: string): void => {
    const fields = withApiUrl(serverFields, value);
    setApiUrlInput(value);
    setServerFields(fields);
    serverUrlStore.schedule(fields);
  };

  /**
   * Update a field of a header.
   */
  const updateHeader = (index: number, field: keyof ProxyHeader, value: string): void => {
    setHeaders(prev => prev.map((header, i) => (i === index ? { ...header, [field]: value } : header)));
  };

  /**
   * Remove a header.
   */
  const removeHeader = (index: number): void => {
    setHeaders(prev => prev.filter((_, i) => i !== index));
    setVisibleValues(prev => prev.filter((_, i) => i !== index));
  };

  /**
   * Add an empty header.
   */
  const addHeader = (): void => {
    setHeaders(prev => [...prev, EMPTY_HEADER]);
    setVisibleValues(prev => [...prev, false]);
  };

  return (
    <div className="space-y-6">
      <SettingsTextField
        id="custom-api-url"
        label={t('settings.customApiUrl')}
        value={apiUrlInput}
        onChange={handleApiUrlChange}
        placeholder={apiUrlFromServerUrl(serverFields.serverUrl) || 'https://aliasvault.example.com/api'}
        error={errors.apiUrl && t(errors.apiUrl)}
        hint={t('settings.apiUrlHint')}
      />

      <section className="space-y-3">
        <div>
          <SettingsSectionTitle>{t('app.loginSettings.customProxyHeaders')}</SettingsSectionTitle>
          <p className="px-1 text-xs text-gray-500 dark:text-gray-400">{t('app.loginSettings.customProxyHeadersDescription')}</p>
        </div>

        {headers.map((header, index) => {
          const nameError = headerNameError(header.name);
          return (
            <div key={index}>
              <div className="flex justify-end px-1 mb-1">
                <button
                  id={`delete-custom-header-${index}`}
                  type="button"
                  onClick={() => removeHeader(index)}
                  className="flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                >
                  <Icon name="trash" className="w-3.5 h-3.5" />
                  {t('common.remove')}
                </button>
              </div>
              <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-sm border ${nameError ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'} divide-y divide-gray-200 dark:divide-gray-700`}>
                <input
                  id={`custom-header-name-${index}`}
                  type="text"
                  value={header.name}
                  onChange={e => updateHeader(index, 'name', e.target.value)}
                  placeholder={t('app.loginSettings.headerNamePlaceholder')}
                  aria-label={t('app.loginSettings.headerName')}
                  aria-invalid={nameError !== undefined}
                  autoComplete="off"
                  spellCheck={false}
                  className="block w-full px-4 py-3 text-sm bg-transparent text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none"
                />
                <div className="flex items-center">
                  <input
                    id={`custom-header-value-${index}`}
                    type={visibleValues[index] ? 'text' : 'password'}
                    value={header.value}
                    onChange={e => updateHeader(index, 'value', e.target.value)}
                    placeholder={t('app.loginSettings.headerValue')}
                    aria-label={t('app.loginSettings.headerValue')}
                    autoComplete="off"
                    spellCheck={false}
                    className="flex-1 min-w-0 px-4 py-3 text-sm bg-transparent text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setVisibleValues(prev => prev.map((visible, i) => (i === index ? !visible : visible)))}
                    title={visibleValues[index] ? t('common.hide') : t('common.show')}
                    className="px-3 py-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  >
                    <Icon name={visibleValues[index] ? 'eye-off' : 'eye'} className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {nameError && <p className="px-1 mt-1.5 text-xs text-red-500">{t(nameError)}</p>}
            </div>
          );
        })}

        <button
          id="add-custom-header"
          type="button"
          onClick={addHeader}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-primary-600 dark:text-primary-400 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          <Icon name="plus" className="w-4 h-4" />
          {t('common.add')}
        </button>
      </section>
    </div>
  );
};

export default AuthServerAdvanced;
