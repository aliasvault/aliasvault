import { useTranslation } from 'react-i18next';

import { IdentityHelperUtils } from '@/utils/dist/core/identity-generator';
import type { Item } from '@/utils/dist/core/models/vault';
import { getFieldValue, FieldKey } from '@/utils/dist/core/models/vault';

import FormInputCopyToClipboard from '@/components/form/FormInputCopyToClipboard';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';

type AliasDetailsProps = {
  item: Item;
};

/**
 * Alias details component.
 */
export const AliasDetails: React.FC<AliasDetailsProps> = ({ item }) : React.ReactNode => {
  const { t } = useTranslation();
  const firstName = getFieldValue(item, FieldKey.AliasFirstName)?.trim();
  const lastName = getFieldValue(item, FieldKey.AliasLastName)?.trim();
  const birthDate = getFieldValue(item, FieldKey.AliasBirthdate);

  const hasName = Boolean(firstName || lastName);
  const fullName = [firstName, lastName].filter(Boolean).join(' ');

  if (!hasName && !IdentityHelperUtils.isValidBirthDate(birthDate)) {
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
      {firstName && (
        <FormInputCopyToClipboard
          label={t('credentials.firstName')}
          value={firstName}
        />
      )}
      {lastName && (
        <FormInputCopyToClipboard
          label={t('credentials.lastName')}
          value={lastName}
        />
      )}
      {IdentityHelperUtils.isValidBirthDate(birthDate) && (
        <FormInputCopyToClipboard
          label={t('credentials.birthDate')}
          value={IdentityHelperUtils.normalizeBirthDate(birthDate!)}
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