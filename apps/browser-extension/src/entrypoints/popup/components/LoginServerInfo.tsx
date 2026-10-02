import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useApiUrl } from '@/entrypoints/popup/utils/ApiUrlUtility';

/**
 * Component for displaying the login server information.
 */
const LoginServerInfo: React.FC = () => {
  const { loadApiUrl, getDisplayUrl } = useApiUrl();
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    /**
     * Loads the base URL for the login server.
     */
    loadApiUrl();
  }, [loadApiUrl]);

  /**
   * Handles the click event for the login server information.
   */
  const handleClick = () : void => {
    navigate('/auth-settings');
  };

  return (
    <div className="text-sm text-gray-600 dark:text-gray-400 mb-4">
      ({t('auth.connectingTo')}{' '}
      <button
        onClick={handleClick}
        type="button"
        className="text-primary-500 hover:text-primary-600 dark:text-primary-400 dark:hover:text-primary-500 underline"
      >
        {getDisplayUrl()}
      </button>)
    </div>
  );
};

export default LoginServerInfo;