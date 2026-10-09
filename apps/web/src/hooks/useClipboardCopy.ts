import { getOrCreateDeviceId } from '@aliasvault/client/platform/DeviceId';
import { useCallback, useEffect, useState } from 'react';

import { useDb } from '@/context/DbContext';
import { useVaultMutate } from '@/hooks/useVaultMutate';
import { clipboardCopyService } from '@/utils/ClipboardCopyService';
import { devLog } from '@/utils/DevLogger';

import type { ItemRef } from '@aliasvault/client/database/ItemRef';

const DEFAULT_CLIPBOARD_CLEAR_SECONDS = 10;

/**
 * Copy a value to the clipboard and know whether this element is the one that was copied last.
 * @param id - the id of the element the value belongs to
 * @param item - the item the value belongs to, whose usage stats count the copy
 */
export function useClipboardCopy(id: string, item?: ItemRef): { copied: boolean; copyToClipboard: (value: string) => Promise<void> } {
  const dbContext = useDb();
  const { executeVaultMutationInBackground } = useVaultMutate();
  const [copied, setCopied] = useState(clipboardCopyService.getCopiedId() === id);
  const itemId = item?.Id;
  const manifestId = item?.ManifestId;

  useEffect(() => clipboardCopyService.subscribe((copiedId) => setCopied(copiedId === id)), [id]);

  const copyToClipboard = useCallback(async (value: string): Promise<void> => {
    const stored = dbContext.sqliteClient?.settings.getSetting('ClipboardClearSeconds', String(DEFAULT_CLIPBOARD_CLEAR_SECONDS));
    const clearAfterSeconds = Number.parseInt(stored ?? '', 10);
    const success = await clipboardCopyService.copy(id, value, Number.isNaN(clearAfterSeconds) ? DEFAULT_CLIPBOARD_CLEAR_SECONDS : clearAfterSeconds);
    if (!success || !itemId || !manifestId) {
      return;
    }

    // Stats-only writes push silently, without the sync indicator.
    executeVaultMutationInBackground(async () => {
      const deviceId = await getOrCreateDeviceId();
      if (!dbContext.sqliteClient?.itemStats.recordUsage({ Id: itemId, ManifestId: manifestId }, 'copy', deviceId)) {
        throw new Error('Item not found');
      }
    }).catch((error) => devLog('[Clipboard] Failed to record item usage', error));
  }, [dbContext.sqliteClient, executeVaultMutationInBackground, id, itemId, manifestId]);

  return { copied, copyToClipboard };
}
