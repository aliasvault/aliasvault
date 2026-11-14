import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';

import type { Item } from '@aliasvault/models/vault';

/**
 * Label the header back button with the item's folder, or "Items" when the item is not in a folder.
 * @param item - The item the page shows, or null while it loads
 */
export function useItemBackButtonTitle(item: Item | null): void {
  const { t } = useTranslation();
  const dbContext = useDb();
  const { setBackButtonTitle } = useHeaderButtons();

  useEffect(() => {
    if (item && dbContext?.sqliteClient) {
      const folder = item.FolderId ? dbContext.sqliteClient.folders.getAll().find(f => f.Id === item.FolderId && f.ManifestId === item.ManifestId) : undefined;
      setBackButtonTitle(folder?.Name ?? t('items.title'));
    }
    return (): void => setBackButtonTitle(null);
  }, [item, dbContext?.sqliteClient, setBackButtonTitle, t]);
}
