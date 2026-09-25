import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AlertMessageError from '@/components/alerts/AlertMessageError';
import PasswordInputField from '@/components/auth/PasswordInputField';
import FormModal from '@/components/shared/FormModal';

type PasswordConfirmationModalProps = {
  isOpen: boolean;
  title: string;
  description: string;
  errorMessage?: string;
  onPasswordSubmitted: (password: string) => void;
  onClose: () => void;
};

/**
 * Asks for the master password before a sensitive action.
 */
const PasswordConfirmationModal: React.FC<PasswordConfirmationModalProps> = ({ isOpen, title, description, errorMessage = '', onPasswordSubmitted, onClose }) => {
  const { t } = useTranslation();
  const tk = 'components.main.shared.passwordConfirmationModal';
  const [password, setPassword] = useState('');

  // Start empty every time the modal opens.
  useEffect(() => {
    if (isOpen) {
      setPassword('');
    }
  }, [isOpen]);

  /**
   * Hand the password to the parent.
   */
  const handleConfirm = (): void => {
    if (password.length === 0) {
      return;
    }
    onPasswordSubmitted(password);
    setPassword('');
  };

  /**
   * Close without submitting.
   */
  const handleClose = (): void => {
    setPassword('');
    onClose();
  };

  return (
    <FormModal
      isOpen={isOpen}
      title={title}
      maxWidth="sm"
      confirmText={t(`${tk}.ConfirmButton`)}
      cancelText={t('sharedResources.Cancel')}
      confirmDisabled={password.length === 0}
      onConfirm={handleConfirm}
      onClose={handleClose}
      submitOnEnter={true}
      icon={(
        <svg className="h-6 w-6 text-orange-600 dark:text-orange-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
      )}>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{description}</p>

      {errorMessage.length > 0 && <AlertMessageError message={errorMessage} hasTopMargin={false} />}

      <div className="mt-4">
        <label htmlFor="password-confirm" className="block text-sm font-medium text-gray-900 dark:text-white mb-2">{t('sharedResources.Password')}</label>
        <PasswordInputField id="password-confirm" value={password} onValueChange={setPassword} placeholder={t(`${tk}.EnterPasswordPlaceholder`)} autoFocus={true} />
      </div>
    </FormModal>
  );
};

export default PasswordConfirmationModal;
