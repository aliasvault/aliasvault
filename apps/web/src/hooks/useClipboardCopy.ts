import { useCallback, useEffect, useState } from 'react';

import { useDb } from '@/context/DbContext';
import { clipboardCopyService } from '@/utils/ClipboardCopyService';

const DEFAULT_CLIPBOARD_CLEAR_SECONDS = 10;

/**
 * Copy a value to the clipboard and know whether this element is the one that was copied last.
 * @param id - the id of the element the value belongs to
 */
export function useClipboardCopy(id: string): { copied: boolean; copyToClipboard: (value: string) => Promise<void> } {
  const dbContext = useDb();
  const [copied, setCopied] = useState(clipboardCopyService.getCopiedId() === id);

  useEffect(() => clipboardCopyService.subscribe((copiedId) => setCopied(copiedId === id)), [id]);

  const copyToClipboard = useCallback(async (value: string): Promise<void> => {
    const stored = dbContext.sqliteClient?.settings.getSetting('ClipboardClearSeconds', String(DEFAULT_CLIPBOARD_CLEAR_SECONDS));
    const clearAfterSeconds = Number.parseInt(stored ?? '', 10);
    await clipboardCopyService.copy(id, value, Number.isNaN(clearAfterSeconds) ? DEFAULT_CLIPBOARD_CLEAR_SECONDS : clearAfterSeconds);
  }, [dbContext.sqliteClient, id]);

  return { copied, copyToClipboard };
}
