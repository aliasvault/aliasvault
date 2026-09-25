import { downloadBytes } from '@aliasvault/client/utilities/FileDownload';
import React from 'react';

import type { Attachment } from '@aliasvault/models/vault';

type AttachmentViewerProps = {
  attachments: Attachment[];
};

/**
 * Human readable file size.
 */
const formatSize = (bytes: number): string => {
  const kib = 1024;
  const mib = kib * 1024;
  if (bytes < kib) {
    return `${bytes} B`;
  }
  if (bytes < mib) {
    return `${(bytes / kib).toFixed(1)} KB`;
  }
  return `${(bytes / mib).toFixed(1)} MB`;
};

/**
 * Lists the attachments of an item with download links.
 */
const AttachmentViewer: React.FC<AttachmentViewerProps> = ({ attachments }) => {
  const visible = attachments.filter(a => !a.IsDeleted);

  return (
    <div className="p-4 mb-4 bg-white border border-gray-200 rounded-lg shadow-sm 2xl:col-span-2 dark:border-gray-700 sm:p-6 dark:bg-gray-800">
      <h3 className="mb-4 text-xl font-semibold dark:text-white">Attachments</h3>
      {visible.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-500 dark:text-gray-400">
            <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-700 dark:text-gray-400">
              <tr>
                <th scope="col" className="px-6 py-3">Filename</th>
                <th scope="col" className="px-6 py-3">Size</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((attachment) => {
                const size = attachment.Blob?.length ?? 0;
                return (
                  <tr key={attachment.Id} className="bg-white border-b dark:bg-gray-800 dark:border-gray-700">
                    <td className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap dark:text-white">
                      {size > 0 && attachment.Blob
                        ? <span onClick={() => downloadBytes(attachment.Filename, attachment.Blob!)} className="text-primary cursor-pointer">{attachment.Filename}</span>
                        : <span className="text-gray-400 dark:text-gray-500" title="Attachment data unavailable">{attachment.Filename} (unavailable)</span>}
                    </td>
                    <td className="px-6 py-4">{formatSize(size)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-gray-500 dark:text-gray-400">No attachments available.</p>
      )}
    </div>
  );
};

export default AttachmentViewer;
