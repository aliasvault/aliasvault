import React from 'react';
import { useTranslation } from 'react-i18next';

import Button from '@/entrypoints/popup/components/Button';
import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';

type PasskeyBypassDialogProps = {
  isOpen: boolean;
  origin: string;
  onChoice: (choice: 'once' | 'always') => void;
  onCancel: () => void;
};

/**
 * Dialog for choosing how to bypass AliasVault passkey provider
 */
const PasskeyBypassDialog: React.FC<PasskeyBypassDialogProps> = ({
  isOpen,
  origin,
  onChoice,
  onCancel
}) => {
  const { t } = useTranslation();

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onCancel}
      title={t('passkeys.useBrowserPasskey')}
      showCloseButton={true}
    >
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
        {t('passkeys.bypass.description', { origin })}
      </p>

      <div className="space-y-3">
        <Button
          variant="primary"
          onClick={() => onChoice('once')}
        >
          {t('passkeys.bypass.thisTimeOnly')}
        </Button>

        <Button
          variant="secondary"
          onClick={() => onChoice('always')}
        >
          {t('passkeys.bypass.alwaysForSite')}
        </Button>

        <Button
          variant="secondary"
          onClick={onCancel}
        >
          {t('common.cancel')}
        </Button>
      </div>
    </ModalWrapper>
  );
};

export default PasskeyBypassDialog;
