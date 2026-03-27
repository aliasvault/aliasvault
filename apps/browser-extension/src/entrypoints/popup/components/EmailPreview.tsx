import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { AppInfo } from '@/utils/AppInfo';

import { storage } from '#imports';

/** Minimal shape for SpamOK API response emails — avoids importing server-only SpamOkEmail. */
interface SpamOkEmail {
  id: number;
  subject: string;
  dateSystem: string;
}

type EmailPreviewProps = {
  email: string;
}

/**
 * This component shows a preview of the latest emails in the inbox.
 * Public domains (SpamOK) show inline previews via the SpamOK API.
 * Private domains link to the blockchain inbox page.
 */
export const EmailPreview: React.FC<EmailPreviewProps> = ({ email }) => {
  const { t } = useTranslation();
  const [emails, setEmails] = useState<SpamOkEmail[]>([]);
  const [displayedEmails, setDisplayedEmails] = useState<SpamOkEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastEmailId, setLastEmailId] = useState<number>(0);
  const [isSpamOk, setIsSpamOk] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSupportedDomain, setIsSupportedDomain] = useState(false);
  const [displayedCount, setDisplayedCount] = useState(2);

  const emailsPerLoad = 3;
  const canLoadMore = displayedCount < emails.length;

  /**
   * Updates the displayed emails based on the current count.
   */
  const updateDisplayedEmails = (allEmails: SpamOkEmail[], count: number) : void => {
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
    const loadEmails = async (): Promise<void> => {
      try {
        setError(null);
        const isPublic = await isPublicDomain(email);
        const isPrivateDom = await isPrivateDomain(email);
        const isSupported = isPublic || isPrivateDom;

        setIsSpamOk(isPublic);
        setIsPrivate(isPrivateDom);
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
            ?.toSorted((a: SpamOkEmail, b: SpamOkEmail) =>
              new Date(b.dateSystem).getTime() - new Date(a.dateSystem).getTime()) ?? [];

          if (loading && allMails.length > 0) {
            setLastEmailId(allMails[0].id);
          }

          // Only update emails if they actually changed to preserve displayedCount
          setEmails(prevEmails => {
            const emailsChanged = JSON.stringify(prevEmails.map((e: SpamOkEmail) => e.id)) !== JSON.stringify(allMails.map((e: SpamOkEmail) => e.id));
            if (emailsChanged) {
              updateDisplayedEmails(allMails, displayedCount);
              return allMails;
            }
            return prevEmails;
          });
        }
        // Private domains: no server fetch needed — inbox page handles blockchain emails
      } catch (err) {
        console.error('Error loading emails:', err);
        setError(t('emails.errors.emailUnexpectedError'));
      }
      setLoading(false);
    };

    loadEmails();
    // Set up auto-refresh interval (only useful for SpamOK public domains)
    const interval = setInterval(loadEmails, 2000);
    return () : void => clearInterval(interval);
  }, [email, loading, t, displayedCount]);

  // Don't render anything if the domain is not supported
  if (!isSupportedDomain) {
    return null;
  }

  // Private domains: show link to blockchain inbox instead of server-fetched preview
  if (isPrivate && !isSpamOk) {
    return (
      <div className="text-gray-500 dark:text-gray-400 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{t('common.recentEmails')}</h2>
        </div>
        <Link
          to="/inbox"
          className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
        >
          {t('emails.checkInbox', 'Check your inbox for recent emails')}
        </Link>
      </div>
    );
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
