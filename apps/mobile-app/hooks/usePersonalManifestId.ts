import { useEffect, useState } from 'react';

import { useDb } from '@/context/DbContext';

/**
 * The id of the user's personal manifest, which is what tells a shared manifest apart from the user's own.
 */
export function usePersonalManifestId(): string | null {
  const { sqliteClient, dbAvailable, isSyncing } = useDb();
  const [personalManifestId, setPersonalManifestId] = useState<string | null>(null);

  useEffect(() => {
    if (!sqliteClient || !dbAvailable || isSyncing) {
      return;
    }

    let cancelled = false;
    sqliteClient.getPersonalManifestId().then((id) => {
      if (!cancelled) {
        setPersonalManifestId(id);
      }
    }).catch(() => {
      // Without the id no folder is marked as shared, which is the safe reading of an unknown.
    });

    return (): void => {
      cancelled = true;
    };
  }, [sqliteClient, dbAvailable, isSyncing]);

  return personalManifestId;
}
