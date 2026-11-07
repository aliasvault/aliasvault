import { countSharedItems, describeBulkMove, type BulkMoveSummary, type SelectedItem } from '@aliasvault/client/items/BulkItemActions';
import { TRASH_RETENTION_DEFAULT_DAYS } from '@aliasvault/models/vault';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import FolderPickerModal from '@/components/items/FolderPickerModal';
import FormModal from '@/components/shared/FormModal';
import Icon from '@/components/shared/Icon';
import { useDb } from '@/context/DbContext';
import { type NotificationLink, useNotifications } from '@/context/NotificationContext';
import { isTypingTarget } from '@/hooks/useKeyboardShortcut';
import { useVaultMutate, VaultPushFailedError } from '@/hooks/useVaultMutate';
import { folderRoute } from '@/utils/ItemRoute';

import type { FolderRef } from '@aliasvault/client/database/repositories/FolderRepository';

type SelectionActionBarProps = {
  selection: SelectedItem[];
  visibleCount: number;
  currentFolder: FolderRef | null;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onClose: () => void;
  onDone: () => void;
};

/** A move waiting for the user to confirm it. */
type PendingMove = { summary: BulkMoveSummary; target: FolderRef | null };

/**
 * Floating bar with the bulk actions for the selected items, plus their dialogs.
 */
