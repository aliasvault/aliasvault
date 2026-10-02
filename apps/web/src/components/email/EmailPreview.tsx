import { downloadBytes } from '@aliasvault/client/utilities/FileDownload';
import React from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '@/components/shared/Icon';
import { useConfirmModal } from '@/context/ConfirmModalContext';
import { useDb } from '@/context/DbContext';
import { useNotifications } from '@/context/NotificationContext';
import { useWebApi } from '@/context/WebApiContext';
import { useEmailBody } from '@/hooks/useEmailBody';
import { type EmailAttachmentViewModel, type EmailViewModel, getAttachmentBytes, spamOk } from '@/utils/EmailViewModel';

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
    const confirmed = await showConfirmation(t('emails.deleteEmail'), t('emails.modal.deleteEmailConfirmation'), t('common.confirm'), t('common.cancel'));
    if (!confirmed) {
      return;
    }

    try {
      if (email.isSpamOk) {
        const response = await spamOk.request('DELETE', `Email/${encodeURIComponent(email.toLocal)}/${email.id}`);
        if (!response.ok) {
          notifications.addErrorMessage(`${t('emails.modal.emailDeleteFailed')}: ${await response.text()}`, true);
          return;
        }
      } else {
        await webApi.delete(`Email/${email.id}`);
      }
      onEmailDeleted(email.id);
      notifications.addSuccessMessage(t('emails.modal.emailDeletedSuccess'), true);
    } catch (error) {
      notifications.addErrorMessage(`${t('emails.modal.emailDeleteFailed')}: ${error instanceof Error ? error.message : String(error)}`, true);
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
        notifications.addErrorMessage(t('common.attachmentDownloadFailed'), true);
        return;
      }
      downloadBytes(attachment.filename, bytes, attachment.mimeType);
    } catch (error) {
      notifications.addErrorMessage(`${t('emails.modal.attachmentDownloadError')}: ${error instanceof Error ? error.message : String(error)}`, true);
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
                  <button type="button" onClick={cycleViewMode} title={t('emails.formatSwitchTitle')} className="text-xs font-medium px-2 py-1 rounded text-gray-600 hover:text-gray-800 hover:bg-gray-200 dark:text-gray-300 dark:hover:text-gray-100 dark:hover:bg-gray-600">
                    {formatLabel}
                  </button>
                )}
                <button type="button" onClick={() => void showDeleteConfirmation()} id="delete-email" className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300">
                  <Icon name="trash" className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-gray-600 dark:text-gray-300">
              <div className="space-y-1">
                <p><span className="font-medium">{t('emails.from')}</span> {email.fromLocal}@{email.fromDomain}</p>
                <p><span className="font-medium">{t('emails.to')}</span> {email.toLocal}@{email.toDomain}</p>
              </div>
              <div className="space-y-1">
                <p><span className="font-medium">{t('emails.date')}</span> {new Date(email.dateSystem).toLocaleString()}</p>
                {item !== null && item.name.length > 0 ? (
                  <p><span className="font-medium">{t('common.emailItemLabel')}</span>{' '}
                    <button type="button" onClick={() => onItemClick(item.ref)} className="text-primary-600 hover:underline dark:text-primary-400 cursor-pointer">{item.name}</button>
                  </p>
                ) : (
                  <p><span className="font-medium">{t('common.emailItemLabel')}</span> <span className="text-gray-400 dark:text-gray-500">{t('common.none')}</span></p>
                )}
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4">
              <div className="text-gray-700 dark:text-gray-300 h-full">
                {/* Mount only once the body exists to prevent browsers from dropping a srcdoc change made while the initial empty srcdoc still loads. */}
                {emailBody !== '' && <iframe title={t('common.email')} className="w-full h-full border-0" srcDoc={emailBody} sandbox="allow-popups allow-popups-to-escape-sandbox"></iframe>}
              </div>
            </div>

            {email.attachments.length > 0 && (
              <div className="border-t border-gray-200 dark:border-gray-600 p-4 bg-gray-50 dark:bg-gray-800">
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">{t('common.attachments')}</h3>
                <div className="grid grid-cols-1 gap-2 max-h-32 overflow-y-auto">
                  {email.attachments.map((attachment) => (
                    <div key={attachment.index} className="flex items-center space-x-2">
                      <Icon name="paper-clip" className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
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
            <Icon name="mail" className="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" />
            <p className="mt-2 text-sm">{t('emails.preview.selectEmailMessage')}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmailPreview;
