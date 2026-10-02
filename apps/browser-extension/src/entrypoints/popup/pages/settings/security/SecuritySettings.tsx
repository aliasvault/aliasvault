import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import PageTitle from '@/entrypoints/popup/components/PageTitle';
import { SettingsGroup, SettingsRow } from '@/entrypoints/popup/components/Settings/SettingsMenu';
import { useDb } from '@/entrypoints/popup/context/DbContext';

/**
 * Account security page: server-side account actions, with account deletion kept apart at the bottom.
 */
const SecuritySettings: React.FC = () => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const navigate = useNavigate();
  const offlineReason = t('common.errors.serverNotAvailable');

  return (
    <div className="space-y-6">
      <div>
        <PageTitle>{t('settings.accountSecurity')}</PageTitle>
        <p className="text-sm text-gray-600 dark:text-gray-400">{t('settings.securitySettings.description')}</p>
      </div>

      <SettingsGroup>
        <SettingsRow
          id="change-password-button"
          label={t('settings.securitySettings.changeMasterPassword')}
          onClick={() => navigate('/settings/security/change-password')}
          disabled={dbContext.isOffline}
          disabledReason={offlineReason}
          icon={<path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />}
        />
        <SettingsRow
          id="active-sessions-button"
          label={t('settings.securitySettings.activeSessionsTitle')}
          onClick={() => navigate('/settings/security/active-sessions')}
          disabled={dbContext.isOffline}
          disabledReason={offlineReason}
          icon={<path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />}
        />
        <SettingsRow
          id="auth-logs-button"
          label={t('settings.securitySettings.recentAuthLogs')}
          onClick={() => navigate('/settings/security/auth-logs')}
          disabled={dbContext.isOffline}
          disabledReason={offlineReason}
          icon={<path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />}
        />
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow
          id="delete-account-button"
          label={t('settings.securitySettings.deleteAccount.deleteAccount')}
          onClick={() => navigate('/settings/security/delete-account')}
          danger
          disabled={dbContext.isOffline}
          disabledReason={offlineReason}
          icon={<path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />}
        />
      </SettingsGroup>
    </div>
  );
};

export default SecuritySettings;