const SelectionActionBar: React.FC<SelectionActionBarProps> = ({ selection, visibleCount, currentFolder, onSelectAll, onDeselectAll, onClose, onDone }) => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const notifications = useNotifications();
  const navigate = useNavigate();
  const { executeVaultMutationAsync } = useVaultMutate();
  const [showMovePicker, setShowMovePicker] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const personalManifestId = dbContext.sqliteClient?.getPersonalManifestId() ?? null;
  const count = selection.length;
  const allSelected = count > 0 && count >= visibleCount;
  const sharedCount = countSharedItems(selection, personalManifestId);

  const dialogOpenRef = useRef(false);
  dialogOpenRef.current = showMovePicker || showDeleteModal || pendingMove !== null;

  useEffect(() => {
    /**
     * Escape leaves selection mode, Cmd/Ctrl+A selects all visible items.
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (dialogOpenRef.current || isTypingTarget()) {
        return;
      }
      if (event.key === 'Escape') {
        onClose();
      } else if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        onSelectAll();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return (): void => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose, onSelectAll]);

  /**
   * Run bulk action.
   * @param action - the action to run, returning the success message and an optional link in it
   */
  const runAction = async (action: () => Promise<{ message: string; link?: NotificationLink }>): Promise<void> => {
    if (isWorking) {
      return;
    }
    setIsWorking(true);
    try {
      let result: { message: string; link?: NotificationLink } = { message: '' };
      await executeVaultMutationAsync(async () => {
        result = await action();
      });
      notifications.addSuccessMessage(result.message, true, result.link);
      setShowDeleteModal(false);
      setPendingMove(null);
      onDone();
    } catch (error) {
      // Failed push (e.g. server not reachable).
      if (!(error instanceof VaultPushFailedError)) {
        console.error('Bulk item action failed:', error);
        notifications.addErrorMessage(t('common.errorGeneric'), true);
      }
    } finally {
      setIsWorking(false);
    }
  };

  /**
   * Move the selected items to the trash.
   */
  const confirmDelete = (): Promise<void> => runAction(async () => {
    const trashed = await dbContext.sqliteClient!.items.trashMany(selection.map(item => ({ Id: item.Id, ManifestId: item.ManifestId })));
    return { message: t('items.selection.deleted', { count: trashed }) };
  });

  /**
   * Move items into the target folder.
   */
  const performMove = (move: PendingMove): Promise<void> => runAction(async () => {
    const client = dbContext.sqliteClient!;
    await client.items.moveMany(move.summary.toMove, move.target);
    const count = move.summary.toMove.length;
    const target = move.target;
    const folder = target ? client.folders.getAll().find(f => f.Id === target.Id && f.ManifestId === target.ManifestId)?.Name : undefined;
    if (!target || !folder) {
      return { message: t('items.selection.moved', { count }) };
    }
    /**
     * Go to the folder the items moved into.
     */
    const openFolder = (): void => {
      void navigate(folderRoute(target));
    };
    return { message: t('items.selection.movedTo', { count, folder }), link: { text: folder, onClick: openFolder } };
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

  const buttonClass = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full transition-colors hover:bg-white/10 dark:hover:bg-gray-900/10 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400';

  return (
    <>
      {/* Room below the list so the bar never covers the last items. */}
      <div className="h-20" aria-hidden />
      <div className="fixed bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] sm:w-auto">
        <div id="selection-action-bar" role="toolbar" aria-label={t('items.selection.count', { count })} className="flex items-center gap-1 rounded-full bg-gray-900 text-white shadow-xl ring-1 ring-black/10 dark:bg-gray-100 dark:text-gray-900 dark:shadow-black/50 dark:ring-white/20 pl-4 pr-1.5 py-1.5">
          <span className="text-sm font-medium whitespace-nowrap mr-auto sm:mr-2">{t('items.selection.count', { count })}</span>
          <span aria-hidden className="h-5 w-px mx-1 bg-white/25 dark:bg-gray-900/20" />
          <button type="button" onClick={allSelected ? onDeselectAll : onSelectAll} title={allSelected ? t('items.selection.deselectAll') : t('items.selection.selectAll')} className={buttonClass}>
            <Icon name={allSelected ? 'square-feather' : 'square-check'} className="w-4 h-4" />
            <span className="hidden sm:inline">{allSelected ? t('items.selection.deselectAll') : t('items.selection.selectAll')}</span>
          </button>
          <button type="button" id="selection-move" onClick={() => setShowMovePicker(true)} disabled={count === 0 || isWorking} title={t('items.selection.move')} className={buttonClass}>
            <Icon name="folder" className="w-4 h-4" />
            <span className="hidden sm:inline">{t('items.selection.move')}</span>
          </button>
          <button type="button" id="selection-delete" onClick={() => setShowDeleteModal(true)} disabled={count === 0 || isWorking} title={t('common.delete')} className={`${buttonClass} text-red-400 hover:text-red-300 dark:text-red-600 dark:hover:text-red-700`}>
            <Icon name="trash" className="w-4 h-4" />
            <span className="hidden sm:inline">{t('common.delete')}</span>
          </button>
          <button type="button" onClick={onClose} aria-label={t('common.close')} title={t('common.close')} className={`${buttonClass} px-2`}>
            <Icon name="x" className="w-4 h-4" />
          </button>
        </div>
      </div>

      {showMovePicker && (
        <FolderPickerModal selected={currentFolder} onSelect={pickMoveTarget} onClose={() => setShowMovePicker(false)} />
      )}

      <FormModal
        isOpen={pendingMove !== null}
        title={t('items.selection.moveTitle', { count: pendingMove?.summary.toMove.length ?? 0 })}
        confirmText={t('items.selection.move')}
        cancelText={t('common.cancel')}
        isLoading={isWorking}
        onConfirm={() => pendingMove && void performMove(pendingMove)}
        onClose={() => !isWorking && setPendingMove(null)}
        iconBackgroundClass="bg-amber-100 dark:bg-amber-900/30"
        icon={(
          <Icon name="exclamation" className="h-6 w-6 text-amber-600 dark:text-amber-400" />
        )}>
        <div className="space-y-2 text-sm text-gray-500 dark:text-gray-400">
          {pendingMove?.summary.toShared && (
            <p>{t('items.selection.moveIntoShared', { count: pendingMove.summary.toMove.length })}</p>
          )}
          {pendingMove?.summary.fromShared && (
            <p>{t('items.selection.moveOutOfShared', { count: pendingMove.summary.toMove.length })}</p>
          )}
        </div>
      </FormModal>

      <FormModal
        isOpen={showDeleteModal}
        title={t('items.selection.deleteTitle', { count })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        confirmButtonClass="bg-red-600 hover:bg-red-700"
        iconBackgroundClass="bg-red-100 dark:bg-red-900/30"
        isLoading={isWorking}
        onConfirm={() => void confirmDelete()}
        onClose={() => !isWorking && setShowDeleteModal(false)}
        icon={(
          <Icon name="exclamation" className="h-6 w-6 text-red-600 dark:text-red-400" />
        )}>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('items.selection.deleteDescription', { days: TRASH_RETENTION_DEFAULT_DAYS })}</p>
        {sharedCount > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            <Icon name="exclamation" className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <p>{t('items.selection.deleteShared', { count: sharedCount })}</p>
          </div>
        )}
      </FormModal>
    </>
  );
};

export default SelectionActionBar;
