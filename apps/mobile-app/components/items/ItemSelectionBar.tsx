import { countSharedItems, describeBulkMove, type BulkMoveSummary, type SelectedItem } from '@aliasvault/client/items/BulkItemActions';
import { TRASH_RETENTION_DEFAULT_DAYS } from '@aliasvault/models/vault';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import Toast from 'react-native-toast-message';

import { useVaultMutate } from '@/hooks/useVaultMutate';

import { SelectionBar, SelectionBarButton } from '@/components/common/SelectionBar';
import { FolderSelectorModal } from '@/components/folders/FolderSelectorModal';
import { useDialog } from '@/context/DialogContext';
import { useDb } from '@/context/DbContext';

import type { Folder, FolderRef } from '@aliasvault/client/database/repositories/FolderRepository';

type ItemSelectionBarProps = {
  selection: SelectedItem[];
  visibleCount: number;
  folders: Folder[];
  personalManifestId: string | null;
  currentFolder: FolderRef | null;
  onSelectAll: () => void;
  onClose: () => void;
  onDone: () => Promise<void>;
};

/**
 * Selection bar of the item list: move and delete the selected items, plus their dialogs.
 */
export function ItemSelectionBar({ selection, visibleCount, folders, personalManifestId, currentFolder, onSelectAll, onClose, onDone }: ItemSelectionBarProps): React.ReactNode {
  const { t } = useTranslation();
  const dbContext = useDb();
  const { showConfirm } = useDialog();
  const { executeVaultMutation } = useVaultMutate();
  const [showMovePicker, setShowMovePicker] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  /** The confirm to show once the move picker has closed; iOS drops an alert shown while a modal is still closing. */
  const afterPickerCloseRef = useRef<(() => void) | null>(null);
  const count = selection.length;

  /**
   * Run a bulk action, then show its success message.
   * @param action - the action, returning the success message
   */
  const runAction = async (action: () => Promise<string>): Promise<void> => {
    if (isWorking) {
      return;
    }
    setIsWorking(true);
    try {
      let message = '';
      await executeVaultMutation(async () => {
        message = await action();
      });
      Toast.show({ type: 'success', text1: message, position: 'bottom' });
      await onDone();
    } catch (error) {
      console.error('Bulk item action failed:', error);
      Toast.show({ type: 'error', text1: t('common.errors.unknownError'), position: 'bottom' });
    } finally {
      setIsWorking(false);
    }
  };

  /**
   * Ask to move the selected items to the trash.
   */
  const confirmDelete = (): void => {
    const sharedCount = countSharedItems(selection, personalManifestId);
    const description = t('items.selection.deleteDescription', { days: TRASH_RETENTION_DEFAULT_DAYS });
    const message = sharedCount > 0 ? `${description}\n\n${t('items.selection.deleteShared')}` : description;
    showConfirm(t('items.selection.deleteTitle', { count }), message, t('common.delete'), () => runAction(async () => {
      const trashed = await dbContext.sqliteClient!.items.trashMany(selection.map(item => ({ Id: item.Id, ManifestId: item.ManifestId })));
      return t('items.selection.deleted', { count: trashed });
    }), { confirmStyle: 'destructive' });
  };

  /**
   * Move items into the target folder.
   */
  const performMove = (summary: BulkMoveSummary, target: FolderRef | null): Promise<void> => runAction(async () => {
    await dbContext.sqliteClient!.items.moveMany(summary.toMove, target);
    const moved = summary.toMove.length;
    const folder = target ? folders.find(f => f.Id === target.Id && f.ManifestId === target.ManifestId)?.Name : undefined;
    return folder ? t('items.selection.movedTo', { count: moved, folder }) : t('items.selection.moved', { count: moved });
  });

  /**
   * Handle the folder picked in the move picker: confirm when the move changes who can see the items.
   */
  const pickMoveTarget = (target: FolderRef | null): void => {
    const summary = describeBulkMove(selection, target, personalManifestId);
    if (summary.toMove.length === 0) {
      return;
    }
    if (!summary.toShared && !summary.fromShared) {
      void performMove(summary, target);
      return;
    }
    const moved = summary.toMove.length;
    const message = [
      summary.toShared ? t('items.selection.moveIntoShared') : null,
      summary.fromShared ? t('items.selection.moveOutOfShared') : null,
    ].filter(Boolean).join('\n\n');
    afterPickerCloseRef.current = (): void => showConfirm(t('items.selection.moveTitle', { count: moved }), message, t('items.selection.move'), () => performMove(summary, target));
    if (Platform.OS !== 'ios') {
      runAfterPickerClose();
    }
  };

  /**
   * Run what waits for the move picker to close, once.
   */
  const runAfterPickerClose = (): void => {
    const action = afterPickerCloseRef.current;
    afterPickerCloseRef.current = null;
    action?.();
  };

  return (
    <>
      <SelectionBar count={count} visibleCount={visibleCount} onSelectAll={onSelectAll} onClose={onClose}>
        <SelectionBarButton icon="drive-file-move" label={t('items.selection.move')} onPress={() => setShowMovePicker(true)} disabled={count === 0 || isWorking} testID="selection-move" />
        <SelectionBarButton icon="delete" label={t('common.delete')} onPress={confirmDelete} disabled={count === 0 || isWorking} danger testID="selection-delete" />
      </SelectionBar>
      <FolderSelectorModal
        folders={folders}
        selectedFolder={currentFolder}
        personalManifestId={personalManifestId}
        onFolderChange={pickMoveTarget}
        isOpen={showMovePicker}
        onClose={() => setShowMovePicker(false)}
        onDismiss={runAfterPickerClose}
      />
    </>
  );
}
