import { AppInfo } from '@aliasvault/client/platform/AppInfo';
import { familySharingText } from '@aliasvault/client/sharing/FamilySharingView';
import { CapabilityKeys } from '@aliasvault/models/webapi';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import SettingsIcon, { type SettingsIconName } from '@/components/settings/SettingsIcon';
import PageContent from '@/components/shared/PageContent';
import PageHeader from '@/components/shared/PageHeader';
import { useAuth } from '@/context/AuthContext';
import { useCapabilities } from '@/context/CapabilityContext';
import { useConfirmLogout } from '@/hooks/useConfirmLogout';
import { usePageTitle } from '@/hooks/usePageTitle';

/**
 * One row on the settings overview: a link to a settings page.
 */
type SettingsRow = {
  label: string;
  description: string;
  icon: SettingsIconName;
  to: string;
};

/**
 * A titled group of rows on the settings overview.
 */
type SettingsGroup = {
  title: string;
  rows: SettingsRow[];
};

/**
 * The content of a row: icon, title and a short description.
 */
const RowContent: React.FC<{ row: SettingsRow }> = ({ row }) => (
  <>
    <SettingsIcon name={row.icon} className="flex-shrink-0 w-5 h-5 mt-0.5 text-primary-600 dark:text-primary-400" />
    <span className="min-w-0">
      <span className="block text-sm font-medium text-gray-900 dark:text-white">{row.label}</span>
      <span className="block text-xs text-gray-500 dark:text-gray-400 line-clamp-2" title={row.description}>{row.description}</span>
    </span>
  </>
);

/**
 * One row, linking to its settings page.
 */
const Row: React.FC<{ row: SettingsRow }> = ({ row }) => (
  <Link to={row.to} className="flex items-start gap-3 w-full px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors"><RowContent row={row} /></Link>
);

/**
 * Settings overview: the same groups and order as the browser extension and mobile app settings.
 */
const Settings: React.FC = () => {
  const { t } = useTranslation();
  const { username } = useAuth();
  const hasCapability = useCapabilities();
  const confirmLogout = useConfirmLogout();

  usePageTitle(t('common.settings'));

  const groups: SettingsGroup[] = [
    {
      title: t('settings.security'),
      rows: [
        { to: '/settings/two-factor', label: t('common.twoFactorAuthentication'), description: t('settings.securitySettings.enable2fa.pageDescription'), icon: 'twoFactor' },
        { to: '/settings/sessions', label: t('settings.sessionsAndLogs'), description: t('settings.sessionsAndLogsDescription'), icon: 'sessions' },
        { to: '/settings/security', label: t('settings.securitySettings.pageTitle'), description: t('settings.securitySettings.description'), icon: 'security' },
      ],
    },
    {
      title: t('settings.groups.generators'),
      rows: [
        { to: '/settings/password-generator', label: t('settings.passwordGenerator'), description: t('settings.passwordGeneratorSettings.description'), icon: 'passwordGenerator' },
        { to: '/settings/identity-generator', label: t('settings.identityGenerator'), description: t('settings.identityGeneratorSettings.description'), icon: 'identityGenerator' },
      ],
    },
    {
      title: t('navigation.vault'),
      rows: [
        { to: '/settings/import-export', label: t('settings.importExport'), description: t('importExport.pageDescription'), icon: 'importExport' },
        { to: '/settings/storage-insights', label: t('settings.storageInsights.breadcrumbTitle'), description: t('settings.storageInsights.pageDescription'), icon: 'storage' },
      ],
    },
    {
      title: t('settings.groups.general'),
      rows: [
        { to: '/settings/general', label: t('settings.general.pageTitle'), description: t('settings.general.pageDescription'), icon: 'general' },
        { to: '/settings/apps', label: t('settings.apps.pageTitle'), description: t('settings.apps.pageDescription'), icon: 'apps' },
      ],
    },
  ];

  return (
    <>
      <PageHeader breadcrumbItems={[{ displayName: t('common.settings') }]} title={t('common.settings')} />

      <PageContent>
        <div className="px-4 space-y-4">
          <section className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 bg-white border border-gray-200 rounded-lg shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center">
                <span className="text-primary-600 dark:text-primary-400 text-lg font-medium">{username?.[0]?.toUpperCase() ?? '?'}</span>
              </div>
              <div className="min-w-0">
                <p className="font-medium text-gray-900 dark:text-white truncate">{username}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('common.loggedIn')}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {hasCapability(CapabilityKeys.VaultSharing) && (
                <Link to="/settings/family-sharing" className="inline-flex items-center px-3 py-2 text-sm font-medium rounded-lg text-gray-700 bg-gray-100 hover:bg-gray-200 dark:text-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600">
                  <SettingsIcon name="familySharing" className="w-4 h-4 mr-2" />
                  {familySharingText.title}
                  <span className="ml-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase rounded bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-200">{familySharingText.beta}</span>
                </Link>
              )}
              <button type="button" id="logoutButton" onClick={() => void confirmLogout()} className="inline-flex items-center px-3 py-2 text-sm font-medium rounded-lg text-red-600 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:bg-red-900/30 dark:hover:bg-red-900/50">
                {t('web.topMenu.logOut')}
              </button>
            </div>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            {groups.map((group) => (
              <section key={group.title} className="bg-white border border-gray-200 rounded-lg shadow-sm dark:border-gray-700 dark:bg-gray-800 overflow-hidden">
                <h2 className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{group.title}</h2>
                <div>
                  {group.rows.map((row) => <Row key={row.label} row={row} />)}
                </div>
              </section>
            ))}
          </div>

          <p className="text-center text-[13px] text-gray-400 dark:text-gray-500"><span className="font-bold">{t('settings.appVersion')}:</span> {AppInfo.VERSION}</p>
        </div>
      </PageContent>
    </>
  );
};

export default Settings;
