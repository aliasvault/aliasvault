import React from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/entrypoints/popup/context/AuthContext';

/**
 * Username avatar component that shows the avatar and username.
 * Displays centered above the unlock form.
 */
const UsernameAvatar: React.FC = () => {
  const { t } = useTranslation();
  const { username } = useAuth();

  return (
    <div className="flex flex-col items-center mb-6">
      <div className="w-12 h-12 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center mb-3">
        <span className="text-primary-600 dark:text-primary-400 text-2xl font-medium">
          {username?.[0]?.toUpperCase() || '?'}
        </span>
      </div>
      <p className="font-medium text-gray-900 dark:text-white text-base">
        {username}
      </p>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {t('common.loggedIn')}
      </p>
    </div>
  );
};

export default UsernameAvatar;