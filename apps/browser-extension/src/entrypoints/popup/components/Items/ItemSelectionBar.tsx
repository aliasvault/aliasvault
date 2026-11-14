import { countSharedItems, describeBulkMove, type BulkMoveSummary, type SelectedItem } from '@aliasvault/client/items/BulkItemActions';
import { TRASH_RETENTION_DEFAULT_DAYS } from '@aliasvault/models/vault';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import ConfirmDeleteModal from '@/entrypoints/popup/components/Dialogs/ConfirmDeleteModal';
import FolderPickerModal from '@/entrypoints/popup/components/Items/FolderPickerModal';
import ItemMergeForm from '@/entrypoints/popup/components/Items/ItemMergeForm';
import SelectionBar, { SelectionBarButton } from '@/entrypoints/popup/components/SelectionBar';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useVaultMutate } from '@/entrypoints/popup/hooks/useVaultMutate';

import { itemRoute } from '@/utils/ItemRoute';

import type { ItemRef } from '@aliasvault/client/database/ItemRef';
import type { FolderRef } from '@aliasvault/client/database/repositories/FolderRepository';

type ItemSelectionBarProps = {
  selection: SelectedItem[];
  visibleCount: number;
  currentFolder: FolderRef | null;
  onSelectAll: () => void;
  onClose: () => void;
  onDone: () => void;
  onDialogOpenChange: (isOpen: boolean) => void;
};

/** A move waiting for the user to confirm it. */
type PendingMove = { summary: BulkMoveSummary; target: FolderRef | null };

/**
 * Selection bar of the item list: move, merge and delete the selected items, plus their dialogs.
 */
const ItemSelectionBar: React.FC<ItemSelectionBarProps> = ({ selection, visibleCount, currentFolder, onSelectAll, onClose, onDone, onDialogOpenChange }) => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const { executeVaultMutationAsync } = useVaultMutate();
  const navigate = useNavigate();
  const [showMovePicker, setShowMovePicker] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const personalManifestId = dbContext?.sqliteClient?.getPersonalManifestId() ?? null;
  const count = selection.length;
  const sharedCount = countSharedItems(selection, personalManifestId);

  const mergePair = useMemo((): [ItemRef, ItemRef] | null => (selection.length === 2 ? [selection[0], selection[1]] : null), [selection]);

  const dialogOpen = showMovePicker || showDeleteModal || showMerge || pendingMove !== null;
  /**
   * Run a bulk action, then close its dialogs and leave selection mode.
   */
  const runAction = async (action: () => Promise<void>): Promise<void> => {
    if (isWorking) {
      return;
    }
    setIsWorking(true);
    try {
      await executeVaultMutationAsync(action);
      setShowDeleteModal(false);
      setPendingMove(null);
      onDone();
    } finally {
      setIsWorking(false);
    }
  };

  /**
   * Move the selected items to the trash.
   */
  const confirmDelete = (): Promise<void> => runAction(async () => {
    await dbContext.sqliteClient!.items.trashMany(selection.map(item => ({ Id: item.Id, ManifestId: item.ManifestId })));
  });

  /**
   * Move items into the target folder.
   */
  const performMove = (move: PendingMove): Promise<void> => runAction(async () => {
    await dbContext.sqliteClient!.items.moveMany(move.summary.toMove, move.target);
  });

  /**
   * Handle the folder picked in the move picker: confirm when the move changes ownership/access (e.g. from personal to shared).
   */
  const pickMoveTarget = (target: FolderRef | null): void => {
    const summary = describeBulkMove(selection, target, personalManifestId);
    if (summary.toMove.length === 0) {
      return;
    }
    if (summary.toShared || summary.fromShared) {
      setPendingMove({ summary, target });
      return;
    }
    void performMove({ summary, target });
  };

  return (
    <>
      <SelectionBar count={count} visibleCount={visibleCount} onSelectAll={onSelectAll} onClose={onClose} dialogOpen={dialogOpen} onDialogOpenChange={onDialogOpenChange}>
        <SelectionBarButton id="selection-move" icon="folder" label={t('items.selection.move')} onClick={() => setShowMovePicker(true)} disabled={count === 0 || isWorking} />
        <SelectionBarButton id="selection-merge" icon="merge" label={t('items.merge.title')} onClick={() => setShowMerge(true)} disabled={!mergePair || isWorking} />
        <SelectionBarButton id="selection-delete" icon="trash" label={t('common.delete')} onClick={() => setShowDeleteModal(true)} disabled={count === 0 || isWorking} danger />
      </SelectionBar>

      {showMerge && mergePair && (
        <ItemMergeForm
          items={mergePair}
          onClose={() => setShowMerge(false)}
          onMerged={item => {
            setShowMerge(false);
            onDone();
            navigate(itemRoute(item));
          }}
        />
      )}

      {showMovePicker && (
        <FolderPickerModal selected={currentFolder} onSelect={pickMoveTarget} onClose={() => setShowMovePicker(false)} />
      )}

      <ConfirmDeleteModal
        isOpen={pendingMove !== null}
        onClose={() => !isWorking && setPendingMove(null)}
        onConfirm={() => pendingMove && void performMove(pendingMove)}
        title={t('items.selection.moveTitle', { count: pendingMove?.summary.toMove.length ?? 0 })}
        warning={pendingMove ? [
          pendingMove.summary.toShared ? t('items.selection.moveIntoShared') : null,
          pendingMove.summary.fromShared ? t('items.selection.moveOutOfShared') : null,
        ].filter(Boolean).join('\n\n') : undefined}
        confirmText={t('items.selection.move')}
        variant="primary"
      />

      <ConfirmDeleteModal
        isOpen={showDeleteModal}
        onClose={() => !isWorking && setShowDeleteModal(false)}
        onConfirm={() => void confirmDelete()}
        title={t('items.selection.deleteTitle', { count })}
        message={t('items.selection.deleteDescription', { days: TRASH_RETENTION_DEFAULT_DAYS })}
        warning={sharedCount > 0 ? t('items.selection.deleteShared') : undefined}
        confirmText={t('common.delete')}
      />
    </>
  );
};

export default ItemSelectionBar;
