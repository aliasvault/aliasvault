import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { ItemFormPage } from '@/components/items/ItemFormPage';

/**
 * Edit item screen as a page, the deep link target.
 */
export default function EditItemPageScreen(): React.ReactNode {
  const { manifestId, id } = useLocalSearchParams<{ manifestId: string; id: string }>();
  const editRef = useMemo(() => ({ Id: id, ManifestId: manifestId }), [id, manifestId]);

  return <ItemFormPage editRef={editRef} />;
}
