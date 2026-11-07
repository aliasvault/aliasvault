import { countSharedItems, describeBulkMove, type BulkMoveSummary, type SelectedItem } from '@aliasvault/client/items/BulkItemActions';
import { TRASH_RETENTION_DEFAULT_DAYS } from '@aliasvault/models/vault';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ConfirmDeleteModal from '@/entrypoints/popup/components/Dialogs/ConfirmDeleteModal';
import Icon from '@/entrypoints/popup/components/Icons/Icon';
import FolderPickerModal from '@/entrypoints/popup/components/Items/FolderPickerModal';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useVaultMutate } from '@/entrypoints/popup/hooks/useVaultMutate';

import type { FolderRef } from '@aliasvault/client/database/repositories/FolderRepository';

type SelectionActionBarProps = {
  selection: SelectedItem[];
  visibleCount: number;
  currentFolder: FolderRef | null;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onClose: () => void;
  onDone: () => void;
  onDialogOpenChange: (isOpen: boolean) => void;
};

/** A move waiting for the user to confirm it. */
type PendingMove = { summary: BulkMoveSummary; target: FolderRef | null };

/**
 * Floating bar above the bottom navigation with the bulk actions for the selected items.
 */
const SelectionActionBar: React.FC<SelectionActionBarProps> = ({ selection, visibleCount, currentFolder, onSelectAll, onDeselectAll, onClose, onDone, onDialogOpenChange }) => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const { executeVaultMutationAsync } = useVaultMutate();
  const [showMovePicker, setShowMovePicker] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const personalManifestId = dbContext?.sqliteClient?.getPersonalManifestId() ?? null;
  const count = selection.length;
  const allSelected = count > 0 && count >= visibleCount;
  const sharedCount = countSharedItems(selection, personalManifestId);

  const dialogOpen = showMovePicker || showDeleteModal || pendingMove !== null;
  const dialogOpenRef = useRef(false);
  dialogOpenRef.current = dialogOpen;

  useEffect(() => {
    onDialogOpenChange(dialogOpen);
  }, [dialogOpen, onDialogOpenChange]);
  useEffect(() => (): void => onDialogOpenChange(false), [onDialogOpenChange]);

  useEffect(() => {
    /**
     * Escape leaves selection mode.
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !dialogOpenRef.current) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return (): void => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

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

  const buttonClass = 'inline-flex items-center justify-center rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
  const iconButtonClass = `${buttonClass} w-8 h-8 text-gray-800 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-600`;

  return (
    <>
      <div className="h-16" aria-hidden />
      <div id="selection-action-bar" role="toolbar" aria-label={t('items.selection.count', { count })} className="fixed bottom-[65px] left-3 right-3 z-20 flex items-center gap-1 p-1.5 rounded-xl bg-white ring-1 ring-gray-300 shadow-[0_12px_32px_-4px_rgba(0,0,0,0.25),0_4px_10px_-2px_rgba(0,0,0,0.12)] dark:bg-gray-700 dark:ring-gray-500 dark:shadow-[0_12px_32px_0_rgba(0,0,0,0.6),0_4px_10px_rgba(0,0,0,0.4)]">
        <button type="button" onClick={onClose} title={t('common.close')} aria-label={t('common.close')} className={`${buttonClass} w-8 h-8 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-200 dark:hover:bg-gray-600 dark:hover:text-white`}>
          <Icon name="x" className="w-[18px] h-[18px]" />
        </button>
        <span className="pl-1.5 pr-1 text-sm font-medium whitespace-nowrap tabular-nums text-gray-900 dark:text-white" aria-live="polite">{t('items.selection.count', { count })}</span>
        <span aria-hidden className="h-5 w-px mx-1 bg-gray-300 dark:bg-gray-500" />
        <button type="button" onClick={allSelected ? onDeselectAll : onSelectAll} className={`${buttonClass} gap-1.5 px-2 h-8 text-sm font-medium whitespace-nowrap text-gray-800 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-600`}>
          <Icon name={allSelected ? 'square-feather' : 'square-check'} className="w-4 h-4" />
          {allSelected ? t('items.selection.deselectAll') : t('items.selection.selectAll')}
        </button>
        <div className="flex-1" />
        <button type="button" id="selection-move" onClick={() => setShowMovePicker(true)} disabled={count === 0 || isWorking} title={t('items.selection.move')} aria-label={t('items.selection.move')} className={iconButtonClass}>
          <Icon name="folder" className="w-[18px] h-[18px]" />
        </button>
        <button type="button" id="selection-delete" onClick={() => setShowDeleteModal(true)} disabled={count === 0 || isWorking} title={t('common.delete')} aria-label={t('common.delete')} className={`${buttonClass} w-8 h-8 text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/20`}>
          <Icon name="trash" className="w-[18px] h-[18px]" />
        </button>
      </div>

      {showMovePicker && (
        <FolderPickerModal selected={currentFolder} onSelect={pickMoveTarget} onClose={() => setShowMovePicker(false)} />
      )}

      <ConfirmDeleteModal
        isOpen={pendingMove !== null}
        onClose={() => !isWorking && setPendingMove(null)}
        onConfirm={() => pendingMove && void performMove(pendingMove)}
        title={t('items.selection.moveTitle', { count: pendingMove?.summary.toMove.length ?? 0 })}
        warning={pendingMove ? [
          pendingMove.summary.toShared ? t('items.selection.moveIntoShared', { count: pendingMove.summary.toMove.length }) : null,
          pendingMove.summary.fromShared ? t('items.selection.moveOutOfShared', { count: pendingMove.summary.toMove.length }) : null,
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
        warning={sharedCount > 0 ? t('items.selection.deleteShared', { count: sharedCount }) : undefined}
        confirmText={t('common.delete')}
      />
    </>
  );
};

export default SelectionActionBar;
