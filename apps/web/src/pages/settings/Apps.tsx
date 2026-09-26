import React from 'react';
import { useTranslation } from 'react-i18next';

import Card from '@/components/shared/Card';
import PageContent from '@/components/shared/PageContent';
import PageHeader from '@/components/shared/PageHeader';
import { usePageTitle } from '@/hooks/usePageTitle';

/**
 * A downloadable client (the shared BrowserExtensionInfo / MobileAppInfo).
 */
type AppInfo = {
  name: string;
  iconPath: string;
  downloadUrl: string;
  isAvailable: boolean;
};

/** The browser extensions, in the order of the shared constants. */
const BROWSER_EXTENSIONS: AppInfo[] = [
  { name: 'Google Chrome', iconPath: '/img/browser-icons/chrome.svg', downloadUrl: 'https://chromewebstore.google.com/detail/aliasvault/bmoggiinmnodjphdjnmpcnlleamkfedj', isAvailable: true },
  { name: 'Firefox', iconPath: '/img/browser-icons/firefox.svg', downloadUrl: 'https://addons.mozilla.org/en-US/firefox/addon/aliasvault/', isAvailable: true },
  { name: 'Safari', iconPath: '/img/browser-icons/safari.svg', downloadUrl: 'https://apps.apple.com/app/6743163173', isAvailable: true },
  { name: 'Microsoft Edge', iconPath: '/img/browser-icons/edge.svg', downloadUrl: 'https://microsoftedge.microsoft.com/addons/detail/aliasvault/kabaanafahnjkfkplbnllebdmppdemfo', isAvailable: true },
  { name: 'Brave', iconPath: '/img/browser-icons/brave.svg', downloadUrl: 'https://chromewebstore.google.com/detail/aliasvault/bmoggiinmnodjphdjnmpcnlleamkfedj', isAvailable: true },
];

/** The mobile apps. */
const MOBILE_APPS: AppInfo[] = [
  { name: 'iOS', iconPath: '/img/mobile-icons/ios.svg', downloadUrl: 'https://apps.apple.com/app/id6745490915', isAvailable: true },
  { name: 'Android', iconPath: '/img/mobile-icons/android.svg', downloadUrl: 'https://play.google.com/store/apps/details?id=net.aliasvault.app', isAvailable: true },
];

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
  const tk = 'pages.main.settings.apps';
  usePageTitle(t(`${tk}.PageTitle`));

  return (
    <>
      <PageHeader breadcrumbItems={[{ displayName: t(`${tk}.BreadcrumbTitle`) }]} title={t(`${tk}.PageTitle`)} description={t(`${tk}.PageDescription`)} />

      <PageContent>
        <Card>
          <div className="mb-6">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">{t(`${tk}.BrowserExtensionsTitle`)}</h3>
            <p className="text-gray-600 dark:text-gray-400">{t(`${tk}.BrowserExtensionsDescription`)}</p>
          </div>

          <div className="mb-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {BROWSER_EXTENSIONS.map(app => <AppRow key={app.name} app={app} buttonText={t(`${tk}.InstallButton`)} comingSoonText={t(`${tk}.ComingSoonText`)} />)}
            </div>
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">{t(`${tk}.MobileAppsTitle`)}</h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4">{t(`${tk}.MobileAppsDescription`)}</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {MOBILE_APPS.map(app => <AppRow key={app.name} app={app} buttonText={t(`${tk}.DownloadButton`)} comingSoonText={t(`${tk}.ComingSoonText`)} />)}
          </div>
        </Card>
      </PageContent>
    </>
  );
};

export default AppsSettings;
