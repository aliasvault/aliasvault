import { RECENCY_GROUPS, type RecencyGroup } from '@aliasvault/client/items/ItemSort';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';

type ItemRecencyGroupHeaderProps = {
  group: RecencyGroup | null | undefined;
  isFirst: boolean;
};

/**
 * The date group header above the items of a list sorted by most recent.
 */
export const ItemRecencyGroupHeader: React.FC<ItemRecencyGroupHeaderProps> = ({ group, isFirst }) => {
  const { t } = useTranslation();
  const colors = useColors();

  if (!group) {
    return null;
  }

  const styles = StyleSheet.create({
    header: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.5,
      marginBottom: 8,
      marginTop: isFirst ? 0 : 8,
      textTransform: 'uppercase',
    },
  });

  return <ThemedText style={styles.header}>{t(RECENCY_GROUPS[group])}</ThemedText>;
};
