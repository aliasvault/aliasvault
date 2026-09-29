import React from 'react';
import { useTranslation } from 'react-i18next';

import AlertMessageError from '@/components/alerts/AlertMessageError';
import Button from '@/components/shared/Button';
import { asksForClientUpdate, updateApp } from '@/utils/ClientUpdate';

/**
 * List of form-level errors, with an update button when one asks the user to update the app.
 */
const ServerValidationErrors: React.FC<{ errors: string[]; className?: string }> = ({ errors, className = '' }) => {
  const { t } = useTranslation();
  if (errors.length === 0) {
    return null;
  }
  return (
    <div className={`messages-container ${className}`.trim()}>
      {errors.map((error, index) => (
        <AlertMessageError key={index} message={error} />
      ))}
      {errors.some(asksForClientUpdate) && (
        <Button onClick={updateApp} color="primary" additionalClasses="mt-2">{t('common.updateApp')}</Button>
      )}
    </div>
  );
};

export default ServerValidationErrors;
