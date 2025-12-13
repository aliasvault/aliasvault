import React from 'react';
import { useTranslation } from 'react-i18next';

import { FormInputCopyToClipboard } from '@/entrypoints/popup/components/Forms/FormInputCopyToClipboard';

import { IdentityHelperUtils } from '@/utils/dist/core/identity-generator';
import type { Credential } from '@/utils/dist/core/models/vault';

type AliasBlockProps = {
  credential: Credential;
}

/**
 * Render the alias block.
 */
const AliasBlock: React.FC<AliasBlockProps> = ({ credential }) => {
  const { t } = useTranslation();
  const hasFirstName = Boolean(credential.Alias?.FirstName?.trim());
  const hasLastName = Boolean(credential.Alias?.LastName?.trim());
  const hasBirthDate = IdentityHelperUtils.isValidBirthDate(credential.Alias?.BirthDate);

  if (!hasFirstName && !hasLastName && !hasBirthDate) {
    return null;
  }

  return (
    <div className="space-y-2">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">{t('common.alias')}</h2>
      {(hasFirstName || hasLastName) && (
        <FormInputCopyToClipboard
          id="fullName"
          label={t('common.fullName')}
          value={[credential.Alias?.FirstName, credential.Alias?.LastName].filter(Boolean).join(' ')}
        />
      )}
      {hasFirstName && (
        <FormInputCopyToClipboard
          id="firstName"
          label={t('common.firstName')}
          value={credential.Alias?.FirstName ?? ''}
        />
      )}
      {hasLastName && (
        <FormInputCopyToClipboard
          id="lastName"
          label={t('common.lastName')}
          value={credential.Alias?.LastName ?? ''}
        />
      )}
      {hasBirthDate && (
        <FormInputCopyToClipboard
          id="birthDate"
          label={t('common.birthDate')}
          value={IdentityHelperUtils.normalizeBirthDateForDisplay(credential.Alias?.BirthDate)}
        />
      )}
    </div>
  );
};

export default AliasBlock;