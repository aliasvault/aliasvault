import { FaviconService } from '@aliasvault/client/items/FaviconService';
import { FieldKey } from '@aliasvault/models/vault';
import { useCallback } from 'react';

import { useDb } from '@/context/DbContext';
import { useWebApi } from '@/context/WebApiContext';
import { useVaultMutate } from '@/hooks/useVaultMutate';
import { type ItemEdit, itemEditToItem } from '@/models/ItemEdit';

import type { ItemRef } from '@aliasvault/client/database/ItemRef';

/**
 * How an item form is saved.
 */
export type SaveItemOptions = {
  original?: ItemRef;
  originalAttachmentIds?: string[];
  originalTotpCodeIds?: string[];
  deletePasskeys?: boolean;
};

/**
 * Save an item form to the vault and push it to the server.
 */
export function useSaveItem(): { saveItem: (edit: ItemEdit, options?: SaveItemOptions) => Promise<ItemRef> } {
  const dbContext = useDb();
  const webApi = useWebApi();
  const { executeVaultMutationAsync } = useVaultMutate();

  const saveItem = useCallback(async (edit: ItemEdit, options: SaveItemOptions = {}): Promise<ItemRef> => {
    const client = dbContext.sqliteClient;
    if (!client) {
      throw new Error('Vault is locked');
    }

    let item = itemEditToItem(edit);
    const urlValue = item.Fields.find(f => f.FieldKey === FieldKey.LoginUrl)?.Value;
    if (urlValue && urlValue.length > 0) {
      item = await FaviconService.fetchAndAttachFavicon(item, urlValue, client.logos, webApi);
    } else {
      item.Logo = undefined;
    }

    let saved: ItemRef = { Id: item.Id, ManifestId: item.ManifestId };
    await executeVaultMutationAsync(async () => {
      const original = options.original;
      if (original) {
        // A folder change can move the item to another manifest; the update reports where it ended up.
        saved = await client.items.update(original, item, options.originalAttachmentIds ?? [], edit.Attachments, options.originalTotpCodeIds ?? [], edit.TotpCodes) ?? original;
        if (options.deletePasskeys) {
          for (const passkey of edit.Passkeys) {
            await client.passkeys.deleteById(passkey.Id, saved.ManifestId);
          }
        }
      } else {
        saved = await client.items.create(item, edit.Attachments.filter(a => !a.IsDeleted), edit.TotpCodes.filter(c => !c.IsDeleted));
      }
    });

    return saved;
  }, [dbContext.sqliteClient, executeVaultMutationAsync, webApi]);

  return { saveItem };
}
