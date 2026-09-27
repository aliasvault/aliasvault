import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import MessageWarning from '@/components/alerts/MessageWarning';
import Breadcrumb from '@/components/shared/Breadcrumb';
import Button from '@/components/shared/Button';
import Card from '@/components/shared/Card';
import FormLabel from '@/components/shared/FormLabel';
import H1 from '@/components/shared/H1';
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
  const tk = 'components.main.pages.settings.importExport.resetVault';
  usePageTitle(t(`${tk}.PageTitle`));
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
      notifications.addErrorMessage(t(`${tk}.ResetVaultUsernameRequired`), true);
      return;
    }

    if (username.trim().toLowerCase() !== (accountUsername ?? '').trim().toLowerCase()) {
      notifications.addErrorMessage(t(`${tk}.ResetVaultUsernameDoesNotMatch`), true);
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
      notifications.addErrorMessage(t('validationMessages.PasswordRequired'), true);
      return;
    }

    showLoading(t(`${tk}.ResetVaultProgressMessage`));
    notifications.clearMessages();

    try {
      if (!await verifyMasterPassword(password)) {
        notifications.addErrorMessage(t(`${tk}.ResetVaultPasswordIncorrect`), true);
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

      notifications.addSuccessMessage(t(`${tk}.ResetVaultSuccessMessage`));
      navigate('/items');
    } catch (error) {
      console.error('[ResetVault] Error resetting vault:', error);
      notifications.addErrorMessage(t(`${tk}.ResetVaultErrorMessage`), true);
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
      <div className="grid grid-cols-1 px-4 pt-6 xl:grid-cols-3 xl:gap-4 dark:bg-gray-900">
        <div className="mb-4 col-span-full xl:mb-2">
          <Breadcrumb items={[{ displayName: t('sharedResources.Home'), url: '/', showHomeIcon: true }, { displayName: t(`${tk}.BreadcrumbImportExport`), url: '/settings/import-export' }, { displayName: t(`${tk}.BreadcrumbResetVault`) }]} />
          <H1>{t(`${tk}.PageTitle`)}</H1>
        </div>
      </div>

      <Card>
        {!showPasswordConfirm ? (
          <>
            <div className="mb-6 text-sm text-gray-600 dark:text-gray-400">
              <p className="mb-2">{t(`${tk}.ResetVaultPleaseNote`)}</p>
              <ul className="list-disc list-inside space-y-2">
                <li>{t(`${tk}.ResetVaultItemsDeletedNote`)}</li>
                <li>{t(`${tk}.ResetVaultEmailAliasesKeptNote`)}</li>
                <li>{t(`${tk}.ResetVaultSettingsKeptNote`)}</li>
                <li>{t(`${tk}.ResetVaultIrreversibleNote`)}</li>
              </ul>
            </div>

            <form onSubmit={confirmUsername}>
              <div className="mb-4">
                <FormLabel htmlFor="username">{t(`${tk}.ResetVaultConfirmUsernameLabel`)}</FormLabel>
                <InputTextField id="username" type="text" value={username} onValueChange={setUsername} />
              </div>
              <div className="flex space-x-3">
                <Button type="submit" color="danger">{t(`${tk}.ResetVaultContinueButton`)}</Button>
                <Button type="button" color="secondary" onClick={cancel}>{t('sharedResources.Cancel')}</Button>
              </div>
            </form>
          </>
        ) : (
          <>
            <MessageWarning message={t(`${tk}.ResetVaultFinalWarning`)} />

            <div className="mt-4 mb-6 text-sm text-gray-600 dark:text-gray-400">
              <p className="mb-2">{t(`${tk}.ResetVaultPleaseNote`)}</p>
              <ul className="list-disc list-inside space-y-2">
                <li>{t(`${tk}.ResetVaultDeletionIrreversibleNote`)}</li>
              </ul>
            </div>

            <form onSubmit={e => void resetVaultConfirmed(e)}>
              <div className="mb-4">
                <FormLabel htmlFor="password">{t(`${tk}.ResetVaultEnterPasswordLabel`)}</FormLabel>
                <InputTextField id="password" type="password" value={password} onValueChange={setPassword} autoComplete="off" />
              </div>
              <div className="flex space-x-3">
                <Button type="submit" color="danger">{t(`${tk}.ResetVaultConfirmButton`)}</Button>
                <Button type="button" color="secondary" onClick={cancel}>{t('sharedResources.Cancel')}</Button>
              </div>
            </form>
          </>
        )}
      </Card>
    </>
  );
};

export default ResetVault;
