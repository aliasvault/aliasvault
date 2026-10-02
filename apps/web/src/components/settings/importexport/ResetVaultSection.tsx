import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import Button from '@/components/shared/Button';
import Card from '@/components/shared/Card';
import SectionTitle from '@/components/shared/SectionTitle';

/**
 * Card linking to the vault reset page.
 */
const ResetVaultSection: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <Card>
      <SectionTitle className="mb-2">{t('settings.resetVault.pageTitle')}</SectionTitle>
      <div className="mb-3 text-sm text-gray-600 dark:text-gray-400">{t('settings.resetVault.section.description')}</div>
      <Button color="danger" onClick={() => navigate('/settings/import-export/reset-vault')}>{t('settings.resetVault.pageTitle')}</Button>
    </Card>
  );
};

export default ResetVaultSection;
