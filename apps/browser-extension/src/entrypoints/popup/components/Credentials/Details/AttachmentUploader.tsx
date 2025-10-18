import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Attachment } from '@/utils/dist/shared/models/vault';

type AttachmentUploaderProps = {
  attachments: Attachment[];
  onAttachmentsChange: (attachments: Attachment[]) => void;
}

/**
 * This component allows uploading and managing attachments for a credential.
 */
const AttachmentUploader: React.FC<AttachmentUploaderProps> = ({
  attachments,
  onAttachmentsChange
}) => {
  const { t } = useTranslation();
  const [statusMessage, setStatusMessage] = useState<string>('');

  /**
   * Handles file selection and upload.
   */
  const handleFileSelection = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }

    setStatusMessage('Uploading...');

    try {
      const newAttachments = [...attachments];

      for (const file of Array.from(files)) {
        const arrayBuffer = await file.arrayBuffer();
        const byteArray = new Uint8Array(arrayBuffer);

        const attachment: Attachment = {
          Id: crypto.randomUUID(),
          Filename: file.name,
          Blob: byteArray,
          CredentialId: '', // Will be set when saving credential
          CreatedAt: new Date().toISOString(),
          UpdatedAt: new Date().toISOString(),
          IsDeleted: false,
        };

        newAttachments.push(attachment);
      }

      onAttachmentsChange(newAttachments);
      setStatusMessage('Files uploaded successfully.');

      // Clear status message after 3 seconds
      setTimeout(() => setStatusMessage(''), 3000);
    } catch (error) {
      console.error('Error uploading files:', error);
      setStatusMessage('Error uploading files.');
      setTimeout(() => setStatusMessage(''), 3000);
    }

    // Reset file input
    event.target.value = '';
  };

  /**
   * Deletes an attachment.
   */
  const deleteAttachment = (attachmentToDelete: Attachment): void => {
    try {
      const updatedAttachments = [...attachments];

      // Remove attachment from array
      const index = updatedAttachments.findIndex(a => a.Id === attachmentToDelete.Id);
      if (index !== -1) {
        updatedAttachments.splice(index, 1);
      }

      onAttachmentsChange(updatedAttachments);
      setStatusMessage('Attachment deleted successfully.');
      setTimeout(() => setStatusMessage(''), 3000);
    } catch (error) {
      console.error('Error deleting attachment:', error);
      setStatusMessage('Error deleting attachment.');
      setTimeout(() => setStatusMessage(''), 3000);
    }
  };

  const activeAttachments = attachments.filter(a => !a.IsDeleted);

  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
      <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">{t('common.attachments')}</h2>

      <div className="space-y-4">
        <div>
          <input
            type="file"
            multiple
            onChange={handleFileSelection}
            className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 dark:text-gray-400 focus:outline-none dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400"
          />
          {statusMessage && (
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{statusMessage}</p>
          )}
        </div>

        {activeAttachments.length > 0 && (
          <div>
            <h4 className="mb-2 text-md font-medium text-gray-900 dark:text-white">Current attachments:</h4>
            <div className="space-y-2">
              {activeAttachments.map(attachment => (
                <div
                  key={attachment.Id}
                  className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600"
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {attachment.Filename}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {new Date(attachment.CreatedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteAttachment(attachment)}
                    className="text-red-500 hover:text-red-700 focus:outline-none"
                    aria-label={`Delete ${attachment.Filename}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AttachmentUploader;
