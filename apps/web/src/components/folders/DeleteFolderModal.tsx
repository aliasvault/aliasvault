import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import FormModal from '@/components/shared/FormModal';

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
      title={t('components.folders.deleteFolderModal.DeleteFolderTitle')}
      iconBackgroundClass="bg-red-100 dark:bg-red-900/30"
      showDefaultFooter={false}
      onClose={onClose}
      icon={(
        <svg className="h-6 w-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      )}
      footerContent={(
        <div className="w-full space-y-2">
          <button
            type="button"
            onClick={() => run(onDeleteFolderOnly)}
            disabled={isDeleting}
            className="w-full flex items-center gap-3 p-3 rounded-lg border border-orange-200 bg-orange-50 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-900/20 dark:hover:bg-orange-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/40">
              <svg className="w-5 h-5 text-orange-600 dark:text-orange-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
              </svg>
            </div>
            <div className="flex-1 text-left">
              <div className="font-medium text-orange-700 dark:text-orange-300">{t('components.folders.deleteFolderModal.DeleteFolderOnlyTitle')}</div>
              <div className="text-sm text-orange-600/80 dark:text-orange-400/80">{t('components.folders.deleteFolderModal.DeleteFolderOnlyDescription')}</div>
            </div>
          </button>

          {itemCount > 0 && (
            <button
              type="button"
              onClick={() => run(onDeleteFolderAndContents)}
              disabled={isDeleting}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40">
                <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </div>
              <div className="flex-1 text-left">
                <div className="font-medium text-red-700 dark:text-red-300">{t('components.folders.deleteFolderModal.DeleteFolderAndContentsTitle')}</div>
                <div className="text-sm text-red-600/80 dark:text-red-400/80">{t('components.folders.deleteFolderModal.DeleteFolderAndContentsDescription', { 0: itemCount })}</div>
              </div>
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="w-full mt-2 inline-flex justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:text-white dark:ring-gray-600 dark:hover:bg-gray-600">
            {t('components.folders.deleteFolderModal.CancelButton')}
          </button>
        </div>
      )}>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {t('components.folders.deleteFolderModal.DeleteFolderDescription', { 0: folderName })}
      </p>
    </FormModal>
  );
};

export default DeleteFolderModal;
