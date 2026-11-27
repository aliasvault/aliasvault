import { AppInfo } from '@aliasvault/client/platform/AppInfo';
import { toRequestHeaders } from '@aliasvault/client/platform/ProxyHeaders';
import { toServerUrlFields, withServerUrl } from '@aliasvault/client/platform/ServerUrl';
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import Icon from '@/entrypoints/popup/components/Icons/Icon';
import { SettingsGroup, SettingsTextField } from '@/entrypoints/popup/components/Settings/SettingsMenu';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useServerUrlStore } from '@/entrypoints/popup/hooks/useServerUrlStore';

import { StorageKeys } from '@/utils/constants/storageKeys';

import type { ServerUrlErrors, ServerUrlFields } from '@aliasvault/client/platform/ServerUrl';
import type { UiIconName } from '@aliasvault/models/icons';

import { storage } from '#imports';

const CUSTOM_OPTION = 'custom';

/**
 * Server settings page (official or self-hosted server), only shown when the user is not logged in.
 */
const ServerSettings: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [selectedOption, setSelectedOption] = useState<string>('');
  const [returnedSelfHosted] = useState(() => (location.state as { selfHosted?: boolean } | null)?.selfHosted === true);
  const [serverFields, setServerFields] = useState<ServerUrlFields>(() => toServerUrlFields('', ''));
  const [advancedCount, setAdvancedCount] = useState<number>(0);
  const [errors, setErrors] = useState<ServerUrlErrors>({});
  const { setIsInitialLoading } = useLoading();
  const serverUrlStore = useServerUrlStore(setErrors);

  const serverOptions: { value: string; label: string; icon: UiIconName }[] = [
    { value: AppInfo.DEFAULT_API_URL, label: 'AliasVault.com', icon: 'globe-alt' },
    { value: CUSTOM_OPTION, label: t('app.loginSettings.selfHosted'), icon: 'database' },
  ];

  useEffect(() => {
    /**
     * Load the stored server settings.
     */
    const loadStoredSettings = async () : Promise<void> => {
      const apiUrl = await storage.getItem(StorageKeys.API_URL) as string | null;
      const clientUrl = await storage.getItem(StorageKeys.CLIENT_URL) as string | null;
      const headerCount = Object.keys(toRequestHeaders(await storage.getItem(StorageKeys.CUSTOM_PROXY_HEADERS))).length;

      if (apiUrl && apiUrl !== AppInfo.DEFAULT_API_URL) {
        const fields = toServerUrlFields(apiUrl, clientUrl);
        setSelectedOption(CUSTOM_OPTION);
        setServerFields(fields);
        setAdvancedCount(headerCount + (fields.isCustomApiUrl ? 1 : 0));
      } else {
        setSelectedOption(returnedSelfHosted ? CUSTOM_OPTION : AppInfo.DEFAULT_API_URL);
        setAdvancedCount(headerCount);
      }
      setIsInitialLoading(false);
    };

    loadStoredSettings();
  }, [setIsInitialLoading, returnedSelfHosted]);

  /**
   * Select the official server or a self-hosted one.
   */
  const handleOptionChange = async (value: string) : Promise<void> => {
    setSelectedOption(value);
    // Keep the choice on this history entry, so coming back from the advanced settings keeps it while no URL is stored yet.
    navigate(location.pathname, { replace: true, state: { selfHosted: value === CUSTOM_OPTION } });
    if (value !== CUSTOM_OPTION) {
      serverUrlStore.cancel();
      await storage.setItem(StorageKeys.API_URL, '');
      await storage.setItem(StorageKeys.CLIENT_URL, '');
      setServerFields(toServerUrlFields('', ''));
      setErrors({});
    }
  };

  /**
   * Update the server URL right away, and store it shortly after.
   */
  const handleServerUrlChange = (value: string) : void => {
    const fields = withServerUrl(serverFields, value);
    setServerFields(fields);
    serverUrlStore.schedule(fields);
  };

  /**
   * Open the advanced settings once the server URL typed so far is stored, as that page reads it.
   */
  const openAdvancedSettings = async () : Promise<void> => {
    await serverUrlStore.flush();
    navigate('/server-settings/advanced');
  };

  return (
    <div className="space-y-6">
      <SettingsGroup>
        {serverOptions.map(option => {
          const isSelected = selectedOption === option.value;
          return (
            <button
              key={option.value}
              id={`api-option-${option.value === CUSTOM_OPTION ? 'custom' : 'default'}`}
              type="button"
              onClick={() => handleOptionChange(option.value)}
              aria-pressed={isSelected}
              className="w-full px-4 py-3 flex items-center hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <Icon name={option.icon} className="w-5 h-5 mr-3 text-gray-600 dark:text-gray-400" />
              <span className="flex-1 text-left text-gray-900 dark:text-white">{option.label}</span>
              {isSelected && <Icon name="check" className="w-5 h-5 text-primary-600 dark:text-primary-400" />}
            </button>
          );
        })}
      </SettingsGroup>

      {selectedOption === CUSTOM_OPTION && (
        <SettingsTextField
          id="custom-server-url"
          label={t('settings.serverUrl')}
          value={serverFields.serverUrl}
          onChange={handleServerUrlChange}
          placeholder="https://aliasvault.example.com"
          error={errors.serverUrl && t(errors.serverUrl)}
          hint={t('settings.serverUrlHint')}
        >
          <button
            id="advanced-settings"
            type="button"
            onClick={openAdvancedSettings}
            className="flex items-center gap-1 px-1 mt-4 text-sm font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
          >
            {t('app.loginSettings.advancedSettings')}
            {advancedCount > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300">{advancedCount}</span>
            )}
            <Icon name="chevron-right" className="w-4 h-4" />
          </button>
        </SettingsTextField>
      )}
    </div>
  );
};

export default ServerSettings;
