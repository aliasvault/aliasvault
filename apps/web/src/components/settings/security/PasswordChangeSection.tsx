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
  const tk = 'components.main.settings.security.passwordChangeSection';
  return (
    <SecuritySection title={t(`${tk}.Title`)}>
      <div className="mb-3 text-sm text-gray-600 dark:text-gray-400">{t(`${tk}.Description`)}</div>
      <Button onClick={() => navigate('/settings/security/change-password')}>{t(`${tk}.ChangePasswordButton`)}</Button>
    </SecuritySection>
  );
};

export default PasswordChangeSection;
