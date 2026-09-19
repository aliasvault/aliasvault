import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import AddEditItemScreen from '@/components/items/AddEditItemScreen';

/**
 * Edit item screen, shown as a modal.
 */
export default function EditItemScreen(): React.ReactNode {
  const { manifestId, id } = useLocalSearchParams<{ manifestId: string; id: string }>();
  const editRef = useMemo(() => ({ Id: id, ManifestId: manifestId }), [id, manifestId]);

  return <AddEditItemScreen editRef={editRef} />;
}
