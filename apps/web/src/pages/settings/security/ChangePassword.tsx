import { apiErrorMessage } from '@aliasvault/client/api/errors/ApiErrorMessage';
import { IncorrectPasswordError, MasterPasswordService, PasswordChangedElsewhereError } from '@aliasvault/client/auth/MasterPasswordService';
import { syncErrorMessage } from '@aliasvault/client/sync/SyncErrorMessage';
import { MIN_ACCEPTED_PASSWORD_LENGTH } from '@aliasvault/client/utilities/PasswordStrength';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import WarningBox from '@/components/alerts/WarningBox';
import PasswordInputField from '@/components/auth/PasswordInputField';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import Card from '@/components/shared/Card';
import FormLabel from '@/components/shared/FormLabel';
import PasswordStrengthIndicator from '@/components/shared/PasswordStrengthIndicator';
import { useAuth } from '@/context/AuthContext';
import { useDb } from '@/context/DbContext';
import { useLoading } from '@/context/LoadingContext';
import { useNotifications } from '@/context/NotificationContext';
import { useWebApi } from '@/context/WebApiContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVaultSync } from '@/hooks/useVaultSync';
import { WebAuthnService } from '@/utils/WebAuthnService';
import { vaultStore } from '@/vault/VaultStore';

import type { KeyRotationOperationResult } from '@aliasvault/client/sync/VaultSync';
import type { VaultSyncKeyRotationRefusal } from '@aliasvault/client/sync/VaultSyncEngine';
import type { TranslationKey } from '@aliasvault/i18n';

const VALIDATION_DEBOUNCE_MS = 800;

/** What the page tells the user for each reason the engine did not run the rotation. */
const REFUSAL_KEYS: Record<VaultSyncKeyRotationRefusal, TranslationKey> = {
  vaultOutOfDate: 'apiErrors.VAULT_NOT_UP_TO_DATE',
  serverStateChanged: 'apiErrors.VAULT_NOT_UP_TO_DATE',
  sharedVaultKeyUnavailable: 'common.errors.unexpectedErrorContactSupport',
  vaultUpgradeRequired: 'content.vaultUpgradeRequired',
};

/**
 * The change master password page. A regular change keeps the encryption keys; behind the advanced options the user
 * can also replace every encryption key along with the password, after acknowledging the risks and signing out their other devices.
 */
