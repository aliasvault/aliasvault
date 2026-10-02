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
          icon="refresh"
        />
        <SettingsRow
          id="active-sessions-button"
          label={t('settings.securitySettings.activeSessionsTitle')}
          onClick={() => navigate('/settings/security/active-sessions')}
          disabled={dbContext.isOffline}
          disabledReason={offlineReason}
          icon="desktop-computer"
        />
        <SettingsRow
          id="auth-logs-button"
          label={t('settings.securitySettings.recentAuthLogs')}
          onClick={() => navigate('/settings/security/auth-logs')}
          disabled={dbContext.isOffline}
          disabledReason={offlineReason}
          icon="clipboard-list"
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
          icon="trash"
        />
      </SettingsGroup>
    </div>
  );
};

export default SecuritySettings;
