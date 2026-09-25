import React, { useCallback, useImperativeHandle, useState, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import LoadingIndicator from '@/components/loading/LoadingIndicator';
import SecuritySection, { type SectionHandle } from '@/components/settings/security/SecuritySection';
import Button from '@/components/shared/Button';
import { useWebApi } from '@/context/WebApiContext';

/**
 * Two-factor status with links to enable or disable it.
 */
const TwoFactorAuthenticationSection = forwardRef<SectionHandle>((_, ref) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const webApi = useWebApi();
  const [isLoading, setIsLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const tk = 'components.main.settings.security.twoFactorAuthenticationSection';

  const loadData = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    try {
      const status = await webApi.get<{ twoFactorEnabled: boolean }>('TwoFactorAuth/status');
      setEnabled(status.twoFactorEnabled);
    } finally {
      setIsLoading(false);
    }
  }, [webApi]);
  useImperativeHandle(ref, () => ({ loadData }), [loadData]);

  return (
    <SecuritySection title={t(`${tk}.Title`)}>
      {isLoading ? <LoadingIndicator /> : enabled ? (
        <>
          <div className="mb-3 text-sm text-gray-600 dark:text-gray-400">{t(`${tk}.EnabledMessage`)}</div>
          <Button color="danger" onClick={() => navigate('/settings/security/disable-2fa')}>{t(`${tk}.DisableButton`)}</Button>
        </>
      ) : (
        <>
          <div className="mb-3 text-sm text-gray-600 dark:text-gray-400">{t(`${tk}.DisabledMessage`)}</div>
          <Button color="success" onClick={() => navigate('/settings/security/enable-2fa')}>{t(`${tk}.EnableButton`)}</Button>
        </>
      )}
    </SecuritySection>
  );
});
TwoFactorAuthenticationSection.displayName = 'TwoFactorAuthenticationSection';

export default TwoFactorAuthenticationSection;
