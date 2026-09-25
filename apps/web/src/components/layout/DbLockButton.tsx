import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useDb } from '@/context/DbContext';
import { vaultStore } from '@/vault/VaultStore';

/**
 * Lock the vault and redirect to the unlock page.
 */
const DbLockButton: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dbContext = useDb();

  /**
   * Lock the vault and redirect to the unlock page.
   */
  const onLockClick = async (): Promise<void> => {
    await vaultStore.lockVault();
    dbContext.clearDatabase();
    navigate('/unlock/true');
  };

  return (
    <div className="ms-2 items-center hidden lg:flex">
      <button className="p-2 hover:bg-gray-200 rounded-2xl" onClick={onLockClick} title={t('sharedResources.LockVault')}>
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
        </svg>
      </button>
    </div>
  );
};

export default DbLockButton;
