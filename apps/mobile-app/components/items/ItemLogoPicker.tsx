import { effectiveItemLogo } from '@aliasvault/client/items/ItemLogoView';
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';

import type { DisplayItem } from '@/utils/DisplayItem';

import { useColors } from '@/hooks/useColorScheme';

import { ItemIcon } from '@/components/items/ItemIcon';
import { LogoPickerModal } from '@/components/items/LogoPickerModal';
import { RobustPressable } from '@/components/ui/RobustPressable';

import type { LogoSelection } from '@aliasvault/models/vault';

type ItemLogoPickerProps = {
  item: DisplayItem;
  pendingSelection?: LogoSelection;
  faviconSource?: string | null;
  websiteSource?: string | null;
  isFetching?: boolean;
  onSelect: (selection: LogoSelection) => void;
  onFetchFromWebsite: () => void;
};

/**
 * The item's icon on the edit screen: shows what the item will look like and opens the picker.
 */
export const ItemLogoPicker: React.FC<ItemLogoPickerProps> = ({ item, pendingSelection, faviconSource, websiteSource, isFetching = false, onSelect, onFetchFromWebsite }) => {
  const colors = useColors();
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const effectiveLogo = effectiveItemLogo(item.LogoInfo, pendingSelection, faviconSource);

  const styles = StyleSheet.create({
    button: {
      alignItems: 'center',
      alignSelf: 'stretch',
      borderRightColor: colors.accentBorder,
      borderRightWidth: 1,
      justifyContent: 'center',
      minWidth: 52,
      paddingHorizontal: 10,
    },
    icon: {
      borderRadius: 6,
      height: 28,
      width: 28,
    },
  });

  return (
    <>
      <RobustPressable
        style={styles.button}
        onPress={() => setIsPickerOpen(true)}
        testID="item-logo-picker"
      >
        {isFetching ? (
          <ActivityIndicator size="small" color={colors.textMuted} />
        ) : (
          <ItemIcon item={{ ...item, LogoInfo: effectiveLogo }} style={styles.icon} />
        )}
      </RobustPressable>

      <LogoPickerModal
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        item={item}
        currentLogo={effectiveLogo}
        websiteSource={websiteSource}
        onSelect={onSelect}
        onFetchFromWebsite={onFetchFromWebsite}
      />
    </>
  );
};

export default ItemLogoPicker;
