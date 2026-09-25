import { ApiRequestError } from '@aliasvault/client/api/errors/ApiRequestError';
import EncryptionUtility from '@aliasvault/client/crypto/EncryptionUtility';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AlertMessageError from '@/components/alerts/AlertMessageError';
import EmailModal from '@/components/email/EmailModal';
import SkeletonBase from '@/components/loading/SkeletonBase';
import { useDb } from '@/context/DbContext';
import { useWebApi } from '@/context/WebApiContext';
import { useEmailDomains } from '@/hooks/useEmailDomains';
import { useMinDurationLoading } from '@/hooks/useMinDurationLoading';
import { type EmailViewModel, loadAliasVaultEmail, loadSpamOkEmail, loadSpamOkMailbox } from '@/utils/EmailViewModel';

import type { MailboxBulkResponse, MailboxEmail } from '@aliasvault/models/webapi';

type RecentEmailsProps = {
  emailAddress: string;
};

const INITIAL_DISPLAY_COUNT = 2;
const EMAILS_PER_LOAD = 5;
const ACTIVE_TAB_REFRESH_INTERVAL_MS = 2000;

/**
 * "yyyy-MM-dd".
 */
const formatDate = (value: string): string => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/**
 * The structured API error code of a failed request, null for any other error.
 */
const apiErrorCode = (error: unknown): string | null => error instanceof ApiRequestError ? error.apiErrorCode : null;

/**
 * The recent emails received on an item's email address, with an in-place email modal.
 */
