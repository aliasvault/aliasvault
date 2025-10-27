import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';

import { AppInfo } from '@/utils/AppInfo';
import type { ApiErrorResponse, MailboxEmail } from '@/utils/dist/shared/models/webapi';
import { EncryptionUtility } from '@/utils/EncryptionUtility';

import { storage } from '#imports';

type EmailPreviewProps = {
  email: string;
}

/**
 * This component shows a preview of the latest emails in the inbox.
 */
export const EmailPreview: React.FC<EmailPreviewProps> = ({ email }) => {
  const { t } = useTranslation();
  const [emails, setEmails] = useState<MailboxEmail[]>([]);
  const [displayedEmails, setDisplayedEmails] = useState<MailboxEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastEmailId, setLastEmailId] = useState<number>(0);
  const [isSpamOk, setIsSpamOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSupportedDomain, setIsSupportedDomain] = useState(false);
  const [displayedCount, setDisplayedCount] = useState(2);
  const webApi = useWebApi();
  const dbContext = useDb();

  const emailsPerLoad = 3;
  const canLoadMore = displayedCount < emails.length;

  /**
   * Updates the displayed emails based on the current count.
   */
  const updateDisplayedEmails = (allEmails: MailboxEmail[], count: number) : void => {
    const displayed = allEmails.slice(0, count);
    setDisplayedEmails(displayed);
  };

  /**
   * Loads more emails.
   */
  const loadMoreEmails = (): void => {
    const newCount = Math.min(displayedCount + emailsPerLoad, emails.length);
    setDisplayedCount(newCount);
    updateDisplayedEmails(emails, newCount);
  };

  /**
   * Checks if the email is a public domain.
   */
  const isPublicDomain = async (emailAddress: string): Promise<boolean> => {
    // Get metadata from storage
    const publicEmailDomains = await storage.getItem('session:publicEmailDomains') as string[] ?? [];
    return publicEmailDomains.some(domain => emailAddress.toLowerCase().endsWith(`@${domain.toLowerCase()}`));
  };

  /**
   * Checks if the email is a private domain.
   */
  const isPrivateDomain = async (emailAddress: string): Promise<boolean> => {
    // Get metadata from storage
    const privateEmailDomains = await storage.getItem('session:privateEmailDomains') as string[] ?? [];
    return privateEmailDomains.some(domain => emailAddress.toLowerCase().endsWith(`@${domain.toLowerCase()}`));
  };

  useEffect(() => {
    /**
     * Loads the latest emails from the server and decrypts them locally if needed.
     */
    const loadEmails = async (): Promise<void> => {
      try {
        setError(null);
        const isPublic = await isPublicDomain(email);
        const isPrivate = await isPrivateDomain(email);
        const isSupported = isPublic || isPrivate;

        setIsSpamOk(isPublic);
        setIsSupportedDomain(isSupported);

        if (!isSupported) {
          return;
        }

        if (isPublic) {
          // For public domains (SpamOK), use the SpamOK API directly
          const emailPrefix = email.split('@')[0];
          const response = await fetch(`https://api.spamok.com/v2/EmailBox/${emailPrefix}`, {
            headers: {
              'X-Asdasd-Platform-Id': 'av-chrome',
              'X-Asdasd-Platform-Version': AppInfo.VERSION,
            }
          });

          if (!response.ok) {
            setError(t('emails.errors.emailLoadError'));
            return;
          }

          const data = await response.json();

          // Store all emails, sorted by date
          const allMails = data?.mails
            ?.toSorted((a: MailboxEmail, b: MailboxEmail) =>
              new Date(b.dateSystem).getTime() - new Date(a.dateSystem).getTime()) ?? [];

          if (loading && allMails.length > 0) {
            setLastEmailId(allMails[0].id);
          }

          // Only update emails if they actually changed to preserve displayedCount
          setEmails(prevEmails => {
            const emailsChanged = JSON.stringify(prevEmails.map(e => e.id)) !== JSON.stringify(allMails.map(e => e.id));
            if (emailsChanged) {
              updateDisplayedEmails(allMails, displayedCount);
              return allMails;
            }
            return prevEmails;
          });
        } else if (isPrivate) {
          // For private domains, use existing encrypted email logic
          try {
            /**
             * We use authFetch here because we don't want to the inner method to throw an error if HTTP status is not 200.
             * Instead we want to catch the error ourselves.
             */
            const response = await webApi.authFetch(`EmailBox/${email}`, { method: 'GET' }, true, false);
            try {
              const data = response as { mails: MailboxEmail[] };

              // Store all emails, sorted by date
              const allMails = data.mails
                .toSorted((a, b) => new Date(b.dateSystem).getTime() - new Date(a.dateSystem).getTime());

              if (allMails) {
                // Loop through all emails and decrypt them locally
                const decryptedEmails: MailboxEmail[] = await EncryptionUtility.decryptEmailList(
                  allMails,
                  dbContext.sqliteClient!.getAllEncryptionKeys()
                );

                if (loading && decryptedEmails.length > 0) {
                  setLastEmailId(decryptedEmails[0].id);
                }

                // Only update emails if they actually changed to preserve displayedCount
                setEmails(prevEmails => {
                  const emailsChanged = JSON.stringify(prevEmails.map(e => e.id)) !== JSON.stringify(decryptedEmails.map(e => e.id));
                  if (emailsChanged) {
                    updateDisplayedEmails(decryptedEmails, displayedCount);
                    return decryptedEmails;
                  }
                  return prevEmails;
                });
              }
            } catch {
              // Try to parse as error response instead
              const apiErrorResponse = response as ApiErrorResponse;
              setError(t('emails.apiErrors.' + apiErrorResponse?.code));
              return;
            }
          } catch {
            setError(t('emails.errors.emailLoadError'));
            return;
          }
        }
      } catch (err) {
        console.error('Error loading emails:', err);
        setError(t('emails.errors.emailUnexpectedError'));
      }
      setLoading(false);
    };

    loadEmails();
    // Set up auto-refresh interval
    const interval = setInterval(loadEmails, 2000);
    return () : void => clearInterval(interval);
  }, [email, loading, webApi, dbContext, t, displayedCount]);

  // Don't render anything if the domain is not supported
  if (!isSupportedDomain) {
    return null;
  }

  if (error) {
    return (
      <div className="text-gray-500 dark:text-gray-400 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{t('common.recentEmails')}</h2>
        </div>
        <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-gray-500 dark:text-gray-400 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{t('common.recentEmails')}</h2>
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        </div>
        {t('common.loadingEmails')}
      </div>
    );
  }
  if (emails.length === 0) {
    return (
      <div className="text-gray-500 dark:text-gray-400 mb-4 text-sm">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{t('common.recentEmails')}</h2>
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        </div>
        {t('emails.noEmails')}
      </div>
    );
  }

  return (
    <div className="space-y-2 mb-4">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{t('common.recentEmails')}</h2>
        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
      </div>

      {displayedEmails.map((mail) => (
        isSpamOk ? (
          <a
            key={mail.id}
            href={`https://spamok.com/${email.split('@')[0]}/${mail.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex justify-between items-center p-2 ps-3 pe-3 rounded cursor-pointer bg-white dark:bg-gray-800 shadow hover:shadow-md transition-all border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 ${
              mail.id > lastEmailId ? 'bg-yellow-50 dark:bg-yellow-900/30' : ''
            }`}
          >
            <div className="truncate flex-1">
              <span className="text-sm text-gray-900 dark:text-white">
                {mail.subject.substring(0, 30)}{mail.subject.length > 30 ? '...' : ''}
              </span>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 ml-2">
              {new Date(mail.dateSystem).toLocaleDateString()}
            </div>
          </a>
        ) : (
          <Link
            key={mail.id}
            to={`/emails/${mail.id}`}
            className={`flex justify-between items-center p-2 ps-3 pe-3 rounded cursor-pointer bg-white dark:bg-gray-800 shadow hover:shadow-md transition-all border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 ${
              mail.id > lastEmailId ? 'bg-yellow-50 dark:bg-yellow-900/30' : ''
            }`}
          >
            <span className="truncate flex-1">
              <span className="text-sm text-gray-900 dark:text-white">
                {mail.subject.substring(0, 30)}{mail.subject.length > 30 ? '...' : ''}
              </span>
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
              {new Date(mail.dateSystem).toLocaleDateString()}
            </span>
          </Link>
        )
      ))}

      {canLoadMore && (
        <button
          onClick={loadMoreEmails}
          className="w-full mt-2 py-1 px-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md transition-colors duration-200 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 flex items-center justify-center gap-1"
        >
          <span>{t('common.loadMore')}</span>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}
    </div>
  );
};