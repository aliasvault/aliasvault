import { apiErrorMessage } from '@aliasvault/client/api/errors/ApiErrorMessage';
import { SrpAuthService } from '@aliasvault/client/auth/SrpAuthService';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import AlertMessage from '@/entrypoints/popup/components/AlertMessage';
import Button from '@/entrypoints/popup/components/Button';
import { FormInput } from '@/entrypoints/popup/components/Forms/FormInput';
import PageTitle from '@/entrypoints/popup/components/PageTitle';
import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useAuth } from '@/entrypoints/popup/context/AuthContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';

import { logFailure } from '@/utils/Diagnostics';

import type { DeleteAccountInitiateRequest, DeleteAccountInitiateResponse, DeleteAccountRequest } from '@aliasvault/models/webapi';

/**
 * Delete account page: confirm the username, then prove the password over SRP and delete.
 */
const DeleteAccountSettings: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const app = useApp();
  const auth = useAuth();
  const dbContext = useDb();
  const webApi = useWebApi();
  const { setIsInitialLoading, showLoading, hideLoading } = useLoading();

  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const currentUsername = app.username ?? '';

  useEffect(() => {
    setIsInitialLoading(false);
  }, [setIsInitialLoading]);

  /**
   * First step: the typed username must match the account.
   * @param e - the form submit event
   */
  const confirmUsername = (e: React.FormEvent): void => {
    e.preventDefault();
    setError(null);
    if (username.trim().toLowerCase() !== currentUsername.trim().toLowerCase()) {
      setError(t('settings.securitySettings.deleteAccount.usernameMismatchDescription'));
      return;
    }
    setShowPasswordConfirm(true);
  };

  /**
   * Second step: prove the password and delete the account.
   * @param e - the form submit event
   */
  const deleteAccountConfirmed = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (password.length === 0) {
      setError(t('validation.passwordRequired'));
      return;
    }

    try {
      showLoading();
      const initiate = await webApi.post<DeleteAccountInitiateRequest, DeleteAccountInitiateResponse>('Auth/delete-account/initiate', { username: currentUsername });
      const prepared = await SrpAuthService.prepareCredentials(password, initiate.salt, initiate.encryptionType, initiate.encryptionSettings);
      const proof = await SrpAuthService.deriveClientProof(initiate.salt, initiate.srpIdentity, prepared.passwordHashString, initiate.serverEphemeral);
      await webApi.post<DeleteAccountRequest, unknown>('Auth/delete-account/confirm', { username: currentUsername, clientPublicEphemeral: proof.clientPublicEphemeral, clientSessionProof: proof.clientSessionProof }, false);
      await auth.clearAuthUserInitiated();
    } catch (err) {
      logFailure('Account deletion failed', err);
      setError(apiErrorMessage(err, t, t('settings.securitySettings.deleteAccount.errorProcessingRequest')));
    } finally {
      hideLoading();
    }
  };

  return (
    <div className="space-y-6">
      <PageTitle>{t('settings.securitySettings.deleteAccount.deleteAccount')}</PageTitle>

      {error && <AlertMessage type="error" message={error} />}
      {dbContext.isOffline && <AlertMessage type="warning" message={t('common.errors.serverNotAvailable')} />}

      <section>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 space-y-4">
          <AlertMessage type="warning" message={showPasswordConfirm ? t('settings.securitySettings.deleteAccount.finalWarning') : t('settings.securitySettings.deleteAccount.permanentActionWarning')} />
          <div className="text-sm text-gray-600 dark:text-gray-400">
            <p className="mb-2">{t('settings.resetVault.resetVaultPleaseNote')}</p>
            <ul className="list-disc list-inside space-y-1">
              {showPasswordConfirm ? (
                <li>{t('settings.securitySettings.deleteAccount.deletionIrreversibleNote')}</li>
              ) : (
                <>
                  <li>{t('settings.securitySettings.deleteAccount.warningVaults')}</li>
                  <li>{t('settings.securitySettings.deleteAccount.warningAliases')}</li>
                  <li>{t('settings.securitySettings.deleteAccount.warningRecovery')}</li>
                </>
              )}
            </ul>
          </div>

          {!showPasswordConfirm ? (
            <form onSubmit={confirmUsername} className="space-y-3">
              <FormInput id="delete-account-username" label={t('settings.securitySettings.deleteAccount.confirmUsernameLabel')} value={username} onChange={setUsername} autoComplete="off" />
              <Button type="submit" variant="danger" disabled={dbContext.isOffline}>{t('settings.securitySettings.deleteAccount.continueWithAccountDeletion')}</Button>
              <Button variant="secondary" onClick={() => navigate('/settings/security')}>{t('common.cancel')}</Button>
            </form>
          ) : (
            <form onSubmit={deleteAccountConfirmed} className="space-y-3">
              <FormInput id="delete-account-password" type="password" label={t('auth.passwordPlaceholder')} value={password} onChange={setPassword} autoComplete="current-password" />
              <Button type="submit" variant="danger" disabled={dbContext.isOffline}>{t('settings.securitySettings.deleteAccount.deleteMyAccount')}</Button>
              <Button variant="secondary" onClick={() => navigate('/settings/security')}>{t('common.cancel')}</Button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
};

export default DeleteAccountSettings;
