import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';

import Modal from '@/entrypoints/popup/components/Dialogs/Modal';
import LoadingSpinner from '@/entrypoints/popup/components/LoadingSpinner';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';
import ConversionUtility from '@/entrypoints/popup/utils/ConversionUtility';
import { PopoutUtility } from '@/entrypoints/popup/utils/PopoutUtility';

import type { EmailAttachment, Email } from '@/utils/dist/core/models/webapi';
import EncryptionUtility from '@/utils/EncryptionUtility';

import { useMinDurationLoading } from '@/hooks/useMinDurationLoading';

import HeaderButton from '../../components/HeaderButton';
import { HeaderIconType } from '../../components/Icons/HeaderIcons';

/**
 * Email details page.
 */
const EmailDetails: React.FC = (): React.ReactElement => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Where the email was opened from (e.g. the owning item); set by the recent-emails list.
  const fromPath = searchParams.get('returnTo');
  const dbContext = useDb();
  const webApi = useWebApi();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<Email | null>(null);
  const [isLoading, setIsLoading] = useMinDurationLoading(true, 150);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  const [viewMode, setViewMode] = useState<'html' | 'plain' | 'source'>('html');
  const [credential, setCredential] = useState<{ id: string; name: string } | null>(null);
  const { setIsInitialLoading } = useLoading();
  const { setHeaderButtons } = useHeaderButtons();

  useEffect(() => {
    // For expanded windows, ensure we have proper history state for navigation.
    const isExpandedWindow = new URLSearchParams(window.location.search).get('expanded') === 'true';
    if (isExpandedWindow) {
      const parentPath = PopoutUtility.getReturnPath() ?? '/emails';
      window.history.replaceState({}, '', `popup.html#${parentPath}`);
      window.history.pushState({}, '', `popup.html#/emails/${id}`);
    }

    /**
     * Load the email.
     */
    const loadEmail = async () : Promise<void> => {
      try {
        setIsLoading(true);
        setError(null);

        if (!dbContext?.sqliteClient || !id) {
          return;
        }

        // Check if we are in offline mode
        if (dbContext.isOffline) {
          setError(t('emails.offlineMessage'));
          setIsLoading(false);
          setIsInitialLoading(false);
          return;
        }

        const response = await webApi.get<Email>(`Email/${id}`);

        // Decrypt email locally using public/private key pairs
        const encryptionKeys = dbContext.sqliteClient.settings.getAllEncryptionKeys();
        const decryptedEmail = await EncryptionUtility.decryptEmail(response, encryptionKeys);
        setEmail(decryptedEmail);

        // Set initial view mode based on available content
        if (decryptedEmail.messageHtml) {
          setViewMode('html');
        } else if (decryptedEmail.messagePlain) {
          setViewMode('plain');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setIsLoading(false);
        setIsInitialLoading(false);
      }
    };

    loadEmail();
  }, [id, dbContext?.sqliteClient, dbContext.isOffline, t, webApi, setIsLoading, setIsInitialLoading]);

  /*
   * Resolve the credential (item) that owns the recipient address for this email so we can
   * surface a deep link to it from the metadata panel, mirroring the web app's behaviour.
   */
  useEffect(() => {
    if (!email || !dbContext?.sqliteClient) {
      setCredential(null);
      return;
    }

    const address = `${email.toLocal}@${email.toDomain}`;
    const match = dbContext.sqliteClient.items.findIdByEmail(address);
    setCredential(match ? { id: match.Id, name: match.Name ?? address } : null);
  }, [email, dbContext?.sqliteClient]);

  // Available view modes for the cycle button — only formats the server actually provided.
  const availableModes = useMemo<Array<'html' | 'plain' | 'source'>>(() => {
    if (!email) {
      return [];
    }
    const modes: Array<'html' | 'plain' | 'source'> = [];
    if (email.messageHtml) {
      modes.push('html');
    }
    if (email.messagePlain) {
      modes.push('plain');
    }
    if (email.messageSource) {
      modes.push('source');
    }
    return modes;
  }, [email]);

  const formatLabels = useMemo<Record<'html' | 'plain' | 'source', string>>(() => ({
    html: t('emails.formatHtml'),
    plain: t('emails.formatPlain'),
    source: t('emails.formatSource'),
  }), [t]);

  const cycleViewMode = useCallback(() => {
    if (availableModes.length <= 1) {
      return;
    }
    const idx = availableModes.indexOf(viewMode);
    const next = availableModes[(idx + 1) % availableModes.length];
    setViewMode(next);
  }, [availableModes, viewMode]);

  /**
   * Handle deleting an email.
   */
  const handleDelete = useCallback(async () : Promise<void> => {
    try {
      await webApi.delete(`Email/${id}`);
      // Go back to wherever the email was opened from.
      if (window.history.length > 1) {
        navigate(-1);
      } else {
        navigate(fromPath ?? '/emails');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete email');
    }
  }, [id, webApi, navigate, fromPath]);

  /**
   * Open the email details in a new expanded popup.
   */
  const openInNewPopup = useCallback((): void => {
    // Carry the origin into the new window so its back/delete returns there.
    PopoutUtility.openInNewPopup(`/emails/${id}`, fromPath ?? undefined);
  }, [id, fromPath]);

  /**
   * Handle downloading an attachment.
   */
  const handleDownloadAttachment = async (attachment: EmailAttachment): Promise<void> => {
    try {
      // Get the encrypted attachment bytes from the API
      const encryptedBytes = await webApi.downloadBlob(`Email/${id}/attachments/${attachment.id}`);

      if (!dbContext?.sqliteClient || !email) {
        setError('Database context or email not available');
        return;
      }

      // Get encryption keys for decryption
      const encryptionKeys = dbContext.sqliteClient.settings.getAllEncryptionKeys();

      // Decrypt the attachment using raw bytes
      const decryptedBytes = await EncryptionUtility.decryptAttachment(encryptedBytes, email, encryptionKeys);

      if (!decryptedBytes) {
        setError('Failed to decrypt attachment');
        return;
      }

      // Create Blob directly from Uint8Array
      const blob = new Blob([new Uint8Array(decryptedBytes)], {
        type: attachment.mimeType ?? 'application/octet-stream'
      });

      // Create download link and trigger download
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = attachment.filename;
      document.body.appendChild(a);
      a.click();

      // Cleanup
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('handleDownloadAttachment error', err);
      setError(err instanceof Error ? err.message : 'Failed to download attachment');
    }
  };

  /*
   * Set header buttons whenever the available formats or active view mode change so the
   * format-cycle button label stays in sync. Mirrors the web app's header layout.
   */
  useEffect((): (() => void) => {
    const headerButtonsJSX = (
      <div className="flex items-center gap-2">
        {availableModes.length > 1 && (
          <button
            onClick={cycleViewMode}
            title={t('emails.formatSwitchTitle')}
            className="h-9 px-2 rounded-lg inline-flex items-center text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            {formatLabels[viewMode]}
          </button>
        )}
        {!PopoutUtility.isPopup() && (
          <HeaderButton
            onClick={openInNewPopup}
            title={t('common.openInNewWindow')}
            iconType={HeaderIconType.EXPAND}
          />
        )}
        <HeaderButton
          onClick={() => setShowDeleteModal(true)}
          title={t('emails.deleteEmailTitle')}
          iconType={HeaderIconType.DELETE}
          variant="danger"
        />
      </div>
    );

    setHeaderButtons(headerButtonsJSX);
    return () => {};
  }, [setHeaderButtons, openInNewPopup, t, availableModes, viewMode, cycleViewMode, formatLabels]);

  // Clear header buttons on unmount
  useEffect((): (() => void) => {
    return () => setHeaderButtons(null);
  }, [setHeaderButtons]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-8">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return <div className="text-red-500">{t('common.error')} {error}</div>;
  }

  if (!email) {
    return <div className="text-gray-500">{t('emails.emailNotFound')}</div>;
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
        title={t('emails.deleteEmailTitle')}
        message={t('emails.deleteEmailConfirm')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="danger"
      />

      <div>
        {/* Header */}
        <div>
          <div className="flex justify-between items-start gap-2">
            <div className="flex items-start gap-2 min-w-0">
              {/* Subject is truncated by default; expanding the (i) panel lets the full subject
                  wrap so users can read or copy long subjects without losing context. */}
              <h1 className={`text-lg font-bold text-gray-900 dark:text-white ${showMetadata ? 'break-words' : 'truncate'}`}>{email.subject}</h1>
              <button
                onClick={() => setShowMetadata(!showMetadata)}
                className={`p-1 rounded-full transition-colors flex-shrink-0 ${showMetadata ? 'bg-gray-200 dark:bg-gray-700 text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                title={showMetadata ? t('common.hideDetails') : t('common.showDetails')}
                aria-expanded={showMetadata}
              >
                <svg
                  className="w-4 h-4"
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
          </div>
          {showMetadata && (
            <div className="space-y-1 text-sm text-gray-600 dark:text-gray-400 mt-2">
              <p><span className="font-bold">{t('emails.from')}</span> <span title={email.fromLocal + "@" + email.fromDomain}>{email.fromDisplay}</span></p>
              <p><span className="font-bold">{t('emails.to')}</span> <span title={email.toLocal + "@" + email.toDomain}>{email.toLocal}@{email.toDomain}</span></p>
              <p><span className="font-bold">{t('emails.date')}</span> {new Date(email.dateSystem).toLocaleString()}</p>
              {credential && (
                <p>
                  <span className="font-bold">{t('emails.item')}</span>{' '}
                  <Link
                    to={`/items/${credential.id}`}
                    className="text-primary-600 hover:underline dark:text-primary-400"
                  >
                    {credential.name}
                  </Link>
                </p>
              )}
            </div>
          )}
        </div>

        {/* Email Body — always rendered on a white background with dark text so contrast doesn't break in dark mode. */}
        <div className="bg-white mt-4">
          {viewMode === 'html' && email.messageHtml ? (
            <iframe
              srcDoc={ConversionUtility.sanitizeAndPrepareEmailHtml(email.messageHtml)}
              className="w-full min-h-[500px] border-0"
              title={t('emails.emailContent')}
              sandbox="allow-popups allow-popups-to-escape-sandbox"
            />
          ) : viewMode === 'plain' ? (
            <pre className="whitespace-pre-wrap text-gray-800 p-3 font-sans">
              {email.messagePlain ?? t('emails.emailNotFound')}
            </pre>
          ) : viewMode === 'source' ? (
            <pre className="whitespace-pre-wrap text-gray-800 p-3 font-mono text-xs leading-relaxed">
              {email.messageSource ?? t('emails.emailNotFound')}
            </pre>
          ) : (
            <pre className="whitespace-pre-wrap text-gray-800 p-3">
              {email.messagePlain}
            </pre>
          )}
        </div>

        {/* Attachments */}
        {email.attachments && email.attachments.length > 0 && (
          <div className="p-6 border-t border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
              {t('common.attachments')}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {email.attachments.map((attachment) => (
                <button
                  key={attachment.id}
                  onClick={() => handleDownloadAttachment(attachment)}
                  className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 text-left"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                    />
                  </svg>
                  <span>
                    {attachment.filename} ({Math.ceil(attachment.filesize / 1024)} KB)
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EmailDetails;