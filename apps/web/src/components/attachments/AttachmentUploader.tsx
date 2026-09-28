import React, { useRef, useState } from 'react';

import type { Attachment } from '@aliasvault/models/vault';

type AttachmentUploaderProps = {
  attachments: Attachment[];
  onAttachmentsChange: (attachments: Attachment[]) => void;
};

/** Largest file accepted. */
const MAX_FILE_SIZE = 1024 * 1024 * 10;

/**
 * File picker and list for the attachments of an item.
 */
const AttachmentUploader: React.FC<AttachmentUploaderProps> = ({ attachments, onAttachmentsChange }) => {
  const originalIds = useRef<string[]>(attachments.map(a => a.Id));
  const [statusMessage, setStatusMessage] = useState('');
  const visible = attachments.filter(a => !a.IsDeleted);

  /**
   * Read the picked files into new attachments.
   */
  const handleFileSelection = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    setStatusMessage('Uploading...');
    let current = attachments;
    for (const file of files) {
      try {
        if (file.size > MAX_FILE_SIZE) {
          throw new Error(`File exceeds the maximum size of ${MAX_FILE_SIZE / 1024 / 1024} MB.`);
        }
        const now = new Date().toISOString();
        const attachment: Attachment = { Id: crypto.randomUUID(), Filename: file.name, Blob: new Uint8Array(await file.arrayBuffer()), ItemId: '', CreatedAt: now, UpdatedAt: now };
        current = [...current, attachment];
        setStatusMessage('File uploaded successfully.');
      } catch (error) {
        setStatusMessage(`Error uploading file: ${error instanceof Error ? error.message : String(error)}`);
        console.error('Error uploading file.', error);
      }
    }
    onAttachmentsChange(current);
  };

  /**
   * Delete an attachment: original ones are soft deleted, new ones dropped.
   */
  const deleteAttachment = (attachment: Attachment): void => {
    if (originalIds.current.includes(attachment.Id)) {
      onAttachmentsChange(attachments.map(a => a.Id === attachment.Id ? { ...a, IsDeleted: true, UpdatedAt: new Date().toISOString() } : a));
    } else {
      onAttachmentsChange(attachments.filter(a => a.Id !== attachment.Id));
    }
    setStatusMessage('Attachment deleted successfully.');
  };

  return (
    <div className="col-span-6 sm:col-span-3">
      <input type="file" multiple onChange={e => void handleFileSelection(e)} className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 dark:text-gray-400 focus:outline-none dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400" />
      {statusMessage.length > 0 && <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{statusMessage}</p>}
      {visible.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-2 text-lg font-semibold dark:text-white">Attachments:</h4>
          <ul className="list-disc list-inside">
            {visible.map(attachment => (
              <li key={attachment.Id} className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
                {(attachment.Blob?.length ?? 0) > 0
                  ? <span>{attachment.Filename}</span>
                  : <span className="text-gray-400 dark:text-gray-500" title="Attachment data unavailable">{attachment.Filename} (unavailable)</span>}
                <button type="button" onClick={() => deleteAttachment(attachment)} className="text-red-500 hover:text-red-700">Delete</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default AttachmentUploader;
