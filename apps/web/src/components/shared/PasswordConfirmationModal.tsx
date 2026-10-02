import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AlertMessageError from '@/components/alerts/AlertMessageError';
import PasswordInputField from '@/components/auth/PasswordInputField';
import FormModal from '@/components/shared/FormModal';
import Icon from '@/components/shared/Icon';

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
      confirmText={t('common.confirm')}
      cancelText={t('common.cancel')}
      confirmDisabled={password.length === 0}
      onConfirm={handleConfirm}
      onClose={handleClose}
      closeOnOverlayClick={false}
      submitOnEnter={true}
      icon={(
        <Icon name="lock-closed" className="h-6 w-6 text-orange-600 dark:text-orange-400" />
      )}>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{description}</p>

      {errorMessage.length > 0 && <AlertMessageError message={errorMessage} hasTopMargin={false} />}

      <div className="mt-4">
        <label htmlFor="password-confirm" className="block text-sm font-medium text-gray-900 dark:text-white mb-2">{t('common.password')}</label>
        <PasswordInputField id="password-confirm" value={password} onValueChange={setPassword} placeholder={t('auth.passwordPlaceholder')} autoFocus={true} />
      </div>
    </FormModal>
  );
};

export default PasswordConfirmationModal;
