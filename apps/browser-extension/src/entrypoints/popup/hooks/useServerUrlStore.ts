import { toStoredUrls, validateServerUrlFields } from '@aliasvault/client/platform/ServerUrl';
import { useCallback, useEffect, useRef } from 'react';

import { StorageKeys } from '@/utils/constants/storageKeys';

import type { ServerUrlErrors, ServerUrlFields } from '@aliasvault/client/platform/ServerUrl';

import { storage } from '#imports';

/**
 * Store the self-hosted server URL fields, unless they are invalid.
 */
async function storeServerUrlFields(fields: ServerUrlFields): Promise<void> {
  if (Object.keys(validateServerUrlFields(fields)).length > 0) {
    return;
  }
  const { apiUrl, clientUrl } = toStoredUrls(fields);
  await storage.setItem(StorageKeys.API_URL, apiUrl);
  await storage.setItem(StorageKeys.CLIENT_URL, clientUrl);
}

/**
 * Store self-hosted server URL fields shortly after the last edit (to prevent concurrent storage writes), and right away when the page closes.
 */
export function useServerUrlStore(onValidated: (errors: ServerUrlErrors) => void): {
  schedule: (fields: ServerUrlFields) => void;
  cancel: () => void;
  flush: () => Promise<void>;
} {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<ServerUrlFields | null>(null);

  const cancel = useCallback((): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    pendingRef.current = null;
  }, []);

  const flush = useCallback(async (): Promise<void> => {
    const pending = pendingRef.current;
    cancel();
    if (pending) {
      await storeServerUrlFields(pending);
    }
  }, [cancel]);

  const schedule = useCallback((fields: ServerUrlFields): void => {
    cancel();
    pendingRef.current = fields;
    timerRef.current = setTimeout(() => {
      pendingRef.current = null;
      onValidated(validateServerUrlFields(fields));
      storeServerUrlFields(fields);
    }, 150);
  }, [cancel, onValidated]);

  // Store pending fields when the page closes.
  useEffect(() => (): void => {
    flush();
  }, [flush]);

  return { schedule, cancel, flush };
}
