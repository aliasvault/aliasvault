import { IncorrectPasswordError, MasterPasswordService, PasswordChangedElsewhereError } from '@aliasvault/client/auth/MasterPasswordService';
import { MIN_ACCEPTED_PASSWORD_LENGTH } from '@aliasvault/client/utilities/PasswordStrength';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PasswordInputField from '@/components/auth/PasswordInputField';
import Breadcrumb from '@/components/shared/Breadcrumb';
import Card from '@/components/shared/Card';
import FormLabel from '@/components/shared/FormLabel';
import H1 from '@/components/shared/H1';
import PasswordStrengthIndicator from '@/components/shared/PasswordStrengthIndicator';
import { useDb } from '@/context/DbContext';
import { useLoading } from '@/context/LoadingContext';
import { useNotifications } from '@/context/NotificationContext';
import { useWebApi } from '@/context/WebApiContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVaultSync } from '@/hooks/useVaultSync';
import { apiErrorMessage } from '@/utils/ApiErrors';

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
  const tk = 'components.main.pages.settings.security.changePassword';
  usePageTitle(t(`${tk}.PageTitle`));

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
      setValidationError(t('validationMessages.PasswordMinLengthGeneric', { 0: MIN_ACCEPTED_PASSWORD_LENGTH }));
      return;
    }
    if (confirm.trim().length > 0 && password !== confirm) {
      setValidationError(t('validationMessages.PasswordsDoNotMatchGeneric'));
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
      setValidationError(t('validationMessages.PasswordMinLengthGeneric', { 0: MIN_ACCEPTED_PASSWORD_LENGTH }));
      return;
    }

    showLoading(t(`${tk}.ChangingPasswordMessage`));
    notifications.clearMessages();
    try {
      await MasterPasswordService.changePassword(webApi, currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setNewPasswordConfirm('');
      notifications.addSuccessMessage(t(`${tk}.PasswordChangedSuccessfully`), true);
    } catch (error) {
      console.error('Password change failed:', error);
      if (error instanceof IncorrectPasswordError) {
        notifications.addErrorMessage(t('apiErrors.PASSWORD_MISMATCH'), true);
      } else if (error instanceof PasswordChangedElsewhereError) {
        notifications.addErrorMessage(t('common.errors.passwordChanged'), true);
      } else {
        notifications.addErrorMessage(apiErrorMessage(error, t, t(`${tk}.FailedToChangePassword`)), true);
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
      <div className="grid grid-cols-1 px-4 pt-6 xl:grid-cols-3 xl:gap-4 dark:bg-gray-900">
        <div className="mb-4 col-span-full xl:mb-2">
          <Breadcrumb items={[{ displayName: t('sharedResources.Home'), url: '/', showHomeIcon: true }, { displayName: t(`${tk}.BreadcrumbSecuritySettings`), url: '/settings/security' }, { displayName: t(`${tk}.BreadcrumbChangePassword`) }]} />
          <H1>{t(`${tk}.PageTitle`)}</H1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{t(`${tk}.PageDescription`)}</p>
        </div>
      </div>

      <Card>
        <form onSubmit={changePassword} className="space-y-4">
          <div>
            <FormLabel htmlFor="currentPassword">{t(`${tk}.CurrentPasswordLabel`)}</FormLabel>
            <PasswordInputField id="currentPassword" value={currentPassword} onValueChange={setCurrentPassword} placeholder={t(`${tk}.CurrentPasswordLabel`)} />
          </div>
          <div>
            <FormLabel htmlFor="newPassword">{t(`${tk}.NewPasswordLabel`)}</FormLabel>
            <PasswordInputField id="newPassword" value={newPassword} onValueChange={onNewPasswordChange} placeholder={t(`${tk}.NewPasswordLabel`)} />
            <PasswordStrengthIndicator password={newPassword} />
          </div>
          <div>
            <FormLabel htmlFor="newPasswordConfirm">{t(`${tk}.ConfirmNewPasswordLabel`)}</FormLabel>
            <PasswordInputField id="newPasswordConfirm" value={newPasswordConfirm} onValueChange={onConfirmChange} placeholder={t(`${tk}.ConfirmNewPasswordLabel`)} />
          </div>
          {validationError.length > 0 && <div className="mt-2 text-sm text-red-600 dark:text-red-400">{validationError}</div>}
          <button type="submit" disabled={!isSubmitEnabled} className={`w-full bg-primary-500 text-white py-2 px-4 rounded-md hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition duration-150 ease-in-out ${isSubmitEnabled ? '' : 'opacity-50 cursor-not-allowed'}`}>
            {t(`${tk}.ChangePasswordButton`)}
          </button>
        </form>
      </Card>
      {dbContext.isOffline && <div className="mx-4 text-sm text-red-600 dark:text-red-400">{t('common.errors.serverNotAvailable')}</div>}
    </>
  );
};

export default ChangePassword;
