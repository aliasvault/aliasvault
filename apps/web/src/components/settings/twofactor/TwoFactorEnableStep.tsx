import QRCode from 'qrcode';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import LoadingIndicator from '@/components/loading/LoadingIndicator';
import SettingsIcon from '@/components/settings/SettingsIcon';
import Button from '@/components/shared/Button';
import Card from '@/components/shared/Card';
import InputTextField from '@/components/shared/InputTextField';
import SectionTitle from '@/components/shared/SectionTitle';
import Text from '@/components/shared/Text';
import { useAccountNudges } from '@/context/AccountNudgeContext';
import { useNotifications } from '@/context/NotificationContext';
import { useWebApi } from '@/context/WebApiContext';

/**
 * The recovery codes, shown once right after two-factor authentication was enabled.
 */
const RecoveryCodes: React.FC<{ recoveryCodes: string[] }> = ({ recoveryCodes }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <Card>
      <SectionTitle className="mb-2">{t('settings.securitySettings.recoveryCodes.title')}</SectionTitle>
      <Text variant="muted" className="mb-4">{t('settings.securitySettings.recoveryCodes.description')}</Text>
      <div className="flex items-start gap-3 mb-5 p-4 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200" role="alert">
        <SettingsIcon name="warning" className="flex-shrink-0 w-5 h-5 mt-0.5 text-amber-600 dark:text-amber-400" />
        <div className="text-sm">
          <p className="font-semibold">{t('settings.securitySettings.recoveryCodes.warningTitle')}</p>
          <p>{t('settings.securitySettings.recoveryCodes.warningDescription')}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 mb-6" id="recovery-codes">
        {recoveryCodes.map(code => (
          <code key={code} className="block p-3 bg-gray-100 dark:bg-gray-700 dark:text-gray-200 rounded-lg border border-gray-200 dark:border-gray-600 font-mono text-center">{code}</code>
        ))}
      </div>
      <Button onClick={() => navigate('/settings/two-factor')}>{t('common.continue')}</Button>
    </Card>
  );
};

/**
 * Enable step of the two-factor page: scan the QR code (or type the secret), then confirm with a first code.
 */
const TwoFactorEnableStep: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const webApi = useWebApi();
  const notifications = useNotifications();
  const { refresh: refreshNudges } = useAccountNudges();
  const [isLoading, setIsLoading] = useState(true);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const hasStarted = useRef(false);

  useEffect(() => {
    if (hasStarted.current) {
      return;
    }
    hasStarted.current = true;

    /**
     * Ask the server for a new authenticator secret and render it as a QR code.
     */
    const setup = async (): Promise<void> => {
      try {
        const result = await webApi.post<null, { secret: string; qrCodeUrl: string }>('TwoFactorAuth/enable', null);
        // Spaces every four characters make the secret easier to type over.
        setSecret((result.secret.match(/.{1,4}/g) ?? []).join(' ').toLowerCase());
        setQrCodeDataUrl(await QRCode.toDataURL(result.qrCodeUrl, { width: 256, margin: 2 }));
      } catch (error) {
        console.error('Failed to start 2FA setup:', error);
        notifications.addErrorMessage(t('settings.securitySettings.enable2fa.failedToEnable2Fa'), true);
      } finally {
        setIsLoading(false);
      }
    };
    void setup();
  }, [notifications, t, webApi]);

  /**
   * Verify the first code and switch two-factor on.
   */
  const verifySetup = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      const result = await webApi.post<string, { recoveryCodes: string[] }>('TwoFactorAuth/verify', code);
      notifications.addSuccessMessage(t('settings.securitySettings.enable2fa.twoFactorEnabledSuccess'), true);
      setRecoveryCodes(result.recoveryCodes);
      void refreshNudges();
    } catch (error) {
      console.error('Failed to verify 2FA code:', error);
      notifications.addErrorMessage(t('settings.securitySettings.enable2fa.failedToEnable2Fa'), true);
    }
  };

  if (isLoading) {
    return <LoadingIndicator />;
  }

  if (recoveryCodes !== null) {
    return <RecoveryCodes recoveryCodes={recoveryCodes} />;
  }

  return (
    <Card>
      <SectionTitle className="mb-4">{t('settings.securitySettings.enable2fa.pageTitle')}</SectionTitle>
      <div className="flex flex-col md:flex-row gap-6 md:gap-8">
        <div id="authenticator-uri" className="flex-shrink-0 self-center md:self-start p-2 bg-white rounded-lg border border-gray-200 dark:border-gray-600">
          {qrCodeDataUrl.length > 0 && <img src={qrCodeDataUrl} alt={t('common.qrCode')} className="w-48 h-48 sm:w-56 sm:h-56" />}
        </div>
        <div className="flex-1 min-w-0 space-y-4">
          <Text>{t('settings.securitySettings.enable2fa.qrCodeInstructions')}</Text>
          <div className="font-mono text-base sm:text-lg break-all bg-gray-100 dark:bg-gray-700 dark:text-gray-200 p-3 rounded-lg border border-gray-200 dark:border-gray-600" id="authenticator-secret">{secret}</div>
          <form onSubmit={verifySetup} className="space-y-3 max-w-sm" av-enable="true" av-suppress-save="true">
            <InputTextField id="verificationCode" value={code} onValueChange={setCode} placeholder={t('settings.securitySettings.enable2fa.verificationCodePlaceholder')} autoComplete="one-time-code" />
            <div className="flex flex-wrap gap-2">
              <Button type="submit">{t('settings.securitySettings.enable2fa.verifyAndEnableButton')}</Button>
              <Button color="outline" onClick={() => navigate('/settings/two-factor')}>{t('common.cancel')}</Button>
            </div>
          </form>
        </div>
      </div>
    </Card>
  );
};

export default TwoFactorEnableStep;
