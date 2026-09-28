import React, { useCallback, useImperativeHandle, useState, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

import SecuritySection, { type SectionHandle } from '@/components/settings/security/SecuritySection';
import Button from '@/components/shared/Button';
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/context/NotificationContext';
import { WebAuthnNotSupportedError, WebAuthnService } from '@/utils/WebAuthnService';

/**
 * Passkey quick unlock for this local browser session only.
 * TODO: this will be replaced by a fully integrated passkey PRF unlock feature, which is technically possible once 0.31.0+ is released.
 */
const QuickVaultUnlockSection = forwardRef<SectionHandle>((_, ref) => {
  const { t } = useTranslation();
  const auth = useAuth();
  const notifications = useNotifications();
  const [enabled, setEnabled] = useState(() => WebAuthnService.isEnabled());

  const loadData = useCallback(async (): Promise<void> => {
    setEnabled(WebAuthnService.isEnabled());
  }, []);
  useImperativeHandle(ref, () => ({ loadData }), [loadData]);

  /**
   * Create a passkey and encrypt the session keys with it.
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
    await loadData();
  };

  /**
   * Forget the passkey.
   */
  const disable = async (): Promise<void> => {
    WebAuthnService.disable();
    notifications.addSuccessMessage(t('settings.securitySettings.passkeyUnlock.successDisabledMessage'), true);
    await loadData();
  };

  return (
    <SecuritySection title={t('settings.securitySettings.passkeyUnlock.title')}>
      {enabled ? (
        <>
          <div className="mb-3 text-sm text-gray-600 dark:text-gray-400">{t('settings.securitySettings.passkeyUnlock.enabledDescription')}</div>
          <Button color="danger" onClick={() => void disable()}>{t('settings.securitySettings.passkeyUnlock.disableButton')}</Button>
        </>
      ) : (
        <>
          <div className="mb-3 text-sm text-gray-600 dark:text-gray-400">{t('settings.securitySettings.passkeyUnlock.disabledDescription')}</div>
          <div className="mb-3 text-sm text-gray-600 dark:text-gray-400">{t('settings.securitySettings.passkeyUnlock.experimentalWarning')}</div>
          <Button color="success" onClick={() => void enable()}>{t('settings.securitySettings.passkeyUnlock.enableButton')}</Button>
        </>
      )}
    </SecuritySection>
  );
});
QuickVaultUnlockSection.displayName = 'QuickVaultUnlockSection';

export default QuickVaultUnlockSection;
