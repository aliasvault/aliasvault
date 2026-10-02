import { apiErrorMessage } from '@aliasvault/client/api/errors/ApiErrorMessage';
import { SrpAuthService } from '@aliasvault/client/auth/SrpAuthService';
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
import { useLoading } from '@/context/LoadingContext';
import { useNotifications } from '@/context/NotificationContext';
import { useWebApi } from '@/context/WebApiContext';
import { usePageTitle } from '@/hooks/usePageTitle';

import type { DeleteAccountInitiateRequest, DeleteAccountInitiateResponse, DeleteAccountRequest } from '@aliasvault/models/webapi';

/**
 * The delete account page: confirm the username, then prove the
 * password over SRP and delete.
 */
const DeleteAccount: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const auth = useAuth();
  const webApi = useWebApi();
  const notifications = useNotifications();
  const { showLoading, hideLoading } = useLoading();
  
  usePageTitle(t('settings.securitySettings.deleteAccount.deleteAccount'));

  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const currentUsername = auth.username ?? '';

  /**
   * First step: the typed username must match the account.
   */
  const confirmUsername = (e: React.FormEvent): void => {
    e.preventDefault();
    notifications.clearMessages();
    if (username.length === 0) {
      notifications.addErrorMessage(t('apiErrors.USERNAME_REQUIRED'), true);
      return;
    }
    if (username.trim().toLowerCase() !== currentUsername.trim().toLowerCase()) {
      notifications.addErrorMessage(t('settings.securitySettings.deleteAccount.usernameMismatchDescription'), true);
      return;
    }
    setShowPasswordConfirm(true);
  };

  /**
   * Second step: prove the password and delete the account.
   */
  const deleteAccountConfirmed = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (password.length === 0) {
      notifications.addErrorMessage(t('validation.passwordRequired'), true);
      return;
    }
    showLoading(t('settings.securitySettings.deleteAccount.deletingAccount'));
    notifications.clearMessages();
    try {
      const initiate = await webApi.post<DeleteAccountInitiateRequest, DeleteAccountInitiateResponse>('Auth/delete-account/initiate', { username: currentUsername });
      const prepared = await SrpAuthService.prepareCredentials(password, initiate.salt, initiate.encryptionSettings);
      const proof = await SrpAuthService.deriveClientProof(initiate.salt, initiate.srpIdentity, prepared.passwordHashString, initiate.serverEphemeral);
      await webApi.post<DeleteAccountRequest, unknown>('Auth/delete-account/confirm', { username: currentUsername, clientPublicEphemeral: proof.clientPublicEphemeral, clientSessionProof: proof.clientSessionProof }, false);
      navigate('/user/logout');
    } catch (error) {
      console.error('Account deletion failed:', error);
      notifications.addErrorMessage(apiErrorMessage(error, t, t('settings.securitySettings.deleteAccount.errorProcessingRequest')), true);
    } finally {
      hideLoading();
    }
  };

  return (
    <>
      <SettingsPageHeader icon="security" title={t('settings.securitySettings.deleteAccount.deleteAccount')} backTo={{ url: '/settings/security', label: t('settings.securitySettings.pageTitle') }} />

      <Card>
        {!showPasswordConfirm ? (
          <>
            <MessageWarning message={t('settings.securitySettings.deleteAccount.permanentActionWarning')} />
            <div className="mt-4 mb-6 text-sm text-gray-600 dark:text-gray-400">
              <p className="mb-2">{t('settings.resetVault.resetVaultPleaseNote')}</p>
              <ul className="list-disc list-inside space-y-2">
                <li>{t('settings.securitySettings.deleteAccount.warningVaults')}</li>
                <li>{t('settings.securitySettings.deleteAccount.warningAliases')}</li>
                <li>{t('settings.securitySettings.deleteAccount.warningRecovery')}</li>
              </ul>
            </div>
            <form onSubmit={confirmUsername}>
              <div className="mb-4">
                <FormLabel htmlFor="username">{t('settings.securitySettings.deleteAccount.confirmUsernameLabel')}</FormLabel>
                <InputTextField id="username" type="text" value={username} onValueChange={setUsername} />
              </div>
              <div className="flex space-x-3">
                <Button type="submit" color="danger">{t('settings.securitySettings.deleteAccount.continueWithAccountDeletion')}</Button>
                <Button type="button" color="secondary" onClick={() => navigate('/settings/security')}>{t('common.cancel')}</Button>
              </div>
            </form>
          </>
        ) : (
          <>
            <MessageWarning message={t('settings.securitySettings.deleteAccount.finalWarning')} />
            <div className="mt-4 mb-6 text-sm text-gray-600 dark:text-gray-400">
              <p className="mb-2">{t('settings.resetVault.resetVaultPleaseNote')}</p>
              <ul className="list-disc list-inside space-y-2">
                <li>{t('settings.securitySettings.deleteAccount.deletionIrreversibleNote')}</li>
              </ul>
            </div>
            <form onSubmit={deleteAccountConfirmed}>
              <div className="mb-4">
                <FormLabel htmlFor="password">{t('auth.passwordPlaceholder')}</FormLabel>
                <InputTextField id="password" type="password" value={password} onValueChange={setPassword} />
              </div>
              <div className="flex space-x-3">
                <Button type="submit" color="danger">{t('settings.securitySettings.deleteAccount.deleteMyAccount')}</Button>
                <Button type="button" color="secondary" onClick={() => navigate('/settings/security')}>{t('common.cancel')}</Button>
              </div>
            </form>
          </>
        )}
      </Card>
    </>
  );
};

export default DeleteAccount;
