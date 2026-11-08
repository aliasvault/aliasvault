import React, { useState } from 'react';
import { Platform, StyleSheet, View, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from 'react-native';
import ContextMenu, { type ContextMenuAction, type ContextMenuOnPressNativeEvent } from 'react-native-context-menu-view';

import { SelectCheckbox } from '@/components/common/SelectCheckbox';
import { CONTEXT_MENU_DISMISS_MS, ListRowPressable } from '@/components/ui/ListRowPressable';
import { useColors } from '@/hooks/useColorScheme';
import { useSelectionPressPreview } from '@/hooks/useSelectionPressPreview';
import { blendColors } from '@/utils/ColorUtility';
import { HapticsUtility } from '@/utils/HapticsUtility';

type SelectableListRowProps = {
  style: StyleProp<ViewStyle>;
  selectionMode: boolean;
  isSelected: boolean;
  onToggleSelect?: () => void;
  onOpen: () => void;
  menu?: { title?: string; actions: ContextMenuAction[]; onPress: (event: NativeSyntheticEvent<ContextMenuOnPressNativeEvent>) => void };
  checkboxAlign?: 'center' | 'top';
  testID?: string;
  accessibilityLabel?: string;
  children: React.ReactNode;
};

/**
 * A list row that can be selected.
 */
export function SelectableListRow({ style, selectionMode, isSelected, onToggleSelect, onOpen, menu, checkboxAlign = 'center', testID, accessibilityLabel, children }: SelectableListRowProps): React.ReactNode {
  const colors = useColors();
  const { shownSelected, onPressIn, onPressOut } = useSelectionPressPreview(selectionMode, isSelected);
  /**
   * True while the iOS context menu closes after an action. iOS keeps the row itself away until its close animation
   * ends, so a copy of the row covers its spot meanwhile.
   */
  const [covering, setCovering] = useState(false);

  const styles = StyleSheet.create({
    content: {
      flex: 1,
    },
    row: {
      alignItems: checkboxAlign === 'top' ? 'flex-start' : 'center',
      flexDirection: 'row',
    },
    selected: {
      backgroundColor: blendColors(colors.accentBackground, colors.primary, 0.1),
      borderColor: colors.primary,
      borderWidth: 1,
      padding: 11,
    },
  });

  const rowStyle = [style, shownSelected && styles.selected];

  const content = (
    <View style={styles.row}>
      {selectionMode && <SelectCheckbox isSelected={shownSelected} />}
      <View style={styles.content}>{children}</View>
    </View>
  );

  const row = (
    <ListRowPressable
      style={rowStyle}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={() => (selectionMode && onToggleSelect ? onToggleSelect() : onOpen())}
      onLongPress={() => {
        // Android starts selecting on a long-press; on iOS the long-press belongs to the context menu around the row.
        if (Platform.OS === 'android' && onToggleSelect) {
          HapticsUtility.impact();
          onToggleSelect();
        }
      }}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={selectionMode ? { selected: isSelected } : undefined}
    >
      {content}
    </ListRowPressable>
  );

  if (Platform.OS === 'android' || !menu) {
    return row;
  }

  /**
   * Run the picked menu entry, with the cover copy shown until the menu has closed.
   */
  const handleMenuPress = (event: NativeSyntheticEvent<ContextMenuOnPressNativeEvent>): void => {
    setCovering(true);
    setTimeout(() => setCovering(false), CONTEXT_MENU_DISMISS_MS);
    menu.onPress(event);
  };

  return (
    <View>
      <ContextMenu title={menu.title} actions={menu.actions} onPress={handleMenuPress} previewBackgroundColor={colors.accentBackground}>
        {row}
      </ContextMenu>
      {covering && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <View style={rowStyle}>{content}</View>
        </View>
      )}
    </View>
  );
}
