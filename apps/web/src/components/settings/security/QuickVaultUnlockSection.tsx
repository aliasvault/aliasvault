import React, { useCallback, useEffect, useImperativeHandle, useState, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

import LoadingIndicator from '@/components/loading/LoadingIndicator';
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
  const [isLoading, setIsLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const tk = 'components.main.settings.security.quickVaultUnlockSection';

  const loadData = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setEnabled(WebAuthnService.isEnabled());
    setIsLoading(false);
  }, []);
  useImperativeHandle(ref, () => ({ loadData }), [loadData]);
  useEffect(() => void loadData(), [loadData]);

  /**
   * Create a passkey and encrypt the session keys with it.
   */
  const enable = async (): Promise<void> => {
    try {
      await WebAuthnService.enable(auth.username ?? '');
      notifications.addSuccessMessage(t(`${tk}.SuccessEnabledMessage`), true);
    } catch (error) {
      if (error instanceof WebAuthnNotSupportedError) {
        notifications.addErrorMessage(t(`${tk}.WebAuthnNotSupportedError`), true);
      } else {
        console.info('An error occurred while trying to enable WebAuthn.', error);
        notifications.addErrorMessage(t(`${tk}.EnableErrorMessage`), true);
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
    notifications.addSuccessMessage(t(`${tk}.SuccessDisabledMessage`), true);
    await loadData();
  };

  return (
    <SecuritySection title={t(`${tk}.Title`)}>
      {isLoading ? <LoadingIndicator /> : enabled ? (
        <>
          <div className="mb-3 text-sm text-gray-600 dark:text-gray-400">{t(`${tk}.EnabledDescription`)}</div>
          <Button color="danger" onClick={() => void disable()}>{t(`${tk}.DisableButton`)}</Button>
        </>
      ) : (
        <>
          <div className="mb-3 text-sm text-gray-600 dark:text-gray-400">{t(`${tk}.DisabledDescription`)}</div>
          <div className="mb-3 text-sm text-gray-600 dark:text-gray-400">{t(`${tk}.ExperimentalWarning`)}</div>
          <Button color="success" onClick={() => void enable()}>{t(`${tk}.EnableButton`)}</Button>
        </>
      )}
    </SecuritySection>
  );
});
QuickVaultUnlockSection.displayName = 'QuickVaultUnlockSection';

export default QuickVaultUnlockSection;
