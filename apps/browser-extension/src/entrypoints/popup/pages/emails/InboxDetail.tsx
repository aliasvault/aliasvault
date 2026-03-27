import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';

import Modal from '@/entrypoints/popup/components/Dialogs/Modal';
import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import LoadingSpinner from '@/entrypoints/popup/components/LoadingSpinner';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { PopoutUtility } from '@/entrypoints/popup/utils/PopoutUtility';
import { useMinDurationLoading } from '@/hooks/useMinDurationLoading';

import { decryptEmailBlob, DecryptedEmail } from '@/services/EmailDecryptionService';
import { emailCacheService } from '@/services/EmailCacheService';
import { assertInboxCIDv1 } from '@/services/InboxService';
import { PinataBrowserProvider } from '@/services/PinataBrowserProvider';
import { getEmailKeyPairFromSettings } from '@/utils/emailKeyPair';

/**
 * Parse combined "from" field into display name and email address.
 * Handles "John Doe <john@example.com>" → { display: "John Doe", address: "john@example.com" }
 * Falls back to raw string for both fields if no angle-bracket format detected.
 */
export function parseSender(from: string): { display: string; address: string } {
  const match = from.match(/^(.+?)\s*<(.+?)>$/);
  return match
    ? { display: match[1].trim(), address: match[2] }
    : { display: from, address: from };
}

/**
 * Inbox detail page — displays a single decrypted email from IPFS.
 * Loads from cache when available, otherwise fetches and decrypts from IPFS and caches the result.
 */
