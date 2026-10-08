import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import Button from '@/components/shared/Button';
import Card from '@/components/shared/Card';
import Icon from '@/components/shared/Icon';
import StatusPill from '@/components/shared/StatusPill';
import Text from '@/components/shared/Text';
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/context/NotificationContext';
import { WebAuthnNotSupportedError, WebAuthnService } from '@/utils/WebAuthnService';

/**
 * Passkey quick unlock for this local browser session only.
 * TODO: this will be replaced by a fully integrated passkey PRF unlock feature, which is technically possible once 0.31.0+ is released.
 */
const QuickVaultUnlockSection: React.FC = () => {
  const { t } = useTranslation();
  const auth = useAuth();
  const notifications = useNotifications();
  const [enabled, setEnabled] = useState(() => WebAuthnService.isEnabled());

  /**
   * Create a passkey and encrypt the Account Key with it.
   */
  const enable = async (): Promise<void> => {
    try {
      await WebAuthnService.enable(auth.username ?? '');
      notifications.addSuccessMessage(t('settings.securitySettings.passkeyUnlock.successEnabledMessage'), true);
    } catch (error) {
      if (error instanceof WebAuthnNotSupportedError) {
        notifications.addErrorMessage(t('settings.securitySettings.passkeyUnlock.webAuthnNotSupportedError'), true);
      } else {
        console.info('An error occurred while trying to enable WebAuthn.', error);
        notifications.addErrorMessage(t('settings.securitySettings.passkeyUnlock.enableErrorMessage'), true);
      }
      return;
    }
    setEnabled(WebAuthnService.isEnabled());
  };

  /**
   * Forget the passkey.
   */
  const disable = (): void => {
    WebAuthnService.disable();
    notifications.addSuccessMessage(t('settings.securitySettings.passkeyUnlock.successDisabledMessage'), true);
    setEnabled(WebAuthnService.isEnabled());
  };

  return (
    <Card>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <Icon name="key" className="flex-shrink-0 w-5 h-5 text-primary-600 dark:text-primary-400" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{t('settings.securitySettings.passkeyUnlock.title')}</h3>
        </div>
        <StatusPill id="passkey-unlock-status" enabled={enabled} size="md" />
      </div>
      {enabled ? (
        <>
          <Text variant="muted" className="mb-4">{t('settings.securitySettings.passkeyUnlock.enabledDescription')}</Text>
          <Button color="danger" onClick={disable}>{t('settings.securitySettings.passkeyUnlock.disableButton')}</Button>
        </>
      ) : (
        <>
          <Text variant="muted" className="mb-3">{t('settings.securitySettings.passkeyUnlock.disabledDescription')}</Text>
          <Text variant="muted" className="mb-4">{t('settings.securitySettings.passkeyUnlock.experimentalWarning')}</Text>
          <Button color="success" onClick={() => void enable()}>{t('settings.securitySettings.passkeyUnlock.enableButton')}</Button>
        </>
      )}
    </Card>
  );
};

export default QuickVaultUnlockSection;
