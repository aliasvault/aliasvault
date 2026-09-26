import { SrpAuthService } from '@aliasvault/client/auth/SrpAuthService';
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
import { useLoading } from '@/context/LoadingContext';
import { useNotifications } from '@/context/NotificationContext';
import { useWebApi } from '@/context/WebApiContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { apiErrorMessage } from '@/utils/ApiErrors';

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
  const tk = 'components.main.pages.settings.security.deleteAccount';
  usePageTitle(t(`${tk}.PageTitle`));

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
      notifications.addErrorMessage(t(`${tk}.UsernameRequired`), true);
      return;
    }
    if (username.trim().toLowerCase() !== currentUsername.trim().toLowerCase()) {
      notifications.addErrorMessage(t(`${tk}.UsernameDoesNotMatch`), true);
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
      notifications.addErrorMessage(t('validationMessages.PasswordRequired'), true);
      return;
    }
    showLoading(t(`${tk}.DeletingAccountMessage`));
    notifications.clearMessages();
    try {
      const initiate = await webApi.post<DeleteAccountInitiateRequest, DeleteAccountInitiateResponse>('Auth/delete-account/initiate', { username: currentUsername });
      const prepared = await SrpAuthService.prepareCredentials(password, initiate.salt, initiate.encryptionSettings);
      const proof = await SrpAuthService.deriveClientProof(initiate.salt, initiate.srpIdentity, prepared.passwordHashString, initiate.serverEphemeral);
      await webApi.post<DeleteAccountRequest, unknown>('Auth/delete-account/confirm', { username: currentUsername, clientPublicEphemeral: proof.clientPublicEphemeral, clientSessionProof: proof.clientSessionProof }, false);
      navigate('/user/logout');
    } catch (error) {
      console.error('Account deletion failed:', error);
      notifications.addErrorMessage(apiErrorMessage(error, t, t(`${tk}.ErrorProcessingRequest`)), true);
    } finally {
      hideLoading();
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 px-4 pt-6 xl:grid-cols-3 xl:gap-4 dark:bg-gray-900">
        <div className="mb-4 col-span-full xl:mb-2">
          <Breadcrumb items={[{ displayName: t('sharedResources.Home'), url: '/', showHomeIcon: true }, { displayName: t(`${tk}.BreadcrumbSecuritySettings`), url: '/settings/security' }, { displayName: t(`${tk}.BreadcrumbDeleteAccount`) }]} />
          <H1>{t(`${tk}.PageTitle`)}</H1>
        </div>
      </div>

      <Card>
        {!showPasswordConfirm ? (
          <>
            <MessageWarning message={t(`${tk}.PermanentActionWarning`)} />
            <div className="mt-4 mb-6 text-sm text-gray-600 dark:text-gray-400">
              <p className="mb-2">{t(`${tk}.PleaseNote`)}</p>
              <ul className="list-disc list-inside space-y-2">
                <li>{t(`${tk}.VaultsDeletedNote`)}</li>
                <li>{t(`${tk}.EmailAliasesOrphanedNote`)}</li>
                <li>{t(`${tk}.AccountCannotBeRecoveredNote`)}</li>
              </ul>
            </div>
            <form onSubmit={confirmUsername}>
              <div className="mb-4">
                <FormLabel htmlFor="username">{t(`${tk}.ConfirmUsernameLabel`)}</FormLabel>
                <InputTextField id="username" type="text" value={username} onValueChange={setUsername} />
              </div>
              <div className="flex space-x-3">
                <Button type="submit" color="danger">{t(`${tk}.ContinueWithAccountDeletion`)}</Button>
                <Button type="button" color="secondary" onClick={() => navigate('/settings/security')}>{t('sharedResources.Cancel')}</Button>
              </div>
            </form>
          </>
        ) : (
          <>
            <MessageWarning message={t(`${tk}.FinalWarning`)} />
            <div className="mt-4 mb-6 text-sm text-gray-600 dark:text-gray-400">
              <p className="mb-2">{t(`${tk}.PleaseNote`)}</p>
              <ul className="list-disc list-inside space-y-2">
                <li>{t(`${tk}.DeletionIrreversibleNote`)}</li>
              </ul>
            </div>
            <form onSubmit={deleteAccountConfirmed}>
              <div className="mb-4">
                <FormLabel htmlFor="password">{t(`${tk}.EnterPasswordLabel`)}</FormLabel>
                <InputTextField id="password" type="password" value={password} onValueChange={setPassword} />
              </div>
              <div className="flex space-x-3">
                <Button type="submit" color="danger">{t(`${tk}.DeleteMyAccount`)}</Button>
                <Button type="button" color="secondary" onClick={() => navigate('/settings/security')}>{t('sharedResources.Cancel')}</Button>
              </div>
            </form>
          </>
        )}
      </Card>
    </>
  );
};

export default DeleteAccount;
