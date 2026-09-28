import React from 'react';
import { useTranslation } from 'react-i18next';

import Logo from '@/components/auth/Logo';

/**
 * Fallback for unknown routes.
 */
const NotFound: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center px-6 pt-8 pb-8 mx-auto md:h-screen pt:mt-0 relative">
      <Logo />
      <div className="w-full max-w-xl p-6 sm:p-8 bg-white rounded-lg shadow dark:bg-gray-800">
        <p className="text-gray-500 dark:text-gray-400">{t('app.notFound.message')}</p>
      </div>
    </div>
  );
};

export default NotFound;
