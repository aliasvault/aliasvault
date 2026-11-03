import { type AboutLink, getAboutLinkGroups } from '@aliasvault/client/platform/AboutLinks';
import { AppInfo } from '@aliasvault/client/platform/AppInfo';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PageTitle from '@/entrypoints/popup/components/PageTitle';
import { SettingsGroup, SettingsRow } from '@/entrypoints/popup/components/Settings/SettingsMenu';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useApiUrl } from '@/entrypoints/popup/utils/ApiUrlUtility';

import { StorageKeys } from '@/utils/constants/storageKeys';

import type { UiIconName } from '@aliasvault/models/icons';

import { storage } from '#imports';

const LINK_ICONS: Record<AboutLink['id'], UiIconName> = {
  contactSupport: 'mail',
  website: 'globe-alt',
  documentation: 'document-text',
  sourceCode: 'collection',
  privacyPolicy: 'shield-check',
  reportIssue: 'exclamation',
};

/**
 * A label with a read-only value.
 */
const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="px-4 py-3 flex items-center justify-between gap-4">
    <span className="text-gray-900 dark:text-white">{label}</span>
    <span className="text-gray-500 dark:text-gray-400 truncate select-text">{value}</span>
  </div>
);

/**
 * About page with the app and server version and links to the website, docs and source code.
 */
const AboutSettings: React.FC = () => {
  const { t } = useTranslation();
  const { setIsInitialLoading } = useLoading();
  const { apiUrl, loadApiUrl, getDisplayUrl } = useApiUrl();
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const [isApiUrlLoaded, setIsApiUrlLoaded] = useState(false);

  useEffect(() => {
    /**
     * Load the API URL and the server version stored on the last status check.
     */
    const load = async (): Promise<void> => {
      await loadApiUrl();
      setIsApiUrlLoaded(true);
      setServerVersion(await storage.getItem(StorageKeys.SERVER_VERSION) as string | undefined ?? null);
      setIsInitialLoading(false);
    };

    void load();
  }, [loadApiUrl, setIsInitialLoading]);

  return (
    <div className="space-y-6">
      <PageTitle>{t('settings.about.title')}</PageTitle>
      <SettingsGroup>
        <InfoRow label={t('settings.appVersion')} value={AppInfo.VERSION} />
        {serverVersion && <InfoRow label={t('settings.serverVersion')} value={serverVersion} />}
        <InfoRow label={t('settings.serverUrl')} value={getDisplayUrl()} />
      </SettingsGroup>
      {getAboutLinkGroups(isApiUrlLoaded ? apiUrl : '').map((group) => (
        <SettingsGroup key={group[0].id}>
          {group.map((link) => (
            <SettingsRow
              key={link.id}
              label={t(link.labelKey)}
              onClick={() => window.open(link.url, '_blank')}
              external
              icon={LINK_ICONS[link.id]}
            />
          ))}
        </SettingsGroup>
      ))}
    </div>
  );
};

export default AboutSettings;
