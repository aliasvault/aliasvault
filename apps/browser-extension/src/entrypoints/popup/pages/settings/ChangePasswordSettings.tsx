import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AlertMessage from '@/entrypoints/popup/components/AlertMessage';
import Button from '@/entrypoints/popup/components/Button';
import { HeaderIcon, HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import PageTitle from '@/entrypoints/popup/components/PageTitle';
import PasswordStrengthIndicator, { MIN_GOOD_PASSWORD_LENGTH } from '@/entrypoints/popup/components/PasswordStrengthIndicator';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';

import { CurrentPasswordIncorrectError, PasswordChangedElsewhereError, PasswordChangeService } from '@/utils/auth/PasswordChangeService';
import { sendMessage } from '@/utils/messaging/ExtensionMessaging';
import { ApiRequestError } from '@/utils/types/errors/ApiRequestError';

type PasswordInputProps = {
  id: string;
  label: string;
  value: string;
  setValue: (value: string) => void;
  visible: boolean;
  setVisible: (visible: boolean) => void;
  children?: React.ReactNode;
};

/**
 * Password input with a visibility toggle.
 */
const PasswordInput: React.FC<PasswordInputProps> = ({ id, label, value, setValue, visible, setVisible, children }) => {
  const { t } = useTranslation();

  return (
    <div className="mb-4">
      <label className="block text-gray-700 dark:text-gray-200 font-medium mb-2" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          className="shadow appearance-none border rounded-lg w-full py-2 px-3 pr-10 text-gray-700 dark:text-gray-200 dark:bg-gray-700 dark:border-gray-600 leading-tight focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('auth.passwordPlaceholder')}
          required
        />
        <button
          type="button"
          className="absolute right-2 top-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          onClick={() => setVisible(!visible)}
          tabIndex={-1}
        >
          <HeaderIcon type={visible ? HeaderIconType.EYE_OFF : HeaderIconType.EYE} className="w-5 h-5 text-gray-400 dark:text-gray-500" />
        </button>
      </div>
      {children}
    </div>
  );
};

/**
 * Change master password settings page.
 */
const ChangePasswordSettings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const dbContext = useDb();
  const webApi = useWebApi();
  const { setIsInitialLoading, showLoading, hideLoading } = useLoading();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setIsInitialLoading(false);
  }, [setIsInitialLoading]);

  /**
   * Map a password change failure onto the message to show.
   * @param err - the error thrown by the change flow
   */
  const errorMessage = (err: unknown): string => {
    if (err instanceof CurrentPasswordIncorrectError) {
      return t('common.errors.wrongPassword');
    }
    if (err instanceof PasswordChangedElsewhereError) {
      return t('common.errors.passwordChanged');
    }
    if (err instanceof ApiRequestError && err.apiErrorCode && i18n.exists(`common.apiErrors.${err.apiErrorCode}`)) {
      return t(`common.apiErrors.${err.apiErrorCode}`);
    }
    return t('common.errors.unknownErrorTryAgain');
  };

  /**
   * Validate the form and run the password change.
   * @param e - the form submit event
   */
  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (dbContext.isOffline) {
      setError(t('common.errors.serverNotAvailable'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('settings.changePassword.passwordsDoNotMatch'));
      return;
    }
    if (newPassword.length < MIN_GOOD_PASSWORD_LENGTH) {
      setError(t('settings.changePassword.passwordTooShort', { minLength: MIN_GOOD_PASSWORD_LENGTH }));
      return;
    }

    try {
      showLoading();
      await PasswordChangeService.changePassword(webApi, currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess(t('settings.changePassword.success'));
    } catch (err) {
      console.error('Password change failed:', err);
      setError(errorMessage(err));
      if (err instanceof PasswordChangedElsewhereError) {
        // Hand off to the sync preflight, which owns the password-changed-elsewhere forced logout.
        await sendMessage('SYNC_VAULT');
      }
    } finally {
      hideLoading();
    }
  };

  return (
    <div className="space-y-6">
      <PageTitle>{t('settings.changePassword.title')}</PageTitle>

      <p className="text-sm text-gray-500 dark:text-gray-400">
        {t('settings.changePassword.description')}
      </p>

      {error && <AlertMessage type="error" message={error} />}
      {success && <AlertMessage type="success" message={success} />}
      {dbContext.isOffline && <AlertMessage type="warning" message={t('common.errors.serverNotAvailable')} />}

      <section>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
          <form onSubmit={handleSubmit}>
            <PasswordInput id="current-password" label={t('settings.changePassword.currentPassword')} value={currentPassword} setValue={setCurrentPassword} visible={showCurrentPassword} setVisible={setShowCurrentPassword} />
            <PasswordInput id="new-password" label={t('settings.changePassword.newPassword')} value={newPassword} setValue={setNewPassword} visible={showNewPassword} setVisible={setShowNewPassword}>
              <PasswordStrengthIndicator password={newPassword} />
            </PasswordInput>
            <PasswordInput id="confirm-password" label={t('settings.changePassword.confirmNewPassword')} value={confirmPassword} setValue={setConfirmPassword} visible={showConfirmPassword} setVisible={setShowConfirmPassword} />

            <Button type="submit">
              {t('settings.changePassword.title')}
            </Button>
          </form>
        </div>
      </section>
    </div>
  );
};

export default ChangePasswordSettings;
