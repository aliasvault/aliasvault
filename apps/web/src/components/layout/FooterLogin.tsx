import React from 'react';
import { useTranslation } from 'react-i18next';

import { getAppConfig } from '@/config/AppConfig';

/**
 * Footer shown on the auth pages.
 */
const FooterLogin: React.FC = () => {
  const { t } = useTranslation();
  const deploymentMode = getAppConfig().deploymentMode;

  return (
    <footer className="fixed -z-10 bottom-0 left-0 right-0 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-4">
        <p className="text-sm text-center text-gray-400 dark:text-gray-500 mb-4 lg:mb-0">
          © {new Date().getFullYear()} <span>AliasVault v{__APP_VERSION__}</span>{deploymentMode && <> <span className="ml-1">({deploymentMode})</span></>}. {t('layout.footer.CopyrightText')}
        </p>
      </div>
    </footer>
  );
};

export default FooterLogin;
