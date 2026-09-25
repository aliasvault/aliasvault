import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import { getAppConfig } from '@/config/AppConfig';

const TIP_KEYS = ['layout.footer.TipCreateShortcut', 'layout.footer.TipFindShortcut', 'layout.footer.TipHomeShortcut', 'layout.footer.TipLockShortcut'];

/**
 * Page footer.
 */
const Footer: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const [tipKey, setTipKey] = useState(TIP_KEYS[0]);
  const deploymentMode = getAppConfig().deploymentMode;

  // Show a random UX tip on each page load.
  useEffect(() => {
    setTipKey(TIP_KEYS[Math.floor(Math.random() * TIP_KEYS.length)]);
  }, [location.pathname]);

  return (
    <footer className="fixed -z-10 bottom-0 left-0 right-0 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
      <div className="container mx-auto px-4 py-4">
        <div className="flex flex-col lg:flex-row justify-between items-center">
          <p className="text-sm text-center text-gray-500 mb-4 lg:mb-0">
            © {new Date().getFullYear()} <span>AliasVault v{__APP_VERSION__}</span>{deploymentMode && <> <span className="ml-1">({deploymentMode})</span></>}. {t('layout.footer.CopyrightText')}
          </p>
          <div className="hidden lg:block text-center text-gray-400 text-sm">{t(tipKey)}</div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
