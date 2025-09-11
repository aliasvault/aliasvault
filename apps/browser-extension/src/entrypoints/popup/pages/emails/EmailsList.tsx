import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import LoadingSpinner from '@/entrypoints/popup/components/LoadingSpinner';
import ReloadButton from '@/entrypoints/popup/components/ReloadButton';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';
import { PopoutUtility } from '@/entrypoints/popup/utils/PopoutUtility';

import type { MailboxBulkRequest, MailboxBulkResponse, MailboxEmail } from '@/utils/dist/shared/models/webapi';
import EncryptionUtility from '@/utils/EncryptionUtility';

import { useMinDurationLoading } from '@/hooks/useMinDurationLoading';

/**
 * Emails list page.
 */
const EmailsList: React.FC = () => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const webApi = useWebApi();
  const { setHeaderButtons } = useHeaderButtons();
  const [error, setError] = useState<string | null>(null);
  const [emails, setEmails] = useState<MailboxEmail[]>([]);
  const { setIsInitialLoading } = useLoading();

  /**
   * Loading state with minimum duration for more fluid UX.
   */
  const [isLoading, setIsLoading] = useMinDurationLoading(true, 100);

  /**
   * Loads emails from the web API.
   */
  const loadEmails = useCallback(async () : Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);

      if (!dbContext?.sqliteClient) {
        return;
      }

      // Get unique email addresses from all credentials.
      const emailAddresses = dbContext.sqliteClient.getAllEmailAddresses();

      try {
        // For now we only show the latest 50 emails. No pagination.
        const data = await webApi.post<MailboxBulkRequest, MailboxBulkResponse>('EmailBox/bulk', {
          addresses: emailAddresses,
          page: 1,
          pageSize: 50,
        });

        // Decrypt emails locally using private key associated with the email address.
        const encryptionKeys = dbContext.sqliteClient.getAllEncryptionKeys();

        // Decrypt emails locally using public/private key pairs.
        const decryptedEmails = await EncryptionUtility.decryptEmailList(data.mails, encryptionKeys);

        setEmails(decryptedEmails);
      } catch (error) {
        console.error(error);
        throw new Error(t('emails.errors.emailLoadError'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errors.unknownError'));
    } finally {
      setIsLoading(false);
      setIsInitialLoading(false);
    }
  }, [dbContext?.sqliteClient, webApi, setIsLoading, setIsInitialLoading, t]);

  useEffect(() => {
    loadEmails();
  }, [loadEmails]);

  // Set header buttons on mount and clear on unmount
  useEffect((): (() => void) => {
    const headerButtonsJSX = !PopoutUtility.isPopup() ? (
      <HeaderButton
        onClick={() => PopoutUtility.openInNewPopup()}
        title={t('common.openInNewWindow')}
        iconType={HeaderIconType.EXPAND}
      />
    ) : null;

    setHeaderButtons(headerButtonsJSX);

    return () => {
      setHeaderButtons(null);
    };
  }, [setHeaderButtons, t]);

  /**
   * Formats the date display for emails
   */
  const formatEmailDate = (dateSystem: string): string => {
    const now = new Date();
    const emailDate = new Date(dateSystem);
    const secondsAgo = Math.floor((now.getTime() - emailDate.getTime()) / 1000);

    if (secondsAgo < 60) {
      return t('emails.dateFormat.justNow');
    } else if (secondsAgo < 3600) {
      // Less than 1 hour ago
      const minutes = Math.floor(secondsAgo / 60);
      if (minutes === 1) {
        return t('emails.dateFormat.minutesAgo_single', { count: minutes });
      } else {
        return t('emails.dateFormat.minutesAgo_plural', { count: minutes });
      }
    } else if (secondsAgo < 86400) {
      // Less than 24 hours ago
      const hours = Math.floor(secondsAgo / 3600);
      if (hours === 1) {
        return t('emails.dateFormat.hoursAgo_single', { count: hours });
      } else {
        return t('emails.dateFormat.hoursAgo_plural', { count: hours });
      }
    } else if (secondsAgo < 172800) {
      // Less than 48 hours ago
      return t('emails.dateFormat.yesterday');
    } else {
      // Older than 48 hours
      return emailDate.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit'
      });
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
    return <div className="text-red-500">{t('common.error')}: {error}</div>;
  }

  if (emails.length === 0) {
    return (
      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-gray-900 dark:text-white text-xl">{t('emails.title')}</h2>
          <ReloadButton onClick={loadEmails} />
        </div>
        <div className="text-gray-500 dark:text-gray-400 space-y-2">
          <p className="text-sm">
            {t('emails.noEmailsDescription')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-gray-900 dark:text-white text-xl">{t('emails.title')}</h2>
        <ReloadButton onClick={loadEmails} />
      </div>
      <div className="space-y-2">
        {emails.map((email) => (
          <Link
            key={email.id}
            to={`/emails/${email.id}`}
            className="block p-4 bg-white dark:bg-gray-800 rounded-lg shadow hover:shadow-md transition-shadow border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <div className="flex justify-between items-start mb-2">
              <div className="text-sm text-gray-900 dark:text-white mb-1 font-bold">
                {email.subject}
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {formatEmailDate(email.dateSystem)}
              </div>
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
              {email.messagePreview}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default EmailsList;
