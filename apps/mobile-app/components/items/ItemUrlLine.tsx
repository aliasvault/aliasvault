import { urlsOf } from '@aliasvault/client/items/MergeSuggestions';
import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import type { Item } from '@aliasvault/models/vault';

/**
 * The first URL of an item without its scheme; nothing when it has none.
 */
export function ItemUrlLine({ item, style }: { item: Item; style?: StyleProp<TextStyle> }): React.ReactNode {
  const colors = useColors();
  const url = urlsOf(item)[0]?.trim();
  if (!url) {
    return null;
  }
  return (
    <Text style={[{ color: colors.textMuted, fontSize: 12 }, style]} numberOfLines={1}>
      {url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/$/, '')}
    </Text>
  );
}
