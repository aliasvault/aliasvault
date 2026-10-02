import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import MessageWarning from '@/components/alerts/MessageWarning';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import Button from '@/components/shared/Button';
import Card from '@/components/shared/Card';
import FormLabel from '@/components/shared/FormLabel';
import InputTextField from '@/components/shared/InputTextField';
import { useAuth } from '@/context/AuthContext';
import { useDb } from '@/context/DbContext';
import { useLoading } from '@/context/LoadingContext';
import { useNotifications } from '@/context/NotificationContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVaultMutate } from '@/hooks/useVaultMutate';
import { verifyMasterPassword } from '@/utils/MasterPasswordCheck';

/**
 * Empty the vault while keeping the account: confirm the username, then prompt to verify the master password.
 */
const ResetVault: React.FC = () => {
  const { t } = useTranslation();
  
  usePageTitle(t('settings.resetVault.pageTitle'));
  const navigate = useNavigate();
  const dbContext = useDb();
  const { username: accountUsername } = useAuth();
  const { showLoading, hideLoading } = useLoading();
  const notifications = useNotifications();
  const { executeVaultMutationAsync } = useVaultMutate();

  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  /**
   * First step: confirm current username.
   */
  const confirmUsername = (e: React.FormEvent): void => {
    e.preventDefault();
    notifications.clearMessages();

    if (username.length === 0) {
      notifications.addErrorMessage(t('apiErrors.USERNAME_REQUIRED'), true);
      return;
    }

    if (username.trim().toLowerCase() !== (accountUsername ?? '').trim().toLowerCase()) {
      notifications.addErrorMessage(t('settings.resetVault.resetVaultUsernameDoesNotMatch'), true);
      return;
    }

    setShowPasswordConfirm(true);
  };

  /**
   * Second step: verify the master password and empty the vault.
   */
  const resetVaultConfirmed = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (password.length === 0) {
      notifications.addErrorMessage(t('validation.passwordRequired'), true);
      return;
    }

    showLoading(t('settings.resetVault.resetVaultProgressMessage'));
    notifications.clearMessages();

    try {
      if (!await verifyMasterPassword(password)) {
        notifications.addErrorMessage(t('settings.resetVault.resetVaultPasswordIncorrect'), true);
        return;
      }

      const sqliteClient = dbContext.sqliteClient;
      if (!sqliteClient) {
        throw new Error('Vault is not available');
      }

      await executeVaultMutationAsync(async () => {
        await sqliteClient.importExport.hardDeleteAllVaultData();
        // The empty items page must not send the user back into the tutorial.
        sqliteClient.settings.updateSetting('TutorialDone', 'True');
      });

      notifications.addSuccessMessage(t('settings.resetVault.resetVaultSuccessMessage'));
      navigate('/items');
    } catch (error) {
      console.error('[ResetVault] Error resetting vault:', error);
      notifications.addErrorMessage(t('settings.resetVault.resetVaultErrorMessage'), true);
    } finally {
      hideLoading();
    }
  };

  /**
   * Back to the import/export page.
   */
  const cancel = (): void => {
    navigate('/settings/import-export');
  };

  return (
    <>
      <SettingsPageHeader icon="importExport" breadcrumbItems={[{ displayName: t('settings.importExport'), url: '/settings/import-export' }, { displayName: t('settings.resetVault.pageTitle') }]} title={t('settings.resetVault.pageTitle')} backTo={{ url: '/settings/import-export', label: t('settings.importExport') }} />

      <Card>
        {!showPasswordConfirm ? (
          <>
            <div className="mb-6 text-sm text-gray-600 dark:text-gray-400">
              <p className="mb-2">{t('settings.resetVault.resetVaultPleaseNote')}</p>
              <ul className="list-disc list-inside space-y-2">
                <li>{t('settings.resetVault.resetVaultItemsDeletedNote')}</li>
                <li>{t('settings.resetVault.resetVaultEmailAliasesKeptNote')}</li>
                <li>{t('settings.resetVault.resetVaultSettingsKeptNote')}</li>
                <li>{t('settings.resetVault.resetVaultIrreversibleNote')}</li>
              </ul>
            </div>

            <form onSubmit={confirmUsername}>
              <div className="mb-4">
                <FormLabel htmlFor="username">{t('settings.resetVault.resetVaultConfirmUsernameLabel')}</FormLabel>
                <InputTextField id="username" type="text" value={username} onValueChange={setUsername} />
              </div>
              <div className="flex space-x-3">
                <Button type="submit" color="danger">{t('settings.resetVault.resetVaultContinueButton')}</Button>
                <Button type="button" color="secondary" onClick={cancel}>{t('common.cancel')}</Button>
              </div>
            </form>
          </>
        ) : (
          <>
            <MessageWarning message={t('settings.resetVault.resetVaultFinalWarning')} />

            <div className="mt-4 mb-6 text-sm text-gray-600 dark:text-gray-400">
              <p className="mb-2">{t('settings.resetVault.resetVaultPleaseNote')}</p>
              <ul className="list-disc list-inside space-y-2">
                <li>{t('settings.resetVault.resetVaultDeletionIrreversibleNote')}</li>
              </ul>
            </div>

            <form onSubmit={e => void resetVaultConfirmed(e)}>
              <div className="mb-4">
                <FormLabel htmlFor="password">{t('settings.resetVault.resetVaultEnterPasswordLabel')}</FormLabel>
                <InputTextField id="password" type="password" value={password} onValueChange={setPassword} autoComplete="off" />
              </div>
              <div className="flex space-x-3">
                <Button type="submit" color="danger">{t('settings.resetVault.resetVaultConfirmButton')}</Button>
                <Button type="button" color="secondary" onClick={cancel}>{t('common.cancel')}</Button>
              </div>
            </form>
          </>
        )}
      </Card>
    </>
  );
};

export default ResetVault;
