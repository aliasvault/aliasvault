import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { sendMessage } from 'webext-bridge/popup';

import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';

interface ILogoutConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * A modal component for logout confirmation that checks for unsynced changes.
 * Shows a warning if the vault has unsynced changes that would be lost.
 */
const LogoutConfirmModal: React.FC<ILogoutConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm
}) => {
  const { t } = useTranslation();
  const [isDirty, setIsDirty] = useState<boolean | null>(null);

  /**
   * Check if the vault has unsynced changes when the modal opens.
   */
  const checkSyncState = useCallback(async (): Promise<void> => {
    try {
      const syncState = await sendMessage('GET_SYNC_STATE', {}, 'background') as {
        isDirty: boolean;
        mutationSequence: number;
        serverRevision: number;
      };
      setIsDirty(syncState.isDirty);
    } catch (error) {
      console.error('Failed to check sync state:', error);
      // Default to showing the simple logout confirmation on error
      setIsDirty(false);
    }
  }, []);

  /**
   * Check sync state when modal opens.
   */
  useEffect(() => {
    if (isOpen) {
      // Reset state when modal opens
      setIsDirty(null);
      checkSyncState();
    }
  }, [isOpen, checkSyncState]);

  // Don't render anything if not open or still loading
  if (!isOpen || isDirty === null) {
    return null;
  }

  // Render dirty logout warning modal
  if (isDirty) {
    return (
      <ModalWrapper
        isOpen={isOpen}
        onClose={onClose}
        maxWidth="max-w-sm"
        showHeaderBorder={false}
        showCloseButton={false}
        bodyClassName="p-6"
      >
        <div className="flex items-start mb-4">
          <div className="flex-shrink-0">
            <svg className="h-6 w-6 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t('logout.unsyncedChangesTitle')}
            </h3>
          </div>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
          {t('logout.unsyncedChangesWarning')}
        </p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white rounded-md transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-md transition-colors"
          >
            {t('logout.logoutAnyway')}
          </button>
        </div>
      </ModalWrapper>
    );
  }

  // Render normal logout confirmation modal
  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="max-w-sm"
      showHeaderBorder={false}
      showCloseButton={false}
      bodyClassName="p-6"
    >
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
        {t('common.logout')}
      </h3>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
        {t('auth.logoutConfirm')}
      </p>
      <div className="flex gap-3">
        <button
          onClick={onClose}
          className="flex-1 px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white rounded-md transition-colors"
        >
          {t('common.cancel')}
        </button>
        <button
          onClick={onConfirm}
          className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-md transition-colors"
        >
          {t('common.logout')}
        </button>
      </div>
    </ModalWrapper>
  );
};

export default LogoutConfirmModal;
