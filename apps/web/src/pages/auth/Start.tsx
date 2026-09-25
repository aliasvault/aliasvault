import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import MessageInfo from '@/components/alerts/MessageInfo';
import LanguageSwitcher from '@/components/auth/LanguageSwitcher';
import Logo from '@/components/auth/Logo';
import FooterLogin from '@/components/layout/FooterLogin';
import { getAppConfig } from '@/config/AppConfig';
import { useAuth } from '@/context/AuthContext';
import { usePageTitle } from '@/hooks/usePageTitle';

/**
 * Landing page for visitors who are not logged in.
 */
const Start: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isInitialized, isLoggedIn } = useAuth();
  const [isHttpWarning, setIsHttpWarning] = useState(false);
  usePageTitle('AliasVault');

  useEffect(() => {
    if (isInitialized && isLoggedIn) {
      navigate('/', { replace: true });
    }
  }, [isInitialized, isLoggedIn, navigate]);

  /**
   * Browsers only allow the crypto APIs over HTTPS, except on localhost.
   */
  useEffect(() => {
    const host = window.location.hostname.toLowerCase();
    const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    setIsHttpWarning(window.location.protocol === 'http:' && !isLocalhost);
  }, []);

  return (
    <>
      <div className="relative">
        <div className="absolute top-4 right-4 z-10">
          <LanguageSwitcher />
        </div>
      </div>

      <div className="flex flex-col items-center justify-center px-6 pt-8 pb-8 mx-auto md:h-screen pt:mt-0 relative">
        <div className="w-full max-w-7xl mx-auto flex flex-col lg:flex-row bg-gray-100 dark:bg-gray-900">
          <div className="hidden lg:flex lg:w-1/2 items-center justify-center p-8">
            <div className="text-white text-4xl font-bold">
              <img src="/img/logo.svg" alt="AliasVault" className="w-64 h-64" />
            </div>
          </div>

          <div className="w-full lg:w-1/2 flex items-center justify-center bg-gray-100 dark:bg-gray-900">
            <div className="w-full max-w-xl space-y-4">
              <Logo />
              <h2 className="text-3xl font-semibold text-gray-800 dark:text-gray-200 mb-6">
                {t('pages.auth.start.MainTitle')}
              </h2>
              <p className="text-lg text-gray-600 dark:text-gray-300 mb-8">
                {t('pages.auth.start.TaglineText')}
              </p>
              {isHttpWarning && (
                <MessageInfo title={t('pages.auth.start.HttpsWarningTitle')}>
                  {t('pages.auth.start.HttpsWarningMessage')}
                </MessageInfo>
              )}
              <div className="space-y-4">
                {getAppConfig().publicRegistrationEnabled && (
                  <Link to="/user/setup" className="block w-full py-3 px-4 bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-lg transition duration-300 ease-in-out text-center">
                    {t('pages.auth.start.CreateNewVaultButton')}
                  </Link>
                )}
                <Link to="/user/login" className="block w-full py-3 px-4 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-800 text-gray-800 dark:text-white font-semibold rounded-lg transition duration-300 ease-in-out text-center">
                  {t('pages.auth.start.LoginExistingAccountButton')}
                </Link>
              </div>
            </div>
          </div>

          <FooterLogin />
        </div>
      </div>
    </>
  );
};

export default Start;
