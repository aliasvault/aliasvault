import type { Item, ItemField } from '@/utils/dist/core/models/vault';

import FieldBlock from '@/components/items/details/FieldBlock';
import { ThemedView } from '@/components/themed/ThemedView';

type CustomFieldsSectionProps = {
  item: Item;
};

/**
 * Custom fields section component.
 * Displays all custom fields for an item.
 */
export const CustomFieldsSection: React.FC<CustomFieldsSectionProps> = ({ item }): React.ReactNode => {
  const customFields = item.Fields.filter(
    (field: ItemField) => field.IsCustomField
  );

  if (customFields.length === 0) {
    return null;
  }

  return (
    <ThemedView style={styles.section}>
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
