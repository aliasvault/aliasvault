import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import SettingsIcon from '@/components/settings/SettingsIcon';
import MenuItem from '@/components/shared/MenuItem';
import { useDb } from '@/context/DbContext';
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut';
import { vaultStore } from '@/vault/VaultStore';

/**
 * Account menu row that locks the vault.
 */
const DbLockButton: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dbContext = useDb();

  /**
   * Lock the vault and redirect to the unlock page.
   */
  const onLockClick = useCallback(async (): Promise<void> => {
    await vaultStore.lockVault();
    dbContext.clearDatabase();
    navigate('/unlock/true');
  }, [dbContext, navigate]);
  const lockFromShortcut = useCallback((): void => void onLockClick(), [onLockClick]);
  useKeyboardShortcut('gl', lockFromShortcut);

  return (
    <MenuItem id="lockVaultButton" icon={<SettingsIcon name="lock" className="w-5 h-5" />} label={t('common.lockVault')} onClick={() => void onLockClick()} />
  );
};

export default DbLockButton;
