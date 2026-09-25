import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import SkeletonBase from '@/components/loading/SkeletonBase';
import ModalHeaderAction from '@/components/shared/ModalHeaderAction';
import { useConfirmModal } from '@/context/ConfirmModalContext';
import { useDb } from '@/context/DbContext';
import { useNotifications } from '@/context/NotificationContext';
import { useWebApi } from '@/context/WebApiContext';
import { useEmailBody } from '@/hooks/useEmailBody';
import { type EmailAttachmentViewModel, type EmailViewModel, getAttachmentBytes, spamOkRequest } from '@/utils/EmailViewModel';
import { downloadBytes } from '@/utils/FileDownload';
import { itemRoute } from '@/utils/ItemRoute';

import type { ItemRef } from '@aliasvault/client/database/ItemRef';

type EmailModalProps = {
  email: EmailViewModel | null;
  onClose: () => void;
  onEmailDeleted: (emailId: number) => void;
  showItemLink?: boolean;
};

/**
 * A single skeleton line.
 */
const SkeletonLine: React.FC<{ height: number; widthClass: string }> = ({ height, widthClass }) => (
  <SkeletonBase height={height} additionalClasses={widthClass}>
    <div className="w-full h-full bg-gray-300 dark:bg-gray-600 rounded"></div>
  </SkeletonBase>
);

/**
 * Modal showing a single email.
 */
