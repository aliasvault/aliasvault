import { isSharedFolder } from '@aliasvault/client/items/FolderUtils';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { usePersonalManifestId } from '@/hooks/usePersonalManifestId';
import type { ScreenParams } from '@/hooks/useTwoPane';

import { FolderHeaderTitle } from '@/components/folders/FolderHeaderTitle';

type FolderRouteTitleProps = {
  params: ScreenParams;
  isHidden?: boolean;
};

/**
 * Header title of a folder route, from its params. Hiding it keeps the native title view in place.
 */
export function FolderRouteTitle({ params, isHidden = false }: FolderRouteTitleProps): React.ReactNode {
  const { t } = useTranslation();
  const personalManifestId = usePersonalManifestId();
  return (
    <View style={isHidden && styles.hidden} pointerEvents={isHidden ? 'none' : 'auto'}>
      <FolderHeaderTitle name={params.name || t('items.folders.folder')} isShared={isSharedFolder({ ManifestId: params.manifestId ?? '' }, personalManifestId)} />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    opacity: 0,
  },
});