const RecentEmails: React.FC<RecentEmailsProps> = ({ emailAddress }) => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const webApi = useWebApi();
  const domains = useEmailDomains();
  const [isLoading, setIsLoading] = useMinDurationLoading(true, 300);
  const [mailboxEmails, setMailboxEmails] = useState<MailboxEmail[]>([]);
  const [displayedCount, setDisplayedCount] = useState(INITIAL_DISPLAY_COUNT);
  const [error, setError] = useState('');
  const [emailModalVisible, setEmailModalVisible] = useState(false);
  const [email, setEmail] = useState<EmailViewModel | null>(null);
  const isPageVisible = useRef(true);
  const autoRefreshEnabled = (dbContext.sqliteClient?.settings.getSetting('AutoEmailRefresh', 'True') ?? 'True').toLowerCase() === 'true';
  const isSpamOk = domains.isSpamOkDomain(emailAddress);
  const isAliasVault = domains.isAliasVaultDomain(emailAddress);
  const showComponent = domains.isLoaded && (isSpamOk || isAliasVault);
  const emailPrefix = emailAddress.split('@')[0];

  /**
   * Load the mailbox from SpamOK or the AliasVault API.
   */
  const loadRecentEmails = useCallback(async function loadRecentEmails(): Promise<void> {
    if (!showComponent) {
      return;
    }
    try {
      if (isSpamOk) {
        const mails = await loadSpamOkMailbox(emailPrefix);
        if (mails) {
          setMailboxEmails(mails);
        }
      } else if (isAliasVault && dbContext.sqliteClient) {
        const mailbox = await webApi.get<MailboxBulkResponse>(`EmailBox/${emailAddress}`);
        const decrypted = await EncryptionUtility.decryptEmailList(mailbox.mails, mailbox.publicKeys, dbContext.sqliteClient.encryptionKeys.getAll());
        setMailboxEmails(decrypted);
        setError('');
      }
    } catch (err) {
      if (apiErrorCode(err) === 'CLAIM_DOES_NOT_MATCH_USER') {
        setError(t('components.main.email.recentEmails.EmailAddressInUseError'));
      } else if (apiErrorCode(err) === 'CLAIM_DOES_NOT_EXIST') {
        /*
         * The server learns about a new address when the vault push that follows a save lands. A load that races
         * that push is retried once instead of shown as an error.
         */
        if (dbContext.isUploading || dbContext.isSyncing) {
          setTimeout(() => void loadRecentEmails(), ACTIVE_TAB_REFRESH_INTERVAL_MS);
          return;
        }
        setError(t('components.main.email.recentEmails.EmailLoadError'));
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, [dbContext.isSyncing, dbContext.isUploading, dbContext.sqliteClient, emailAddress, emailPrefix, isAliasVault, isSpamOk, showComponent, t, webApi]);

  /**
   * Reload from scratch, with the loading skeleton.
   */
  const manualRefresh = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setEmailModalVisible(false);
    setEmail(null);
    setDisplayedCount(INITIAL_DISPLAY_COUNT);
    await loadRecentEmails();
    setIsLoading(false);
  }, [loadRecentEmails, setIsLoading]);

  useEffect(() => {
    if (!showComponent) {
      return;
    }
    void manualRefresh();
  }, [manualRefresh, showComponent]);

  // Poll while the tab is visible and auto refresh is on; refresh once when the tab comes back.
  useEffect(() => {
    if (!showComponent) {
      return;
    }
    let timer: ReturnType<typeof setInterval> | null = null;

    /**
     * Start polling.
     */
    const startPolling = (): void => {
      if (timer === null && autoRefreshEnabled) {
        timer = setInterval(() => void loadRecentEmails(), ACTIVE_TAB_REFRESH_INTERVAL_MS);
      }
    };

    /**
     * Stop polling.
     */
    const stopPolling = (): void => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    /**
     * Follow the tab visibility.
     */
    const onVisibilityChange = (): void => {
      isPageVisible.current = document.visibilityState === 'visible';
      if (isPageVisible.current) {
        startPolling();
        void loadRecentEmails();
      } else {
        stopPolling();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    if (document.visibilityState === 'visible') {
      startPolling();
    }
    return (): void => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stopPolling();
    };
  }, [autoRefreshEnabled, loadRecentEmails, showComponent]);

  /**
   * Open an email in the modal. The shell renders first with skeletons so it paints before the email is fetched.
   */
  const openEmail = async (emailId: number): Promise<void> => {
    setEmail(null);
    setEmailModalVisible(true);
    try {
      if (isSpamOk) {
        const loaded = await loadSpamOkEmail(emailPrefix, emailId);
        if (loaded) {
          setEmail(loaded);
          return;
        }
        setEmailModalVisible(false);
      } else if (dbContext.sqliteClient) {
        setEmail(await loadAliasVaultEmail(webApi, dbContext.sqliteClient, emailId));
      }
    } catch (err) {
      setEmailModalVisible(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!showComponent) {
    return null;
  }

  const displayedEmails = mailboxEmails.slice(0, displayedCount);
  const canLoadMore = displayedCount < mailboxEmails.length;
  const headerRow = (
    <tr>
      <th scope="col" className="p-4 text-xs font-medium tracking-wider text-left text-gray-500 uppercase dark:text-white">{t('components.main.email.recentEmails.SubjectColumn')}</th>
      <th scope="col" className="p-4 text-xs font-medium tracking-wider text-left text-gray-500 uppercase dark:text-white">{t('components.main.email.recentEmails.DateColumn')}</th>
    </tr>
  );

  return (
    <>
      {emailModalVisible && <EmailModal email={email} onClose={() => setEmailModalVisible(false)} onEmailDeleted={() => void manualRefresh()} />}

      <div className="p-4 mb-4 bg-white border border-gray-200 rounded-lg shadow-sm 2xl:col-span-2 dark:border-gray-700 sm:p-6 dark:bg-gray-800">
        <div className="flex justify-between">
          <div>
            <h3 className="mb-4 text-xl font-semibold dark:text-white">{t('components.main.email.recentEmails.EmailSectionTitle')}</h3>
          </div>
          <div className="flex justify-end items-center space-x-2">
            {autoRefreshEnabled && (
              <div className="w-3 h-3 mr-2 rounded-full bg-primary-300 border-2 border-primary-100 animate-pulse" title={t('components.main.email.recentEmails.AutoRefreshEnabledTooltip')}></div>
            )}
            <button id="recent-email-refresh" onClick={() => void manualRefresh()} type="button" className="text-gray-500 border border-gray-300 hover:bg-gray-100 hover:text-gray-700 focus:ring-4 focus:outline-none focus:ring-gray-200 font-medium rounded-full text-sm p-2 text-center inline-flex items-center dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200 dark:focus:ring-gray-700">
              <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-col mt-6">
            <div className="overflow-x-auto rounded-lg">
              <div className="inline-block min-w-full align-middle">
                <div className="overflow-hidden shadow sm:rounded-lg">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-600">
                    <thead className="bg-gray-50 dark:bg-gray-700">{headerRow}</thead>
                    <tbody className="bg-white dark:bg-gray-800">
                      {[0, 1].map((i) => (
                        <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-600">
                          <td className="p-4">
                            <SkeletonBase height={20} additionalClasses="w-48"><div className="w-full h-full bg-gray-300 dark:bg-gray-700 rounded"></div></SkeletonBase>
                          </td>
                          <td className="p-4">
                            <SkeletonBase height={20} additionalClasses="w-24"><div className="w-full h-full bg-gray-300 dark:bg-gray-700 rounded"></div></SkeletonBase>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        ) : error.length > 0 ? (
          <AlertMessageError message={error} />
        ) : mailboxEmails.length === 0 ? (
          <div className="text-gray-500 dark:text-gray-400">{t('components.main.email.recentEmails.NoEmailsReceivedMessage')}</div>
        ) : (
          <div className="flex flex-col mt-6">
            <div className="overflow-x-auto rounded-lg">
              <div className="inline-block min-w-full align-middle">
                <div className="overflow-hidden shadow sm:rounded-lg">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-600">
                    <thead className="bg-gray-50 dark:bg-gray-700">{headerRow}</thead>
                    <tbody className="bg-white dark:bg-gray-800">
                      {displayedEmails.map((mail) => (
                        <tr key={mail.id} className="hover:bg-gray-50 dark:hover:bg-gray-600 cursor-pointer" onClick={() => void openEmail(mail.id)}>
                          <td className="p-4 text-sm font-normal text-gray-900 whitespace-nowrap dark:text-white">
                            <span>{mail.subject.length > 30 ? `${mail.subject.substring(0, 30)}...` : mail.subject}</span>
                          </td>
                          <td className="p-4 text-sm font-normal text-gray-500 whitespace-nowrap dark:text-gray-400">
                            <span>{formatDate(mail.dateSystem)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {canLoadMore && (
              <button onClick={() => setDisplayedCount(c => c + EMAILS_PER_LOAD)} type="button" className="w-full mt-3 py-1 px-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md transition-colors duration-200 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 flex items-center justify-center gap-1">
                <span>{t('components.main.email.recentEmails.LoadMoreButton')}</span>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
};

export default RecentEmails;
