import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import GlobalNotificationDisplay from '@/components/alerts/GlobalNotificationDisplay';
import LanguageSwitcher from '@/components/auth/LanguageSwitcher';
import Logo from '@/components/auth/Logo';

/**
 * Centered card layout of the auth pages (login, unlock, register).
 */
const AuthLayout: React.FC = () => {
  const location = useLocation();
  const path = location.pathname.toLowerCase();

  // Show on login, forgot password and register, not during setup or unlock.
  const showLanguageSwitcher = path.includes('/user/login') || path.includes('/user/forgot-password') || path.endsWith('/');

  return (
    <div className="flex flex-col items-center justify-center px-6 pt-8 pb-8 mx-auto md:h-screen pt:mt-0 relative">
      {showLanguageSwitcher && (
        <div className="absolute top-4 right-4 z-10">
          <LanguageSwitcher />
        </div>
      )}
      <Logo />
      <div className="w-full max-w-xl p-6 sm:p-8 bg-white rounded-lg shadow dark:bg-gray-800">
        <GlobalNotificationDisplay marginTop={false} marginBottom={true} paddingX={false} />
        <Outlet />
      </div>
    </div>
  );
};

export default AuthLayout;
