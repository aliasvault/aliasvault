import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useDb } from '@/entrypoints/popup/context/DbContext';

import type { Attachment } from '@/utils/dist/shared/models/vault';

type AttachmentBlockProps = {
  credentialId: string;
}

/**
 * This component shows attachments for a credential.
 */
const AttachmentBlock: React.FC<AttachmentBlockProps> = ({ credentialId }) => {
  const { t } = useTranslation();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const dbContext = useDb();

  /**
   * Downloads an attachment file.
   */
  const downloadAttachment = (attachment: Attachment): void => {
    try {
      // Convert Uint8Array or number[] to Uint8Array
      const byteArray = attachment.Blob instanceof Uint8Array
        ? attachment.Blob
        : new Uint8Array(attachment.Blob);

      // Create blob and download
      const blob = new Blob([byteArray as BlobPart]);
      const url = URL.createObjectURL(blob);

      // Create temporary download link
      const a = document.createElement('a');
      a.href = url;
      a.download = attachment.Filename;
      document.body.appendChild(a);
      a.click();

      // Cleanup
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading attachment:', error);
    }
  };

  useEffect(() => {
    /**
     * Loads the attachments for the credential.
     */
    const loadAttachments = async (): Promise<void> => {
      if (!dbContext?.sqliteClient) {
        return;
      }

      try {
        const attachmentList = dbContext.sqliteClient.getAttachmentsForCredential(credentialId);
        setAttachments(attachmentList);
      } catch (error) {
        console.error('Error loading attachments:', error);
      } finally {
        setLoading(false);
      }
    };

    loadAttachments();
  }, [credentialId, dbContext?.sqliteClient]);

  if (loading) {
    return (
      <div className="text-gray-500 dark:text-gray-400 mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">{t('common.attachments')}</h2>
        {t('common.loadingAttachments')}
      </div>
    );
  }

  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="mb-4">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('common.attachments')}</h2>
        <div className="grid grid-cols-1 gap-2">
          {attachments.map(attachment => (
            <button
              key={attachment.Id}
              className="w-full text-left p-2 ps-3 pe-3 rounded bg-white dark:bg-gray-800 shadow hover:shadow-md transition-all border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
              onClick={() => downloadAttachment(attachment)}
              aria-label={`Download ${attachment.Filename}`}
            >
              <div className="flex justify-between items-center gap-2">
                <div className="flex items-center flex-1">
                  <div className="flex flex-col">
                    <h4 className="text-sm font-medium text-gray-900 dark:text-white">{attachment.Filename}</h4>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {new Date(attachment.CreatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <div className="flex items-center">
                  <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4" />
                  </svg>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AttachmentBlock;