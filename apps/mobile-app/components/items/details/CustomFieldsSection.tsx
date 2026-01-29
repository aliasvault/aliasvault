import { useTranslation } from 'react-i18next';

import type { Item, ItemField } from '@/utils/dist/core/models/vault';

import FieldBlock from '@/components/items/details/FieldBlock';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';

type CustomFieldsSectionProps = {
  item: Item;
};

/**
 * Custom fields section component.
 * Displays all custom fields for an item.
 */
export const CustomFieldsSection: React.FC<CustomFieldsSectionProps> = ({ item }): React.ReactNode => {
  const { t } = useTranslation();

  // Get custom fields from the item
  const customFields = item.Fields.filter(
    (field: ItemField) => field.IsCustomField
  );

  if (customFields.length === 0) {
    return null;
  }

  return (
    <ThemedView style={styles.section}>
      <ThemedText type="subtitle">{t('itemTypes.customFields')}</ThemedText>
      {customFields.map((field: ItemField) => (
        <FieldBlock
          key={field.FieldKey}
          field={field}
          itemId={item.Id}
        />
      ))}
    </ThemedView>
  );
};

const styles = {
  section: {
    paddingTop: 16,
    gap: 8,
  },
};
