import { urlsOf } from '@aliasvault/client/items/MergeSuggestions';
import React from 'react';

import type { Item } from '@aliasvault/models/vault';

/**
 * The first URL of an item without its scheme; nothing when it has none.
 */
const ItemUrlLine: React.FC<{ item: Item; className?: string }> = ({ item, className = '' }) => {
  const url = urlsOf(item)[0]?.trim();
  if (!url) {
    return null;
  }
  return (
    <span className={`block truncate text-gray-500 dark:text-gray-400 ${className}`}>{url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/$/, '')}</span>
  );
};

export default ItemUrlLine;
