import { apiErrorMessage } from '@aliasvault/client/api/errors/ApiErrorMessage';
import { IncorrectPasswordError, MasterPasswordService, PasswordChangedElsewhereError } from '@aliasvault/client/auth/MasterPasswordService';
import { MIN_ACCEPTED_PASSWORD_LENGTH } from '@aliasvault/client/utilities/PasswordStrength';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PasswordInputField from '@/components/auth/PasswordInputField';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import Card from '@/components/shared/Card';
import FormLabel from '@/components/shared/FormLabel';
import PasswordStrengthIndicator from '@/components/shared/PasswordStrengthIndicator';
import { useDb } from '@/context/DbContext';
import { useLoading } from '@/context/LoadingContext';
import { useNotifications } from '@/context/NotificationContext';
import { useWebApi } from '@/context/WebApiContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVaultSync } from '@/hooks/useVaultSync';

const VALIDATION_DEBOUNCE_MS = 800;

/**
 * The change master password page.
 */
const ChangePassword: React.FC = () => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const webApi = useWebApi();
  const notifications = useNotifications();
  const { showLoading, hideLoading } = useLoading();
  const { syncVault } = useVaultSync();
  
  usePageTitle(t('settings.securitySettings.changeMasterPassword'));

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [validationError, setValidationError] = useState('');
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

  const isSubmitEnabled = currentPassword.trim().length > 0 && newPassword.trim().length > 0 && newPasswordConfirm.trim().length > 0 && newPassword === newPasswordConfirm && validationError.length === 0 && newPassword.length >= MIN_ACCEPTED_PASSWORD_LENGTH;

  /**
   * Submit password change.
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
          <button type="submit" disabled={!isSubmitEnabled} className={`w-full bg-primary-500 text-white py-2 px-4 rounded-md hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition duration-150 ease-in-out ${isSubmitEnabled ? '' : 'opacity-50 cursor-not-allowed'}`}>
            {t('settings.securitySettings.changePassword.changePassword')}
          </button>
        </form>
      </Card>
      {dbContext.isOffline && <div className="mx-4 text-sm text-red-600 dark:text-red-400">{t('common.errors.serverNotAvailable')}</div>}
    </>
  );
};

export default ChangePassword;
