import React from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/entrypoints/popup/context/AuthContext';

/**
 * Username avatar component that shows the avatar and username.
 */
const UsernameAvatar: React.FC = () => {
  const { t } = useTranslation();
  const { username } = useAuth();

  return (
    <div className="flex items-center space-x-3 mb-6">
      <div className="flex-shrink-0">
        <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center">
          <span className="text-primary-600 dark:text-primary-400 text-lg font-medium">
            {username?.[0]?.toUpperCase() || '?'}
          </span>
        </div>
      </div>
      <div>
        <p className="font-medium text-gray-900 dark:text-white">
          {username}
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('auth.loggedIn')}
        </p>
      </div>
    </div>
  );
};

export default UsernameAvatar;