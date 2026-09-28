import { downloadBytes } from '@aliasvault/client/utilities/FileDownload';
import React from 'react';

import Card from '@/components/shared/Card';
import SectionTitle from '@/components/shared/SectionTitle';

import type { Attachment } from '@aliasvault/models/vault';

type AttachmentViewerProps = {
  attachments: Attachment[];
};

/**
 * Human readable file size: bytes, whole KB below 1 MB, MB with one decimal above.
 */
const formatSize = (bytes: number): string => {
  const kib = 1024;
  const mib = kib * 1024;
  if (bytes < kib) {
    return `${bytes} B`;
  }
  if (bytes < mib) {
    return `${Math.round(bytes / kib)} KB`;
  }
  return `${(bytes / mib).toFixed(1)} MB`;
};

/**
 * Paperclip icon.
 */
const AttachmentIcon: React.FC = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
  </svg>
);

/**
 * Download icon.
 */
const DownloadIcon: React.FC = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
  </svg>
);

/**
 * Lists the attachments of an item as download tiles.
 */
const AttachmentViewer: React.FC<AttachmentViewerProps> = ({ attachments }) => {
  const visible = attachments.filter(a => !a.IsDeleted);

  return (
    <Card variant="section">
      <SectionTitle>Attachments</SectionTitle>
      {visible.length > 0 ? (
        <div className="space-y-2">
          {visible.map((attachment) => {
            const size = attachment.Blob?.length ?? 0;
            const available = size > 0 && attachment.Blob;
            return (
              <button
                key={attachment.Id}
                type="button"
                disabled={!available}
                onClick={() => available && downloadBytes(attachment.Filename, attachment.Blob!)}
                title={available ? attachment.Filename : 'Attachment data unavailable'}
                className="group flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left transition-colors duration-200 enabled:hover:border-gray-300 enabled:hover:bg-gray-100 disabled:cursor-not-allowed dark:border-gray-700 dark:bg-gray-800 dark:enabled:hover:border-gray-700 dark:enabled:hover:bg-gray-700"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-500 transition-colors duration-200 group-enabled:group-hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:group-enabled:group-hover:bg-gray-600">
                  <AttachmentIcon />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm font-medium ${available ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
                    {attachment.Filename}
                  </span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                    {available ? formatSize(size) : 'Unavailable'}
                  </span>
                </span>
                {available && (
                  <span className="shrink-0 text-gray-400 dark:text-gray-500">
                    <DownloadIcon />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-gray-500 dark:text-gray-400">No attachments available.</p>
      )}
    </Card>
  );
};

export default AttachmentViewer;
