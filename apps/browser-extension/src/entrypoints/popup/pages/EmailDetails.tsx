import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

import LoadingSpinner from '@/entrypoints/popup/components/LoadingSpinner';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';
import ConversionUtility from '@/entrypoints/popup/utils/ConversionUtility';

import EncryptionUtility from '@/utils/EncryptionUtility';
import type { Attachment, Email } from '@/utils/shared/models/webapi';

import { useMinDurationLoading } from '@/hooks/useMinDurationLoading';

/**
 * Email details page.
 */
const EmailDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dbContext = useDb();
  const webApi = useWebApi();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<Email | null>(null);
  const [isLoading, setIsLoading] = useMinDurationLoading(true, 150);
  const { setIsInitialLoading } = useLoading();

  /**
   * Make sure the initial loading state is set to false when this component is loaded itself.
   */
  useEffect(() => {
    if (!isLoading) {
      setIsInitialLoading(false);
    }
  }, [setIsInitialLoading, isLoading]);

  useEffect(() => {
    // For popup windows, ensure we have proper history state for navigation
    if (isPopup()) {
      // Clear existing history and create fresh entries
      window.history.replaceState({}, '', `popup.html#/emails`);
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

        const response = await webApi.get<Email>(`Email/${id}`);

        // Decrypt email locally using public/private key pairs
        const encryptionKeys = dbContext.sqliteClient.getAllEncryptionKeys();
        const decryptedEmail = await EncryptionUtility.decryptEmail(response, encryptionKeys);
        setEmail(decryptedEmail);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setIsLoading(false);
      }
    };

    loadEmail();
  }, [id, dbContext?.sqliteClient, webApi, setIsLoading]);

  /**
   * Handle deleting an email.
   */
  const handleDelete = async () : Promise<void> => {
    try {
      await webApi.delete(`Email/${id}`);
      navigate('/emails');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete email');
    }
  };

  /**
   * Check if the current page is an expanded popup.
   */
  const isPopup = () : boolean => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('expanded') === 'true';
  };

  /**
   * Open the credential details in a new expanded popup.
   */
  const openInNewPopup = () : void => {
    const width = 800;
    const height = 1000;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    window.open(
      `popup.html?expanded=true#/emails/${id}`,
      'EmailDetails',
      `width=${width},height=${height},left=${left},top=${top},popup=true`
    );

    // Close the current tab
    window.close();
  };

  /**
   * Handle downloading an attachment.
   */
  const handleDownloadAttachment = async (attachment: Attachment): Promise<void> => {
    try {
      // Get the encrypted attachment bytes from the API
      const base64EncryptedAttachment = await webApi.downloadBlobAndConvertToBase64(`Email/${id}/attachments/${attachment.id}`);

      if (!dbContext?.sqliteClient || !email) {
        setError('Database context or email not available');
        return;
      }

      // Get encryption keys for decryption
      const encryptionKeys = dbContext.sqliteClient.getAllEncryptionKeys();

      // Decrypt the attachment using ArrayBuffer
      const decryptedBytes = await EncryptionUtility.decryptAttachment(base64EncryptedAttachment, email, encryptionKeys);

      if (!decryptedBytes) {
        setError('Failed to decrypt attachment');
        return;
      }

      // Create blob from decrypted bytes with proper MIME type
      const blob = new Blob([decryptedBytes], { type: attachment.mimeType ?? 'application/octet-stream' });

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

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-8">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return <div className="text-red-500">Error: {error}</div>;
  }

  if (!email) {
    return <div className="text-gray-500">Email not found</div>;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex justify-between items-start mb-4">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{email.subject}</h1>
            <div className="flex space-x-2">
              <button
                onClick={openInNewPopup}
                className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                title="Open in new window"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                  />
                </svg>
              </button>
              <button
                onClick={handleDelete}
                className="p-2 text-red-500 hover:text-red-600 rounded-md hover:bg-red-100 dark:hover:bg-red-900/20"
                title="Delete email"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            </div>
          </div>
          <div className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
            <p>From: {email.fromDisplay} ({email.fromLocal}@{email.fromDomain})</p>
            <p>To: {email.toLocal}@{email.toDomain}</p>
            <p>Date: {new Date(email.dateSystem).toLocaleString()}</p>
          </div>
        </div>

        {/* Email Body */}
        <div className="bg-white">
          {email.messageHtml ? (
            <iframe
              srcDoc={ConversionUtility.convertAnchorTagsToOpenInNewTab(email.messageHtml)}
              className="w-full min-h-[500px] border-0"
              title="Email content"
            />
          ) : (
            <pre className="whitespace-pre-wrap text-gray-700 dark:text-gray-300">
              {email.messagePlain}
            </pre>
          )}
        </div>

        {/* Attachments */}
        {email.attachments && email.attachments.length > 0 && (
          <div className="p-6 border-t border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
              Attachments
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