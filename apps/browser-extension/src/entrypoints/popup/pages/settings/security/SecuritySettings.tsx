import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import PageTitle from '@/entrypoints/popup/components/PageTitle';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';

import { VaultKeyService } from '@/utils/VaultKeyService';

/**
 * One entry in the security settings menu.
 */
type SecurityMenuEntry = {
  id: string;
  label: string;
  path: string;
  icon: React.ReactNode;
  disabled?: boolean;
  disabledReason?: string;
};

/**
 * Security settings page which groups the account and vault security pages.
 */
const SecuritySettings: React.FC = () => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const navigate = useNavigate();

  const entries: SecurityMenuEntry[] = [
    {
      id: 'change-password-button',
      label: t('settings.securitySettings.changePassword.title'),
      path: '/settings/security/change-password',
      disabled: dbContext.isOffline,
      disabledReason: t('common.errors.serverNotAvailable'),
      icon: <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />,
    },
    {
      id: 'active-sessions-button',
      label: t('settings.securitySettings.activeSessions.title'),
      path: '/settings/security/active-sessions',
      disabled: dbContext.isOffline,
      disabledReason: t('common.errors.serverNotAvailable'),
      icon: <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />,
    },
    {
      id: 'auth-logs-button',
      label: t('settings.securitySettings.authLogs.title'),
      path: '/settings/security/auth-logs',
      disabled: dbContext.isOffline,
      disabledReason: t('common.errors.serverNotAvailable'),
      icon: <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <PageTitle>{t('settings.securitySettings.title')}</PageTitle>
        <p className="text-sm text-gray-600 dark:text-gray-400">{t('settings.securitySettings.description')}</p>
      </div>

        <section>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {entries.map((entry) => (
                <button
                  key={entry.id}
                  id={entry.id}
                  onClick={() => navigate(entry.path)}
                  disabled={entry.disabled}
                  title={entry.disabled ? entry.disabledReason : undefined}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center">
                    <svg className="w-5 h-5 mr-3 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      {entry.icon}
                    </svg>
                    <span className="text-gray-900 dark:text-white text-left">{entry.label}</span>
                  </div>
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        </section>
    </div>
  );
};

export default SecuritySettings;
