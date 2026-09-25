import React from 'react';
import { useTranslation } from 'react-i18next';

import { useConfirmModal } from '@/context/ConfirmModalContext';
import { useDb } from '@/context/DbContext';
import { useNotifications } from '@/context/NotificationContext';
import { useWebApi } from '@/context/WebApiContext';
import { useEmailBody } from '@/hooks/useEmailBody';
import { type EmailAttachmentViewModel, type EmailViewModel, getAttachmentBytes, spamOkRequest } from '@/utils/EmailViewModel';
import { downloadBytes } from '@/utils/FileDownload';

import type { ItemRef } from '@aliasvault/client/database/ItemRef';

type EmailPreviewProps = {
  email: EmailViewModel | null;
  onEmailDeleted: (emailId: number) => void;
  item: { ref: ItemRef; name: string } | null;
  onItemClick: (item: ItemRef) => void;
};

/**
 * The right-hand email panel of the mailbox page.
 */
const EmailPreview: React.FC<EmailPreviewProps> = ({ email, onEmailDeleted, item, onItemClick }) => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const webApi = useWebApi();
  const notifications = useNotifications();
  const { showConfirmation } = useConfirmModal();
  const { emailBody, availableModes, formatLabel, cycleViewMode } = useEmailBody(email);

  /**
   * Delete the email after confirmation.
   */
  const showDeleteConfirmation = async (): Promise<void> => {
    if (!email) {
      return;
    }
    const confirmed = await showConfirmation(t('components.main.email.emailPreview.DeleteEmailTitle'), t('components.main.email.emailPreview.DeleteEmailConfirmation'), t('sharedResources.Confirm'), t('sharedResources.Cancel'));
    if (!confirmed) {
      return;
    }

    try {
      if (email.isSpamOk) {
        const response = await spamOkRequest('DELETE', `Email/${email.toLocal}/${email.id}`);
        if (!response.ok) {
          notifications.addErrorMessage(`${t('components.main.email.emailPreview.EmailDeleteFailed')}: ${await response.text()}`, true);
          return;
        }
      } else {
        await webApi.delete(`Email/${email.id}`);
      }
      onEmailDeleted(email.id);
      notifications.addSuccessMessage(t('components.main.email.emailPreview.EmailDeletedSuccess'), true);
    } catch (error) {
      notifications.addErrorMessage(`${t('components.main.email.emailPreview.EmailDeleteFailed')}: ${error instanceof Error ? error.message : String(error)}`, true);
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
        notifications.addErrorMessage(t('components.main.email.emailPreview.AttachmentDownloadFailed'), true);
        return;
      }
      downloadBytes(attachment.filename, bytes, attachment.mimeType);
    } catch (error) {
      notifications.addErrorMessage(`${t('components.main.email.emailPreview.AttachmentDownloadError')}: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  };

  return (
    <div className="h-full flex flex-col bg-white border-l border-gray-200 dark:border-gray-700 rounded-l-lg">
      {email !== null ? (
        <>
          <div className="p-4 border-b border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">
                {email.isSpamOk
                  ? <a target="_blank" rel="noreferrer" href={`https://spamok.com/${email.toLocal}/${email.id}`} className="hover:underline">{email.subject}</a>
                  : <span>{email.subject}</span>}
              </h2>
              <div className="flex items-center gap-2">
                {availableModes.length > 1 && (
                  <button type="button" onClick={cycleViewMode} title={t('sharedResources.EmailFormatSwitchTitle')} className="text-xs font-medium px-2 py-1 rounded text-gray-600 hover:text-gray-800 hover:bg-gray-200 dark:text-gray-300 dark:hover:text-gray-100 dark:hover:bg-gray-600">
                    {formatLabel}
                  </button>
                )}
                <button type="button" onClick={() => void showDeleteConfirmation()} id="delete-email" className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-gray-600 dark:text-gray-300">
              <div className="space-y-1">
                <p><span className="font-medium">{t('components.main.email.emailPreview.FromLabel')}</span> {email.fromLocal}@{email.fromDomain}</p>
                <p><span className="font-medium">{t('components.main.email.emailPreview.ToLabel')}</span> {email.toLocal}@{email.toDomain}</p>
              </div>
              <div className="space-y-1">
                <p><span className="font-medium">{t('components.main.email.emailPreview.DateLabel')}</span> {new Date(email.dateSystem).toLocaleString()}</p>
                {item !== null && item.name.length > 0 ? (
                  <p><span className="font-medium">{t('sharedResources.EmailItemLabel')}</span>{' '}
                    <button type="button" onClick={() => onItemClick(item.ref)} className="text-primary-600 hover:underline dark:text-primary-400 cursor-pointer">{item.name}</button>
                  </p>
                ) : (
                  <p><span className="font-medium">{t('sharedResources.EmailItemLabel')}</span> <span className="text-gray-400 dark:text-gray-500">{t('sharedResources.EmailItemNone')}</span></p>
                )}
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4">
              <div className="text-gray-700 dark:text-gray-300 h-full">
                {/* Mount only once the body exists to prevent browsers from dropping a srcdoc change made while the initial empty srcdoc still loads. */}
                {emailBody !== '' && <iframe title="email" className="w-full h-full border-0" srcDoc={emailBody} sandbox="allow-popups allow-popups-to-escape-sandbox"></iframe>}
              </div>
            </div>

            {email.attachments.length > 0 && (
              <div className="border-t border-gray-200 dark:border-gray-600 p-4 bg-gray-50 dark:bg-gray-800">
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">{t('components.main.email.emailPreview.AttachmentsLabel')}</h3>
                <div className="grid grid-cols-1 gap-2 max-h-32 overflow-y-auto">
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
        </>
      ) : (
        <div className="flex bg-gray-50 dark:bg-gray-700 items-center justify-center h-full text-gray-500 dark:text-gray-400">
          <div className="text-center">
            <svg className="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <p className="mt-2 text-sm">{t('components.main.email.emailPreview.SelectEmailMessage')}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmailPreview;
