import { useTranslation } from 'react-i18next';

import { IdentityHelperUtils } from '@/utils/dist/core/identity-generator';
import type { Credential } from '@/utils/dist/core/models/vault';

import FormInputCopyToClipboard from '@/components/form/FormInputCopyToClipboard';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';

type AliasDetailsProps = {
  credential: Credential;
};

/**
 * Alias details component.
 */
export const AliasDetails: React.FC<AliasDetailsProps> = ({ credential }) : React.ReactNode => {
  const { t } = useTranslation();
  const hasName = Boolean(credential.Alias?.FirstName?.trim() ?? credential.Alias?.LastName?.trim());
  const fullName = [credential.Alias?.FirstName, credential.Alias?.LastName].filter(Boolean).join(' ');

  if (!hasName && !credential.Alias?.NickName && !IdentityHelperUtils.isValidBirthDate(credential.Alias?.BirthDate)) {
    return null;
  }

  return (
    <ThemedView style={styles.section}>
      <ThemedText type="subtitle">{t('credentials.alias')}</ThemedText>
      {hasName && (
        <FormInputCopyToClipboard
          label={t('credentials.fullName')}
          value={fullName}
        />
      )}
      {credential.Alias?.FirstName && (
        <FormInputCopyToClipboard
          label={t('credentials.firstName')}
          value={credential.Alias.FirstName}
        />
      )}
      {credential.Alias?.LastName && (
        <FormInputCopyToClipboard
          label={t('credentials.lastName')}
          value={credential.Alias.LastName}
        />
      )}
      {credential.Alias?.NickName && (
        <FormInputCopyToClipboard
          label={t('credentials.nickName')}
          value={credential.Alias.NickName}
        />
      )}
      {IdentityHelperUtils.isValidBirthDate(credential.Alias?.BirthDate) && (
        <FormInputCopyToClipboard
          label={t('credentials.birthDate')}
          value={IdentityHelperUtils.normalizeBirthDateForDisplay(credential.Alias.BirthDate)}
        />
      )}
    </ThemedView>
  );
};

const styles = {
  section: {
    paddingTop: 16,
    gap: 8,
  },
};