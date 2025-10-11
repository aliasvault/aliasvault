import React from 'react';
import { useTranslation } from 'react-i18next';

import { FormInputCopyToClipboard } from '@/entrypoints/popup/components/Forms/FormInputCopyToClipboard';

import type { Credential } from '@/utils/dist/shared/models/vault';

type LoginCredentialsBlockProps = {
  credential: Credential;
}

/**
 * Render the login credentials block.
 */
const LoginCredentialsBlock: React.FC<LoginCredentialsBlockProps> = ({ credential }) => {
  const { t } = useTranslation();
  const email = credential.Alias?.Email?.trim();
  const username = credential.Username?.trim();
  const password = credential.Password?.trim();

  if (!email && !username && !password && !credential.HasPasskey) {
    return null;
  }

  return (
    <div className="space-y-2">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">{t('common.loginCredentials')}</h2>
      {email && (
        <FormInputCopyToClipboard
          id="email"
          label={t('common.email')}
          value={email}
        />
      )}
      {username && (
        <FormInputCopyToClipboard
          id="username"
          label={t('common.username')}
          value={username}
        />
      )}
      {credential.HasPasskey && (
        <div className="p-3 rounded bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
          <div className="flex items-start gap-2">
            <svg
              className="w-5 h-5 text-gray-600 dark:text-gray-400 mt-0.5 flex-shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
            <div className="flex-1">
              <div className="mb-1">
                <span className="text-sm font-medium text-gray-900 dark:text-white">{t('passkeys.passkey')}</span>
              </div>
              <div className="space-y-1 mb-2">
                {credential.PasskeyRpId && (
                  <div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{t('passkeys.site')}: </span>
                    <span className="text-sm text-gray-900 dark:text-white">{credential.PasskeyRpId}</span>
                  </div>
                )}
                {credential.PasskeyDisplayName && (
                  <div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{t('passkeys.displayName')}: </span>
                    <span className="text-sm text-gray-900 dark:text-white">{credential.PasskeyDisplayName}</span>
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {t('passkeys.helpText')}
              </p>
            </div>
          </div>
        </div>
      )}
      {password && (
        <FormInputCopyToClipboard
          id="password"
          label={t('common.password')}
          value={password}
          type="password"
        />
      )}
    </div>
  );
};

export default LoginCredentialsBlock;