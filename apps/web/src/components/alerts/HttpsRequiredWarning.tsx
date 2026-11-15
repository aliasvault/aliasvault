import React from 'react';
import { useTranslation } from 'react-i18next';

import MessageInfo from '@/components/alerts/MessageInfo';

/**
 * Warns that the vault cannot be opened because the page is not a secure context (HTTP on a non-localhost host).
 * Browsers only expose `crypto.subtle` in a secure context, so every vault decryption would fail.
 */
const HttpsRequiredWarning: React.FC = () => {
  const { t } = useTranslation();

  if (window.isSecureContext && globalThis.crypto?.subtle) {
    return null;
  }

  return (
    <MessageInfo title={t('auth.start.httpsWarningTitle')}>
      {t('auth.start.httpsWarningMessage')}
    </MessageInfo>
  );
};

export default HttpsRequiredWarning;
