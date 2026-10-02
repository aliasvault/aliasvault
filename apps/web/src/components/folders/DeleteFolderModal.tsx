import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import FormModal from '@/components/shared/FormModal';
import Icon from '@/components/shared/Icon';

type DeleteFolderModalProps = {
  isOpen: boolean;
  folderName: string;
  itemCount: number;
  onClose: () => void;
  onDeleteFolderOnly: () => Promise<void>;
  onDeleteFolderAndContents: () => Promise<void>;
};

/**
 * Modal with the two ways to delete a folder.
 */
const DeleteFolderModal: React.FC<DeleteFolderModalProps> = ({ isOpen, folderName, itemCount, onClose, onDeleteFolderOnly, onDeleteFolderAndContents }) => {
  const { t } = useTranslation();
  const [isDeleting, setIsDeleting] = useState(false);

  /**
   * Run one of the delete actions and close.
   */
  const run = async (action: () => Promise<void>): Promise<void> => {
    setIsDeleting(true);
    try {
      await action();
      onClose();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <FormModal
      isOpen={isOpen}
      title={t('items.folders.deleteFolder')}
      iconBackgroundClass="bg-red-100 dark:bg-red-900/30"
      showDefaultFooter={false}
      onClose={onClose}
      icon={(
        <Icon name="exclamation" className="h-6 w-6 text-red-600 dark:text-red-400" />
      )}
      footerContent={(
        <div className="w-full space-y-2">
          <button
            type="button"
            onClick={() => run(onDeleteFolderOnly)}
            disabled={isDeleting}
            className="w-full flex items-center gap-3 p-3 rounded-lg border border-orange-200 bg-orange-50 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-900/20 dark:hover:bg-orange-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/40">
              <Icon name="folder-filled" className="w-5 h-5 text-orange-600 dark:text-orange-400" />
            </div>
            <div className="flex-1 text-left">
              <div className="font-medium text-orange-700 dark:text-orange-300">{t('items.folders.deleteFolderKeepItems')}</div>
              <div className="text-sm text-orange-600/80 dark:text-orange-400/80">{t('items.folders.deleteFolderKeepItemsDescription')}</div>
            </div>
          </button>

          {itemCount > 0 && (
            <button
              type="button"
              onClick={() => run(onDeleteFolderAndContents)}
              disabled={isDeleting}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40">
                <Icon name="trash" className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div className="flex-1 text-left">
                <div className="font-medium text-red-700 dark:text-red-300">{t('items.folders.deleteModal.deleteFolderAndContentsTitle')}</div>
                <div className="text-sm text-red-600/80 dark:text-red-400/80">{t('items.folders.deleteModal.deleteFolderAndContentsDescription', { count: itemCount })}</div>
              </div>
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="w-full mt-2 inline-flex justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:text-white dark:ring-gray-600 dark:hover:bg-gray-600">
            {t('common.cancel')}
          </button>
        </div>
      )}>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {t('items.folders.deleteModal.deleteFolderDescription', { name: folderName })}
      </p>
    </FormModal>
  );
};

export default DeleteFolderModal;
