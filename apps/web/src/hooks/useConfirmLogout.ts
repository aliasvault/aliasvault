import { hasUnsyncedUserChanges } from '@aliasvault/client/sync/VaultDirtyState';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useConfirmModal } from '@/context/ConfirmModalContext';

/**
 * Ask before logging out, with a stronger warning while the vault holds changes the server does not have yet.
 */
export const useConfirmLogout = (): (() => Promise<void>) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showConfirmation } = useConfirmModal();

  return useCallback(async (): Promise<void> => {
    const confirmed = await hasUnsyncedUserChanges()
      ? await showConfirmation(t('logout.unsyncedChangesTitle'), t('logout.unsyncedChangesWarning'), t('logout.logoutAnyway'), t('common.cancel'))
      : await showConfirmation(t('common.logout'), t('auth.logoutConfirm'), t('common.logout'), t('common.cancel'));
    if (confirmed) {
      navigate('/user/logout');
    }
  }, [navigate, showConfirmation, t]);
};
