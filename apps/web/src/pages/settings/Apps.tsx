import React from 'react';
import { useTranslation } from 'react-i18next';

import Card from '@/components/shared/Card';
import PageContent from '@/components/shared/PageContent';
import PageHeader from '@/components/shared/PageHeader';
import { usePageTitle } from '@/hooks/usePageTitle';
import { type AppInfo, BROWSER_EXTENSIONS, MOBILE_APPS } from '@/utils/AppDownloads';

/**
 * A row for one app with its install or download link.
 */
const AppRow: React.FC<{ app: AppInfo; buttonText: string; comingSoonText: string }> = ({ app, buttonText, comingSoonText }) => (
  <div className="p-4 border rounded-lg dark:border-gray-700 flex justify-between items-center">
    <div className="flex items-center">
      <img src={app.iconPath} alt={app.name} className="w-8 h-8 mr-3" />
      <h4 className="text-lg font-medium text-gray-900 dark:text-white">{app.name}</h4>
    </div>
    {app.isAvailable ? (
      <a href={app.downloadUrl} target="_blank" rel="noreferrer" className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 focus:ring-4 focus:ring-primary-200 dark:focus:ring-primary-900">
        {buttonText}
      </a>
    ) : (
      <span className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-500 bg-gray-100 rounded-lg dark:text-gray-400 dark:bg-gray-800">{comingSoonText}</span>
    )}
  </div>
);

/**
 * The extensions and apps page.
 */
const AppsSettings: React.FC = () => {
  const { t } = useTranslation();
  
  usePageTitle(t('settings.apps.pageTitle'));

  return (
    <>
      <PageHeader breadcrumbItems={[{ displayName: t('settings.apps.pageTitle') }]} title={t('settings.apps.pageTitle')} description={t('settings.apps.pageDescription')} />

      <PageContent>
        <Card>
          <div className="mb-6">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">{t('settings.apps.browserExtensionsTitle')}</h3>
            <p className="text-gray-600 dark:text-gray-400">{t('settings.apps.browserExtensionsDescription')}</p>
          </div>

          <div className="mb-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {BROWSER_EXTENSIONS.map(app => <AppRow key={app.name} app={app} buttonText={t('settings.apps.installButton')} comingSoonText={t('settings.apps.comingSoonText')} />)}
            </div>
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">{t('settings.apps.mobileAppsTitle')}</h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4">{t('settings.apps.mobileAppsDescription')}</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {MOBILE_APPS.map(app => <AppRow key={app.name} app={app} buttonText={t('settings.apps.downloadButton')} comingSoonText={t('settings.apps.comingSoonText')} />)}
          </div>
        </Card>
      </PageContent>
    </>
  );
};

export default AppsSettings;
