import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import Button from '@/components/shared/Button';
import Card from '@/components/shared/Card';

/**
 * Card linking to the vault reset page.
 */
const ResetVaultSection: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const tk = 'components.main.settings.importExport.resetVaultSection';

  return (
    <Card>
      <h3 className="mb-2 text-lg font-medium text-gray-900 dark:text-white">{t(`${tk}.Title`)}</h3>
      <div className="mb-3 text-sm text-gray-600 dark:text-gray-400">{t(`${tk}.Description`)}</div>
      <Button color="danger" onClick={() => navigate('/settings/import-export/reset-vault')}>{t(`${tk}.ResetVaultButton`)}</Button>
    </Card>
  );
};

export default ResetVaultSection;
