import { MIN_ACCEPTED_PASSWORD_LENGTH } from '@aliasvault/client/utilities/PasswordStrength';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AlertMessageError from '@/components/alerts/AlertMessageError';
import PasswordInputField from '@/components/auth/PasswordInputField';
import FormModal from '@/components/shared/FormModal';
import Icon from '@/components/shared/Icon';
import PasswordStrengthIndicator from '@/components/shared/PasswordStrengthIndicator';

const VALIDATION_DEBOUNCE_MS = 800;

type ExportPasswordModalProps = {
  isOpen: boolean;
  title: string;
  description: string;
  errorMessage?: string;
  onPasswordSubmitted: (password: string) => void;
  onClose: () => void;
};

/**
 * Asks for the password an encrypted (.avex) export is protected with.
 */
const ExportPasswordModal: React.FC<ExportPasswordModalProps> = ({ isOpen, title, description, errorMessage = '', onPasswordSubmitted, onClose }) => {
  const { t } = useTranslation();
  
  const [exportPassword, setExportPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [validationError, setValidationError] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Start clean every time the modal closes.
  useEffect(() => {
    if (!isOpen) {
      setExportPassword('');
      setConfirmPassword('');
      setValidationError('');
    }
  }, [isOpen]);

  /**
   * Check length and match.
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
  const handleExportPasswordChange = (value: string): void => {
    setExportPassword(value);
    setValidationError('');
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = setTimeout(() => validate(value, confirmPassword), VALIDATION_DEBOUNCE_MS);
  };

  /**
   * Validate right away.
   */
  const handleConfirmPasswordChange = (value: string): void => {
    setConfirmPassword(value);
    validate(exportPassword, value);
  };

  const isPasswordValid = exportPassword.length > 0 && confirmPassword.length > 0 && exportPassword === confirmPassword && validationError.length === 0 && exportPassword.length >= MIN_ACCEPTED_PASSWORD_LENGTH;

  /**
   * Hand the password to the parent.
   */
  const handleSubmit = (): void => {
    if (!isPasswordValid) {
      return;
    }
    onPasswordSubmitted(exportPassword);
    setExportPassword('');
    setConfirmPassword('');
    setValidationError('');
  };

  /**
   * Enter submits, Escape closes.
   */
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && isPasswordValid) {
      handleSubmit();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <FormModal
      isOpen={isOpen}
      title={title}
      maxWidth="md"
      showDefaultFooter={false}
      onClose={onClose}
      closeOnOverlayClick={false}
      submitOnEnter={false}
      icon={(
        <Icon name="upload" className="h-6 w-6 text-primary-600 dark:text-primary-400" />
      )}
      footerContent={(
        <>
          <button type="button" onClick={handleSubmit} disabled={!isPasswordValid} className="inline-flex w-full justify-center rounded-md bg-primary-600 hover:bg-primary-700 px-3 py-2 text-sm font-semibold text-white shadow-sm sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed">
            {t('importExport.exportPasswordModal.createEncryptedExportButton')}
          </button>
          <button type="button" onClick={onClose} className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto dark:bg-gray-700 dark:text-white dark:ring-gray-600 dark:hover:bg-gray-600">
            {t('common.cancel')}
          </button>
        </>
      )}>
      <div onKeyDown={handleKeyDown}>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{description}</p>

        {errorMessage.length > 0 && <AlertMessageError message={errorMessage} hasTopMargin={false} />}

        <div className="mb-4">
          <label htmlFor="exportPassword" className="block text-sm font-medium text-gray-900 dark:text-white mb-2">{t('importExport.exportPasswordModal.exportPasswordLabel')}</label>
          <PasswordInputField id="exportPassword" value={exportPassword} onValueChange={handleExportPasswordChange} autoFocus={true} />
          <PasswordStrengthIndicator password={exportPassword} />
        </div>

        <div className="mb-4">
          <label htmlFor="confirmExportPassword" className="block text-sm font-medium text-gray-900 dark:text-white mb-2">{t('importExport.exportPasswordModal.confirmExportPasswordLabel')}</label>
          <PasswordInputField id="confirmExportPassword" value={confirmPassword} onValueChange={handleConfirmPasswordChange} />
        </div>

        {validationError.length > 0 && <div className="mt-2 text-sm text-red-600 dark:text-red-400">{validationError}</div>}
      </div>
    </FormModal>
  );
};

export default ExportPasswordModal;
