import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import SecuritySection from '@/components/settings/security/SecuritySection';
import Button from '@/components/shared/Button';

/**
 * Link to the change password page.
 */
const PasswordChangeSection: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  
  return (
    <SecuritySection title={t('settings.securitySettings.changeMasterPassword')}>
      <div className="mb-3 text-sm text-gray-600 dark:text-gray-400">{t('settings.securitySettings.changePassword.headerText')}</div>
      <Button onClick={() => navigate('/settings/security/change-password')}>{t('settings.securitySettings.changePassword.changePassword')}</Button>
    </SecuritySection>
  );
};

export default PasswordChangeSection;
