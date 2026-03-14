import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { sendMessage } from 'webext-bridge/popup';

import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import LoadingSpinner from '@/entrypoints/popup/components/LoadingSpinner';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { PopoutUtility } from '@/entrypoints/popup/utils/PopoutUtility';
import { useMinDurationLoading } from '@/hooks/useMinDurationLoading';

import { EmailCacheService, CachedEmail } from '@/services/EmailCacheService';
import { fetchManifest, getNewEmailCids, fetchAndDecryptEmail } from '@/services/InboxService';
import { MidnightContractService } from '@/services/MidnightContractService';
import { PinataBrowserProvider } from '@/services/PinataBrowserProvider';
import { getEmailKeyPairFromSettings } from '@/utils/emailKeyPair';
import { useEmailSubscription } from '@/hooks/useEmailSubscription';

const cacheService = new EmailCacheService();

/**
 * Inbox list page — blockchain-native IPFS+X25519 email flow.
 * Distinct from legacy EmailsList (WebAPI-backed).
 */
const InboxList: React.FC = () => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const { setHeaderButtons } = useHeaderButtons();
  const { setIsInitialLoading } = useLoading();
  const [error, setError] = useState<string | null>(null);
  const [emails, setEmails] = useState<CachedEmail[]>([]);
  const [isLoading, setIsLoading] = useMinDurationLoading(true, 150);

  const vaultStore = dbContext?.vaultStore;
  const emailPublicKeyHex = vaultStore?.getSetting('emailPublicKey') || null;
  const emailPrivateKeyHex = vaultStore?.getSetting('emailPrivateKey') || null;
  const pinataJwt = vaultStore?.getSetting('pinataJwt') || null;
  const pinataGateway = vaultStore?.getSetting('pinataGateway') || null;

  const settings = useMemo(() => {
    if (!emailPublicKeyHex || !emailPrivateKeyHex) return undefined;
    return {
      emailPublicKey: emailPublicKeyHex,
      emailPrivateKey: emailPrivateKeyHex,
      pinataJwt: pinataJwt ?? '',
      pinataGateway: pinataGateway ?? '',
    };
  }, [emailPublicKeyHex, emailPrivateKeyHex, pinataJwt, pinataGateway]);

  const emailKeyPair = useMemo(
    () => (settings ? getEmailKeyPairFromSettings(settings) : null),
    [settings],
  );

  /**
   * Load emails: read manifest from chain → fetch from IPFS → decrypt new → update cache.
   */
  const loadEmails = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);

      if (!emailKeyPair || !settings) {
        setEmails([]);
        return;
      }

      const contractService = new MidnightContractService();
      const manifestCid = await contractService.readInboxManifestCid();

      if (!manifestCid) {
        // No manifest yet — empty inbox
        const cached = await cacheService.getCachedEmails();
        setEmails(cached);
        return;
      }

      if (!settings.pinataJwt || !settings.pinataGateway) {
        setError(t('inbox.errors.missingPinataConfig', 'IPFS configuration missing'));
        return;
      }

      const pinata = new PinataBrowserProvider({ pinataJwt: settings.pinataJwt, pinataGateway: settings.pinataGateway });
      const manifest = await fetchManifest(pinata, manifestCid);

      // Detect new emails
      const knownCids = await cacheService.getKnownCids();
      const newCids = getNewEmailCids(manifest, knownCids);

      // Fetch and decrypt new emails, cache metadata
      for (const cid of newCids) {
        try {
          const email = await fetchAndDecryptEmail(pinata, cid, emailKeyPair.secretKey);
          await cacheService.cacheEmail({
            cid: email.cid,
            from: email.from,
            to: email.to,
            subject: email.subject,
            bodyPreview: email.body.substring(0, 100),
            receivedAt: email.receivedAt,
            isRead: false,
            cachedAt: Date.now(),
          });
        } catch (err) {
          console.error(`Failed to decrypt email ${cid}:`, err);
        }
      }

      // Save manifest cache
      await cacheService.saveManifestCache(
        manifestCid,
        manifest.emails.map((e) => e.cid),
      );

      const cached = await cacheService.getCachedEmails();
      setEmails(cached.sort((a, b) => b.receivedAt - a.receivedAt));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errors.unknownError', 'An error occurred'));
    } finally {
      setIsLoading(false);
      setIsInitialLoading(false);
    }
  }, [emailKeyPair, settings, setIsLoading, setIsInitialLoading, t]);

  // Load on mount + clear badge
  useEffect(() => {
    loadEmails();
    sendMessage('CLEAR_EMAIL_BADGE', null, 'background').catch(() => {});
  }, [loadEmails]);

  // Real-time subscription: re-fetch on emailCount change
  const contractService = React.useMemo(() => {
    try {
      return new MidnightContractService();
    } catch {
      return null;
    }
  }, []);

  const handleEmailCountChange = useCallback(() => {
    loadEmails();
  }, [loadEmails]);

  useEmailSubscription({
    contractService: contractService as any,
    emailPublicKey: contractService ? emailPublicKeyHex : null,
    onEmailCountChange: handleEmailCountChange,
  });

  // Header buttons
  useEffect((): (() => void) => {
    const headerButtonsJSX = (
      <div className="flex items-center gap-2">
        {!PopoutUtility.isPopup() && (
          <HeaderButton
            onClick={() => PopoutUtility.openInNewPopup('/inbox')}
            title={t('common.openInNewWindow', 'Open in new window')}
            iconType={HeaderIconType.EXPAND}
          />
        )}
        <HeaderButton
          onClick={() => loadEmails()}
          title={t('inbox.refresh', 'Refresh')}
          iconType={HeaderIconType.RELOAD}
        />
      </div>
    );

    setHeaderButtons(headerButtonsJSX);
    return () => setHeaderButtons(null);
  }, [setHeaderButtons, t, loadEmails]);

  /**
   * Format relative timestamp from Unix epoch seconds.
   */
  const formatDate = (unixSeconds: number): string => {
    const now = Date.now();
    const emailTime = unixSeconds * 1000;
    const secondsAgo = Math.floor((now - emailTime) / 1000);

    if (secondsAgo < 60) return t('emails.dateFormat.justNow', 'Just now');
    if (secondsAgo < 3600) {
      const minutes = Math.floor(secondsAgo / 60);
      return `${minutes}m`;
    }
    if (secondsAgo < 86400) {
      const hours = Math.floor(secondsAgo / 3600);
      return `${hours}h`;
    }
    if (secondsAgo < 172800) return t('emails.dateFormat.yesterday', 'Yesterday');
    return new Date(emailTime).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-8">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center p-8">
        <p className="text-red-500 mb-4">{error}</p>
        <button
          onClick={() => loadEmails()}
          className="text-primary-600 dark:text-primary-400 hover:underline"
        >
          {t('common.retry', 'Retry')}
        </button>
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="text-center p-8">
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          {t('inbox.empty', 'No emails yet. Messages sent to your aliases will appear here.')}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="space-y-2">
        {emails.map((email) => (
          <Link
            key={email.cid}
            to={`/inbox/${encodeURIComponent(email.cid)}`}
            className={`block p-4 bg-white dark:bg-gray-800 rounded-lg shadow hover:shadow-md transition-shadow border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 ${
              !email.isRead ? 'border-l-4 border-l-primary-500' : ''
            }`}
          >
            <div className="flex justify-between items-start mb-1">
              <div className={`text-sm truncate mr-2 ${!email.isRead ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300'}`}>
                {email.from}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {formatDate(email.receivedAt)}
              </div>
            </div>
            <div className={`text-sm truncate ${!email.isRead ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-200'}`}>
              {email.subject}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-1">
              {email.bodyPreview}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default InboxList;