const EmailModal: React.FC<EmailModalProps> = ({ email, onClose, onEmailDeleted, showItemLink = false }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dbContext = useDb();
  const webApi = useWebApi();
  const notifications = useNotifications();
  const { showConfirmation } = useConfirmModal();
  const [isBodyLoading, setIsBodyLoading] = useState(false);
  const [item, setItem] = useState<{ ref: ItemRef; name: string } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onBodyLoading = useCallback((loading: boolean): void => setIsBodyLoading(loading), []);
  const { emailBody, availableModes, formatLabel, cycleViewMode } = useEmailBody(email, onBodyLoading);

  useEffect(() => {
    /**
     * Enter and Escape close the modal.
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === 'Enter') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return (): void => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  /*
   * Resolve the vault item that owns the recipient address when the caller asks for the item row. SpamOK mail is not
   * backed by a vault item, so the lookup is skipped.
   */
  useEffect(() => {
    setItem(null);
    if (!showItemLink || !email || email.isSpamOk || !dbContext.sqliteClient) {
      return;
    }
    const match = dbContext.sqliteClient.items.findIdByEmail(`${email.toLocal}@${email.toDomain}`.toLowerCase());
    if (match) {
      setItem({ ref: { Id: match.Id, ManifestId: match.ManifestId }, name: match.Name ?? '' });
    }
  }, [dbContext.sqliteClient, email, showItemLink]);

  /**
   * Close on a click on the backdrop. The confirm modal renders outside the panel, so its clicks must not close.
   */
  const onBackdropClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  /**
   * Delete the email after confirmation.
   */
  const showDeleteConfirmation = async (): Promise<void> => {
    if (!email) {
      return;
    }
    const confirmed = await showConfirmation(t('components.main.email.emailModal.DeleteEmailTitle'), t('components.main.email.emailModal.DeleteEmailConfirmation'), t('sharedResources.Confirm'), t('sharedResources.Cancel'));
    if (!confirmed) {
      return;
    }

    try {
      if (email.isSpamOk) {
        const response = await spamOkRequest('DELETE', `Email/${email.toLocal}/${email.id}`);
        if (!response.ok) {
          notifications.addErrorMessage(`${t('components.main.email.emailModal.EmailDeleteFailed')}: ${await response.text()}`, true);
          return;
        }
        onEmailDeleted(email.id);
        notifications.addSuccessMessage(t('components.main.email.emailModal.EmailDeletedSuccess'), true);
        onClose();
      } else {
        await webApi.delete(`Email/${email.id}`);
        onEmailDeleted(email.id);
        notifications.addSuccessMessage(t('components.main.email.emailModal.EmailDeletedSuccess'), true);
      }
    } catch (error) {
      notifications.addErrorMessage(`${t('components.main.email.emailModal.EmailDeleteFailed')}: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  };

  /**
   * Download an attachment.
   */
  const downloadAttachment = async (attachment: EmailAttachmentViewModel): Promise<void> => {
    if (!email || !dbContext.sqliteClient) {
      return;
    }
    try {
      const bytes = await getAttachmentBytes(webApi, dbContext.sqliteClient, email, attachment);
      if (!bytes) {
        notifications.addErrorMessage(t('components.main.email.emailModal.AttachmentDownloadFailed'), true);
        return;
      }
      downloadBytes(attachment.filename, bytes, attachment.mimeType);
    } catch (error) {
      notifications.addErrorMessage(`${t('components.main.email.emailModal.AttachmentDownloadError')}: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  };

  return (
    <div className="modal-dialog fixed inset-0 z-50 overflow-auto bg-gray-500 bg-opacity-75 flex items-center justify-center" onClick={onBackdropClick}>
      <div ref={panelRef} id="emailModal" className="relative bg-white dark:bg-gray-800 w-3/4 flex flex-col rounded-lg shadow-xl max-h-[90vh] border border-gray-200 dark:border-gray-700">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 truncate min-w-0">
              {email === null
                ? <SkeletonLine height={28} widthClass="w-3/4" />
                : email.isSpamOk
                  ? <a target="_blank" rel="noreferrer" href={`https://spamok.com/${email.toLocal}/${email.id}`} className="hover:underline">{email.subject}</a>
                  : <span>{email.subject}</span>}
            </h2>
            <div className="flex items-center gap-1 flex-shrink-0">
              {availableModes.length > 1 && (
                <ModalHeaderAction onClick={cycleViewMode} title={t('sharedResources.EmailFormatSwitchTitle')}>{formatLabel}</ModalHeaderAction>
              )}
              {email !== null && (
                <ModalHeaderAction onClick={() => void showDeleteConfirmation()} title={t('components.main.email.emailModal.DeleteButton')} variant="danger">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </ModalHeaderAction>
              )}
              <ModalHeaderAction onClick={onClose} title={t('sharedResources.Close')}>
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </ModalHeaderAction>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 text-sm text-gray-500 dark:text-gray-400">
            {email === null ? (
              <>
                <div className="space-y-2">
                  <SkeletonLine height={16} widthClass="w-1/2" />
                  <SkeletonLine height={16} widthClass="w-1/2" />
                </div>
                <div className="space-y-2 mt-2 sm:mt-0">
                  <SkeletonLine height={16} widthClass="w-1/3" />
                  <SkeletonLine height={16} widthClass="w-1/4" />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <p>{t('components.main.email.emailModal.FromLabel')} {email.fromLocal}@{email.fromDomain}</p>
                  <p>{t('components.main.email.emailModal.ToLabel')} {email.toLocal}@{email.toDomain}</p>
                </div>
                <div className="space-y-1 mt-1 sm:mt-0">
                  <p>{t('components.main.email.emailModal.DateLabel')} {new Date(email.dateSystem).toLocaleString()}</p>
                  {showItemLink && (item !== null && item.name.length > 0 ? (
                    <p>
                      <span className="font-medium">{t('sharedResources.EmailItemLabel')}</span>{' '}
                      <button type="button" onClick={() => navigate(itemRoute(item.ref))} className="text-primary-600 hover:underline dark:text-primary-400 cursor-pointer">{item.name}</button>
                    </p>
                  ) : (
                    <p>
                      <span className="font-medium">{t('sharedResources.EmailItemLabel')}</span>{' '}
                      <span className="text-gray-400 dark:text-gray-500">{t('sharedResources.EmailItemNone')}</span>
                    </p>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="text-gray-700 dark:text-gray-300">
            {/* Mount only once the body exists to prevent browsers from dropping a srcdoc change made while the initial empty srcdoc still loads. */}
            {email === null || isBodyLoading || emailBody === '' ? (
              <div className="space-y-3" style={{ height: '500px' }}>
                <SkeletonLine height={16} widthClass="w-11/12" />
                <SkeletonLine height={16} widthClass="w-full" />
                <SkeletonLine height={16} widthClass="w-10/12" />
                <SkeletonLine height={16} widthClass="w-5/6" />
                <SkeletonLine height={16} widthClass="w-2/3" />
              </div>
            ) : (
              <div>
                <iframe title="email" className="w-full overscroll-y-auto bg-white rounded" style={{ height: '500px' }} srcDoc={emailBody} sandbox="allow-popups allow-popups-to-escape-sandbox"></iframe>
              </div>
            )}
          </div>
          <div className="mt-4">
            {email !== null && email.attachments.length > 0 && (
              <div className="border-t border-gray-200 dark:border-gray-600 pt-4">
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">{t('components.main.email.emailModal.AttachmentsLabel')}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {email.attachments.map((attachment) => (
                    <div key={attachment.index} className="flex items-center space-x-2">
                      <svg className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"></path>
                      </svg>
                      <button type="button" onClick={() => void downloadAttachment(attachment)} className="text-primary-600 hover:underline text-sm truncate dark:text-primary-400 attachment-link">
                        ({Math.ceil(attachment.size / 1024)} KB) {attachment.filename}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmailModal;