const ChangePassword: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const auth = useAuth();
  const dbContext = useDb();
  const webApi = useWebApi();
  const notifications = useNotifications();
  const { showLoading, hideLoading } = useLoading();
  const { syncVault } = useVaultSync();

  usePageTitle(t('settings.securitySettings.changeMasterPassword'));

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [rotateKeys, setRotateKeys] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [validationError, setValidationError] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Check length and match of the new password.
   */
  const validate = (password: string, confirm: string): void => {
    if (password.trim().length > 0 && password.length < MIN_ACCEPTED_PASSWORD_LENGTH) {
      setValidationError(t('settings.securitySettings.changePassword.passwordTooShort', { minLength: MIN_ACCEPTED_PASSWORD_LENGTH }));
      return;
    }
    if (confirm.trim().length > 0 && password !== confirm) {
      setValidationError(t('common.errorPasswordMismatch'));
      return;
    }
    setValidationError('');
  };

  /**
   * Validate after a typing pause.
   */
  const onNewPasswordChange = (value: string): void => {
    setNewPassword(value);
    setValidationError('');
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = setTimeout(() => validate(value, newPasswordConfirm), VALIDATION_DEBOUNCE_MS);
  };

  /**
   * Validate right away.
   */
  const onConfirmChange = (value: string): void => {
    setNewPasswordConfirm(value);
    validate(newPassword, value);
  };

  const passwordsValid = currentPassword.trim().length > 0 && newPassword.trim().length > 0 && newPasswordConfirm.trim().length > 0 && newPassword === newPasswordConfirm && validationError.length === 0 && newPassword.length >= MIN_ACCEPTED_PASSWORD_LENGTH;
  const rotationReady = !rotateKeys || (acknowledged && !dbContext.isOffline);
  const isSubmitEnabled = passwordsValid && rotationReady;

  /**
   * The message for a rotation the engine refused or failed, or null when it went through.
   */
  const rotationOutcomeMessage = (result: KeyRotationOperationResult): string | null => {
    if (result.success) {
      return null;
    }
    if (result.refusal) {
      return t(REFUSAL_KEYS[result.refusal]);
    }
    const detail = syncErrorMessage(result, t);
    return detail ? `${t('settings.securitySettings.changePassword.failedToChangePassword')}\n${detail}` : t('settings.securitySettings.changePassword.failedToChangePassword');
  };

  /**
   * Change the password and rotate every key; on success the page moves on to the settings overview.
   */
  const changePasswordAndRotateKeys = async (): Promise<void> => {
    // The engine refuses a vault out of step with the server, so sync first.
    if (!await syncVault()) {
      notifications.addErrorMessage(t('apiErrors.VAULT_NOT_UP_TO_DATE'), true);
      return;
    }

    const result = await MasterPasswordService.changePasswordAndRotateKeys(webApi, params => vaultStore.rotateAccountKeys(params), currentPassword, newPassword);
    if (result.requiresLogout) {
      await auth.logout({ errorMessage: syncErrorMessage(result, t) });
      return;
    }

    const message = rotationOutcomeMessage(result);
    if (message) {
      notifications.addErrorMessage(message, true);
      return;
    }

    // The passkey unlock on this browser holds the old Account Key.
    WebAuthnService.disable();
    await dbContext.loadStoredDatabase();
    notifications.addSuccessMessage(t('settings.securitySettings.changePassword.passwordChangedSuccessfully'));
    navigate('/settings');
  };

  /**
   * Submit the change.
   */
  const changePassword = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setValidationError('');
    if (newPassword.length < MIN_ACCEPTED_PASSWORD_LENGTH) {
      setValidationError(t('settings.securitySettings.changePassword.passwordTooShort', { minLength: MIN_ACCEPTED_PASSWORD_LENGTH }));
      return;
    }

    showLoading(t('settings.securitySettings.changePassword.changingPasswordMessage'));
    notifications.clearMessages();
    try {
      if (rotateKeys) {
        await changePasswordAndRotateKeys();
        return;
      }
      await MasterPasswordService.changePassword(webApi, currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setNewPasswordConfirm('');
      notifications.addSuccessMessage(t('settings.securitySettings.changePassword.passwordChangedSuccessfully'), true);
    } catch (error) {
      console.error('Password change failed:', error);
      if (error instanceof IncorrectPasswordError) {
        notifications.addErrorMessage(t('apiErrors.PASSWORD_MISMATCH'), true);
      } else if (error instanceof PasswordChangedElsewhereError) {
        notifications.addErrorMessage(t('common.errors.passwordChanged'), true);
      } else {
        notifications.addErrorMessage(apiErrorMessage(error, t, t('settings.securitySettings.changePassword.failedToChangePassword')), true);
      }
      return;
    } finally {
      hideLoading();
    }

    // Sync afterwards to ensure the local state and the server match.
    await syncVault();
  };

  return (
    <>
      <SettingsPageHeader icon="changePassword" title={t('settings.securitySettings.changeMasterPassword')} description={t('settings.securitySettings.changePassword.headerText')} />

      <Card>
        <form onSubmit={changePassword} className="space-y-4">
          <div>
            <FormLabel htmlFor="currentPassword">{t('settings.securitySettings.changePassword.currentPassword')}</FormLabel>
            <PasswordInputField id="currentPassword" value={currentPassword} onValueChange={setCurrentPassword} placeholder={t('settings.securitySettings.changePassword.currentPassword')} />
          </div>
          <div>
            <FormLabel htmlFor="newPassword">{t('settings.securitySettings.changePassword.newPassword')}</FormLabel>
            <PasswordInputField id="newPassword" value={newPassword} onValueChange={onNewPasswordChange} placeholder={t('settings.securitySettings.changePassword.newPassword')} />
            <PasswordStrengthIndicator password={newPassword} />
          </div>
          <div>
            <FormLabel htmlFor="newPasswordConfirm">{t('settings.securitySettings.changePassword.confirmNewPassword')}</FormLabel>
            <PasswordInputField id="newPasswordConfirm" value={newPasswordConfirm} onValueChange={onConfirmChange} placeholder={t('settings.securitySettings.changePassword.confirmNewPassword')} />
          </div>

          {validationError.length > 0 && <div className="mt-2 text-sm text-red-600 dark:text-red-400">{validationError}</div>}

          <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} aria-expanded={showAdvanced} className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            {showAdvanced ? '\u25BE' : '\u25B8'} {t('app.loginSettings.advancedSettings')}
          </button>

          {showAdvanced && (
            <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" className="mt-0.5 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded dark:bg-gray-700 dark:border-gray-600" checked={rotateKeys} onChange={e => setRotateKeys(e.target.checked)} />
              <span>
                <span className="block font-medium">{t('settings.securitySettings.keyRotation.optionRotateKeys')}</span>
                <span className="block text-gray-600 dark:text-gray-400">{t('settings.securitySettings.keyRotation.optionRotateKeysDescription')}</span>
              </span>
            </label>
          )}

          {rotateKeys && (
            <>
              <WarningBox icon="exclamation">
                <p><span className="font-semibold">{t('common.highRiskAction')}</span> {t('common.beforeYouContinue')}</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>{t('settings.securitySettings.keyRotation.riskSignOut')}</li>
                  <li>{t('settings.securitySettings.keyRotation.riskBackup')}</li>
                  <li>{t('settings.securitySettings.keyRotation.riskAfterwards')}</li>
                </ul>
              </WarningBox>

              <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" className="mt-0.5 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded dark:bg-gray-700 dark:border-gray-600" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />
                <span>{t('settings.securitySettings.keyRotation.acknowledge')}</span>
              </label>
            </>
          )}

          <button type="submit" disabled={!isSubmitEnabled} className={`w-full text-white py-2 px-4 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 transition duration-150 ease-in-out ${rotateKeys ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500' : 'bg-primary-500 hover:bg-primary-600 focus:ring-primary-500'} ${isSubmitEnabled ? '' : 'opacity-50 cursor-not-allowed'}`}>
            {rotateKeys ? t('settings.securitySettings.keyRotation.changePasswordAndRotate') : t('settings.securitySettings.changePassword.changePassword')}
          </button>
        </form>
      </Card>
      {dbContext.isOffline && <div className="mx-4 text-sm text-red-600 dark:text-red-400">{t('common.errors.serverNotAvailable')}</div>}
    </>
  );
};

export default ChangePassword;
