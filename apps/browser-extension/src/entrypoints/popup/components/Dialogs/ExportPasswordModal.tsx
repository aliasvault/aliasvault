import { MIN_ACCEPTED_PASSWORD_LENGTH } from '@aliasvault/client/utilities/PasswordStrength';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';
import Icon from '@/entrypoints/popup/components/Icons/Icon';
import PasswordStrengthIndicator from '@/entrypoints/popup/components/PasswordStrengthIndicator';

type ExportPasswordModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (exportPassword: string) => void;
};

/**
 * Asks for the password an encrypted (.avex) export is protected with.
 */
const ExportPasswordModal: React.FC<ExportPasswordModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const [exportPassword, setExportPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setExportPassword('');
      setConfirmPassword('');
    }
  }, [isOpen]);

  const isTooShort = exportPassword.length > 0 && exportPassword.length < MIN_ACCEPTED_PASSWORD_LENGTH;
  const isMismatch = confirmPassword.length > 0 && exportPassword !== confirmPassword;
  const isValid = exportPassword.length >= MIN_ACCEPTED_PASSWORD_LENGTH && exportPassword === confirmPassword;

  /**
   * Hand the password to the caller.
   * @param event - the form submit event.
   */
  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (isValid) {
      onSubmit(exportPassword);
    }
  };

  const inputClassName = 'w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white';

  return (
    <ModalWrapper isOpen={isOpen} onClose={onClose} title={t('importExport.exportEncryptedPasswordTitle')} maxWidth="max-w-sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/30">
            <Icon name="upload" className="h-5 w-5 text-primary-600 dark:text-primary-400" />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('importExport.exportEncryptedPasswordDescription')}</p>
        </div>

        <div>
          <label htmlFor="export-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('importExport.exportPasswordModal.exportPasswordLabel')}</label>
          <input id="export-password" type="password" autoFocus autoComplete="new-password" value={exportPassword} onChange={event => setExportPassword(event.target.value)} className={inputClassName} />
          <PasswordStrengthIndicator password={exportPassword} />
        </div>

        <div>
          <label htmlFor="confirm-export-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('importExport.exportPasswordModal.confirmExportPasswordLabel')}</label>
          <input id="confirm-export-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} className={inputClassName} />
        </div>

        {isTooShort && <p className="text-sm text-red-600 dark:text-red-400">{t('settings.securitySettings.changePassword.passwordTooShort', { minLength: MIN_ACCEPTED_PASSWORD_LENGTH })}</p>}
        {!isTooShort && isMismatch && <p className="text-sm text-red-600 dark:text-red-400">{t('common.errorPasswordMismatch')}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
            {t('common.cancel')}
          </button>
          <button id="create-encrypted-export-button" type="submit" disabled={!isValid} className="px-4 py-2 text-sm bg-primary-500 text-white rounded hover:bg-primary-600 disabled:opacity-50">
            {t('importExport.exportPasswordModal.createEncryptedExportButton')}
          </button>
        </div>
      </form>
    </ModalWrapper>
  );
};

export default ExportPasswordModal;
