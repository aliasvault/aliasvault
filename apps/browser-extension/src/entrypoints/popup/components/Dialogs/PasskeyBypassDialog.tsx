import React from 'react';
import { useTranslation } from 'react-i18next';

import Button from '../Button';

type PasskeyBypassDialogProps = {
  origin: string;
  onChoice: (choice: 'once' | 'always') => void;
  onCancel: () => void;
};

/**
 * Dialog for choosing how to bypass AliasVault passkey provider
 */
const PasskeyBypassDialog: React.FC<PasskeyBypassDialogProps> = ({
  origin,
  onChoice,
  onCancel
}) => {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
          {t('passkeys.bypass.title')}
        </h2>

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
      </div>
    </div>
  );
};

export default PasskeyBypassDialog;
