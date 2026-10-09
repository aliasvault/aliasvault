import { useTranslation } from 'react-i18next';

import { IdentityHelperUtils } from '@aliasvault/models/identity';
import type { Item } from '@aliasvault/models/vault';
import { getFieldValue, FieldKey } from '@aliasvault/models/vault';

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
      <ThemedText type="subtitle">{t('common.alias')}</ThemedText>
      {hasName && (
        <FormInputCopyToClipboard
          item={item}
          label={t('items.fullName')}
          value={fullName}
        />
      )}
      {firstName && (
        <FormInputCopyToClipboard
          item={item}
          label={t('fieldLabels.alias.first_name')}
          value={firstName}
        />
      )}
      {lastName && (
        <FormInputCopyToClipboard
          item={item}
          label={t('fieldLabels.alias.last_name')}
          value={lastName}
        />
      )}
      {IdentityHelperUtils.isValidBirthDate(birthDate) && (
        <FormInputCopyToClipboard
          item={item}
          label={t('fieldLabels.alias.birthdate')}
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