const InboxDetail: React.FC = () => {
  const { t } = useTranslation();
  const { cid } = useParams<{ cid: string }>();
  const navigate = useNavigate();
  const dbContext = useDb();
  const { setHeaderButtons } = useHeaderButtons();
  const { setIsInitialLoading } = useLoading();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<DecryptedEmail | null>(null);
  const [isLoading, setIsLoading] = useMinDurationLoading(true, 150);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);

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

  // Load and decrypt email
  useEffect(() => {
    if (!cid || !settings) return;

    const decodedCid = decodeURIComponent(cid);

    // For popup windows, set up proper history
    if (PopoutUtility.isPopup()) {
      window.history.replaceState({}, '', `popup.html#/inbox`);
      window.history.pushState({}, '', `popup.html#/inbox/${cid}`);
    }

    const loadEmail = async (): Promise<void> => {
      try {
        setIsLoading(true);
        setError(null);

        assertInboxCIDv1(decodedCid);

        // Check cache first to avoid redundant IPFS downloads
        const cachedBody = await emailCacheService.getCachedFullBody<DecryptedEmail>(decodedCid);
        if (cachedBody) {
          setEmail(cachedBody);
          await emailCacheService.markAsRead(decodedCid);
          return;
        }

        const keyPair = getEmailKeyPairFromSettings(settings);
        if (!keyPair) {
          setError(t('inbox.errors.noKeyPair', 'Email encryption key not found'));
          return;
        }

        if (!settings.pinataJwt || !settings.pinataGateway) {
          setError(t('inbox.errors.missingPinataConfig', 'IPFS configuration missing'));
          return;
        }

        const pinata = new PinataBrowserProvider({ pinataJwt: settings.pinataJwt, pinataGateway: settings.pinataGateway });
        const blob = await pinata.download(decodedCid);
        const decrypted = decryptEmailBlob(blob, keyPair.secretKey);
        setEmail(decrypted);

        // Cache the full decrypted email body to avoid re-fetching from IPFS
        await emailCacheService.cacheFullBody(decodedCid, decrypted);

        // Mark as read in cache
        await emailCacheService.markAsRead(decodedCid);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('common.errors.unknownError', 'An error occurred'));
      } finally {
        setIsLoading(false);
        setIsInitialLoading(false);
      }
    };

    loadEmail();
  }, [cid, settings, setIsLoading, setIsInitialLoading, t]);

  /**
   * Delete email from local cache and navigate back.
   */
  const handleDelete = useCallback(async (): Promise<void> => {
    if (!cid) return;
    const decodedCid = decodeURIComponent(cid);

    try {
      await emailCacheService.deleteEmail(decodedCid);
      if (PopoutUtility.isPopup()) {
        window.close();
      } else {
        navigate('/inbox');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete email');
    }
  }, [cid, navigate]);

  /**
   * Download attachment as file.
   */
  const handleDownloadAttachment = useCallback(
    (attachment: { name: string; contentType: string; base64: string }) => {
      try {
        const bytes = Uint8Array.from(atob(attachment.base64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: attachment.contentType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = attachment.name;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } catch (err) {
        console.error('Attachment download error:', err);
      }
    },
    [],
  );

  // Header buttons
  useEffect((): (() => void) => {
    const headerButtonsJSX = (
      <div className="flex items-center gap-2">
        {!PopoutUtility.isPopup() && (
          <HeaderButton
            onClick={() => PopoutUtility.openInNewPopup(`/inbox/${cid}`)}
            title={t('common.openInNewWindow', 'Open in new window')}
            iconType={HeaderIconType.EXPAND}
          />
        )}
        <HeaderButton
          onClick={() => setShowDeleteModal(true)}
          title={t('emails.deleteEmailTitle', 'Delete email')}
          iconType={HeaderIconType.DELETE}
          variant="danger"
        />
      </div>
    );

    setHeaderButtons(headerButtonsJSX);
    return () => setHeaderButtons(null);
  }, [setHeaderButtons, cid, t]);

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
          onClick={() => navigate('/inbox')}
          className="text-primary-600 dark:text-primary-400 hover:underline"
        >
          {t('inbox.backToInbox', 'Back to inbox')}
        </button>
      </div>
    );
  }

  if (!email) {
    return <div className="text-gray-500 p-4">{t('emails.emailNotFound', 'Email not found')}</div>;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={() => {
          setShowDeleteModal(false);
          void handleDelete();
        }}
        title={t('emails.deleteEmailTitle', 'Delete email')}
        message={t('emails.deleteEmailConfirm', 'Are you sure you want to delete this email?')}
        confirmText={t('common.delete', 'Delete')}
        cancelText={t('common.cancel', 'Cancel')}
        variant="danger"
      />

      <div>
        {/* Subject + metadata toggle */}
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">{email.subject}</h1>
            <button
              onClick={() => setShowMetadata(!showMetadata)}
              className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title={showMetadata ? t('common.hideDetails', 'Hide details') : t('common.showDetails', 'Show details')}
            >
              <svg
                className={`w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform ${showMetadata ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </button>
          </div>
          {showMetadata && (
            <div className="space-y-1 text-sm text-gray-600 dark:text-gray-400 mt-2">
              <p><span className="font-bold">{t('emails.from', 'From:')}</span> <span title={parseSender(email.from).address}>{parseSender(email.from).display}</span></p>
              <p><span className="font-bold">{t('emails.to', 'To:')}</span> {email.to}</p>
              <p><span className="font-bold">{t('emails.date', 'Date:')}</span> {new Date(email.receivedAt * 1000).toLocaleString()}</p>
            </div>
          )}
        </div>

        {/* Email body */}
        <div className="bg-white dark:bg-gray-800 mt-4 rounded-lg">
          <pre className="whitespace-pre-wrap text-gray-800 dark:text-gray-200 p-3 text-sm">
            {email.body}
          </pre>
        </div>

        {/* Attachments */}
        {email.attachments && email.attachments.length > 0 && (
          <div className="mt-4 p-4 border-t border-gray-200 dark:border-gray-700">
            <h2 className="text-sm font-semibold mb-2 text-gray-900 dark:text-white">
              {t('emails.attachments', 'Attachments')}
            </h2>
            <div className="space-y-2">
              {email.attachments.map((attachment, index) => (
                <button
                  key={index}
                  onClick={() => handleDownloadAttachment(attachment)}
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                    />
                  </svg>
                  <span>{attachment.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default InboxDetail;
