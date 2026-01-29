import { useTranslation } from 'react-i18next';

import type { Item, ItemField } from '@/utils/dist/core/models/vault';
import { FieldCategories, groupFieldsByCategory, ItemTypes } from '@/utils/dist/core/models/vault';

import FieldBlock from '@/components/items/details/FieldBlock';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';

type CardDetailsProps = {
  item: Item;
};

/**
 * Card details component for credit card items.
 * Uses FieldBlock for automatic field type handling.
 */
export const CardDetails: React.FC<CardDetailsProps> = ({ item }): React.ReactNode => {
  const { t } = useTranslation();

  // Only show for CreditCard type
  if (item.ItemType !== ItemTypes.CreditCard) {
    return null;
  }

  // Group fields by category and get card fields (already sorted by DisplayOrder)
  const groupedFields = groupFieldsByCategory(item);
  const cardFields = groupedFields[FieldCategories.Card] ?? [];

  if (cardFields.length === 0) {
    return null;
  }

  return (
    <ThemedView style={styles.section}>
      <ThemedText type="subtitle">{t('items.cardInformation')}</ThemedText>

      {/* Render card fields using FieldBlock */}
      {cardFields.map((field: ItemField) => (
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
