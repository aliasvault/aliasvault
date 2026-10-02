import EncryptionUtility from '@aliasvault/client/crypto/EncryptionUtility';
import { getPlatform } from '@aliasvault/client/platform';
import { hasUnsyncedUserChanges } from '@aliasvault/client/sync/VaultDirtyState';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import EmailModal from '@/components/email/EmailModal';
import EmailPreview from '@/components/email/EmailPreview';
import EmailPreviewSkeleton from '@/components/email/EmailPreviewSkeleton';
import EmailRow, { type MailListEntry } from '@/components/email/EmailRow';
import EmailRowSkeleton from '@/components/email/EmailRowSkeleton';
import DeleteAllSelectedButton from '@/components/shared/DeleteAllSelectedButton';
import Icon from '@/components/shared/Icon';
import PageContent from '@/components/shared/PageContent';
import PageHeader from '@/components/shared/PageHeader';
import RefreshButton from '@/components/shared/RefreshButton';
import ResponsivePaginator from '@/components/shared/ResponsivePaginator';
import Text from '@/components/shared/Text';
import { getAppConfig } from '@/config/AppConfig';
import { useConfirmModal } from '@/context/ConfirmModalContext';
import { useDb } from '@/context/DbContext';
import { useNotifications } from '@/context/NotificationContext';
import { useWebApi } from '@/context/WebApiContext';
import { useMinDurationLoading } from '@/hooks/useMinDurationLoading';
import { usePageTitle } from '@/hooks/usePageTitle';
import { type EmailViewModel, loadAliasVaultEmail } from '@/utils/EmailViewModel';
import { itemRoute } from '@/utils/ItemRoute';
import { StorageKeys } from '@/utils/StorageKeys';

import type { ItemRef } from '@aliasvault/client/database/ItemRef';
import type { ApiErrorResponse, MailboxBulkRequest, MailboxBulkResponse, MailboxEmail } from '@aliasvault/models/webapi';

/** Emails per page. */
const PAGE_SIZE = 50;

/** Poll interval for new emails while the tab is visible and auto refresh is on. */
const ACTIVE_TAB_REFRESH_INTERVAL_MS = 2000;

/** How long the "new" indicator stays on a freshly arrived email. */
const NEW_EMAIL_INDICATOR_MS = 30000;

/**
 * A page of the mailbox.
 */
type MailboxPage = {
  emails: MailListEntry[];
  totalRecords: number;
  currentPage: number;
  pageSize: number;
};

/**
 * Response of a bulk delete.
 */
type EmailBulkResponse = {
  successfulEmailIds: number[];
};

/**
 * The mailbox: every email received by the vault's private email addresses.
 */
const EmailsHome: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dbContext = useDb();
  const webApi = useWebApi();
  const notifications = useNotifications();
  const { showConfirmation } = useConfirmModal();
  usePageTitle(t('emails.title'));

  const [isLoading, setIsLoading] = useMinDurationLoading(true, 300);
  const [emailList, setEmailList] = useState<MailListEntry[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [noEmailClaims, setNoEmailClaims] = useState(false);
  const [selectedEmailId, setSelectedEmailId] = useState<number | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<EmailViewModel | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [emailModalVisible, setEmailModalVisible] = useState(false);
  const [emailModalEmail, setEmailModalEmail] = useState<EmailViewModel | null>(null);
  const previewLoadSequence = useRef(0);
  const [checkedEmailIds, setCheckedEmailIds] = useState<Set<number>>(new Set());
  const [newEmailIds, setNewEmailIds] = useState<Set<number>>(new Set());
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const knownEmailIds = useRef<Set<number>>(new Set());
  const isPageVisible = useRef(true);
  const autoRefreshEnabled = useMemo(() => (dbContext.sqliteClient?.settings.getSetting('AutoEmailRefresh', 'True') ?? 'True').toLowerCase() === 'true', [dbContext.sqliteClient]);

  const hasMoreEmails = totalRecords > emailList.length;

  /**
   * Get the list of private email alias addresses in the vault.
   */
  const getEmailClaimList = useCallback(async (): Promise<string[]> => {
    const routable = dbContext.sqliteClient?.items.getRoutableEmailAddresses() ?? [];
    const storedDomains = await getPlatform().storage.get<string[]>(StorageKeys.PRIVATE_EMAIL_DOMAINS);
    const privateDomains = (storedDomains && storedDomains.length > 0 ? storedDomains : getAppConfig().privateEmailDomains).filter(d => d.trim().length > 0);
    if (privateDomains.length === 0) {
      return [];
    }
    return routable.filter(address => privateDomains.some(domain => address.toLowerCase().endsWith(`@${domain.toLowerCase()}`)));
  }, [dbContext.sqliteClient]);

  /**
   * Item and name per email address, for the item link of each email.
   */
  const getItemLookup = useCallback((): Map<string, { ref: ItemRef; name: string }> => {
    const lookup = new Map<string, { ref: ItemRef; name: string }>();
    for (const item of dbContext.sqliteClient?.items.getAll() ?? []) {
      const emailField = item.Fields?.find(f => f.FieldKey === 'login.email');
      const email = emailField ? (Array.isArray(emailField.Value) ? emailField.Value[0] : emailField.Value) : null;
      if (email && !lookup.has(email.toLowerCase())) {
        lookup.set(email.toLowerCase(), { ref: { Id: item.Id, ManifestId: item.ManifestId }, name: item.Name ?? 'Unknown' });
      }
    }
    return lookup;
  }, [dbContext.sqliteClient]);

  /**
   * Fetch and decrypt one page of the mailbox.
   */
  const loadEmailsFromServer = useCallback(async (page: number, pageSize: number, emailClaimList: string[]): Promise<MailboxPage | null> => {
    if (emailClaimList.length === 0 || !dbContext.sqliteClient) {
      return null;
    }

    try {
      const data = await webApi.post<MailboxBulkRequest, MailboxBulkResponse>('EmailBox/bulk', { addresses: emailClaimList, page, pageSize });
      const encryptionKeys = dbContext.sqliteClient.encryptionKeys.getAll();
      const decrypted: MailboxEmail[] = await EncryptionUtility.decryptEmailList(data.mails, data.publicKeys, encryptionKeys);
      const lookup = getItemLookup();

      const emails = decrypted.map((email): MailListEntry => {
        const toEmail = `${email.toLocal}@${email.toDomain}`;
        const item = lookup.get(toEmail.toLowerCase());
        return {
          id: email.id,
          date: new Date(email.dateSystem),
          fromName: email.fromDisplay,
          fromEmail: `${email.fromLocal}@${email.fromDomain}`,
          toEmail,
          subject: email.subject,
          messagePreview: email.messagePreview,
          item: item ?? null,
          hasAttachments: email.hasAttachments,
        };
      });

      return { emails, totalRecords: data.totalRecords, currentPage: data.currentPage, pageSize: data.pageSize };
    } catch (error) {
      // Claim does not exist errors from the email API are expected while local changes are still being synced.
      if (!dbContext.isSyncing && !await hasUnsyncedUserChanges()) {
        const apiError = error as { apiError?: ApiErrorResponse };
        if (apiError.apiError?.code === 'CLAIM_DOES_NOT_EXIST') {
          notifications.addErrorMessage(t('emails.home.claimDoesNotExistError'), true);
        } else {
          notifications.addErrorMessage(error instanceof Error ? error.message : t('common.errors.unknownError'), true);
        }
      }
      console.error('An error occurred while loading emails from server', error);
      return null;
    }
  }, [dbContext, webApi, getItemLookup, notifications, t]);

  /**
   * Load the mailbox from scratch.
   */
  const refreshData = useCallback(async (preserveCurrentPage: boolean = false, page: number = 1): Promise<void> => {
    setIsLoading(true);
    setNoEmailClaims(false);
    setSelectedEmailId(null);
    setCheckedEmailIds(new Set());
    setEmailList([]);
    setNewEmailIds(new Set());
    knownEmailIds.current = new Set();

    const targetPage = preserveCurrentPage ? page : 1;
    const emailClaimList = await getEmailClaimList();
    if (emailClaimList.length === 0) {
      setNoEmailClaims(true);
      setIsLoading(false);
      return;
    }

    const result = await loadEmailsFromServer(targetPage, PAGE_SIZE, emailClaimList);
    if (result) {
      setEmailList(result.emails);
      knownEmailIds.current = new Set(result.emails.map(e => e.id));
      setCurrentPage(result.currentPage);
      setTotalRecords(result.totalRecords);
      if (result.emails.length > 0) {
        setSelectedEmailId(result.emails[0].id);
      }
    }
    setIsLoading(false);
  }, [getEmailClaimList, loadEmailsFromServer, setIsLoading]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  /**
   * Check for new emails without disrupting the current view.
   */
  const checkForNewEmails = useCallback(async (): Promise<void> => {
    if (!isPageVisible.current || !autoRefreshEnabled || currentPage !== 1) {
      return;
    }
    const emailClaimList = await getEmailClaimList();
    const result = await loadEmailsFromServer(1, 5, emailClaimList);
    if (!result) {
      return;
    }
    const arrived = result.emails.filter(email => !knownEmailIds.current.has(email.id));
    result.emails.forEach(email => knownEmailIds.current.add(email.id));
    if (arrived.length === 0) {
      return;
    }
    setEmailList(list => [...arrived, ...list]);
    setTotalRecords(total => total + arrived.length);
    const arrivedIds = arrived.map(e => e.id);
    setNewEmailIds(ids => new Set([...ids, ...arrivedIds]));
    setTimeout(() => {
      setNewEmailIds(ids => new Set([...ids].filter(id => !arrivedIds.includes(id))));
    }, NEW_EMAIL_INDICATOR_MS);
  }, [autoRefreshEnabled, currentPage, getEmailClaimList, loadEmailsFromServer]);

  /**
   * Poll while the tab is visible.
   */
  useEffect(() => {
    if (!autoRefreshEnabled) {
      return;
    }
    const interval = setInterval(() => void checkForNewEmails(), ACTIVE_TAB_REFRESH_INTERVAL_MS);
    /**
     * Track tab visibility and refresh right away when it comes back.
     */
    const onVisibilityChange = (): void => {
      isPageVisible.current = document.visibilityState === 'visible';
      if (isPageVisible.current) {
        void checkForNewEmails();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return (): void => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [autoRefreshEnabled, checkForNewEmails]);

  /**
   * Load the next page (desktop layout).
   */
  const loadMoreEmails = async (): Promise<void> => {
    if (isLoadingMore || !hasMoreEmails) {
      return;
    }
    setIsLoadingMore(true);
    try {
      const emailClaimList = await getEmailClaimList();
      const result = await loadEmailsFromServer(currentPage + 1, PAGE_SIZE, emailClaimList);
      if (result) {
        setEmailList(list => [...list, ...result.emails]);
        setCurrentPage(result.currentPage);
        setTotalRecords(result.totalRecords);
      }
    } finally {
      setIsLoadingMore(false);
    }
  };

  /**
   * Toggle an email's checkbox.
   */
  const checkEmail = useCallback((emailId: number): void => {
    setCheckedEmailIds(ids => {
      const next = new Set(ids);
      if (next.has(emailId)) {
        next.delete(emailId);
      } else {
        next.add(emailId);
      }
      return next;
    });
  }, []);

  // Load and decrypt the selected email for the preview panel; a newer selection cancels an older load.
  useEffect(() => {
    const sequence = ++previewLoadSequence.current;
    setSelectedEmail(null);
    if (selectedEmailId === null || !dbContext.sqliteClient) {
      setIsPreviewLoading(false);
      return;
    }
    setIsPreviewLoading(true);
    loadAliasVaultEmail(webApi, dbContext.sqliteClient, selectedEmailId).then((email) => {
      if (sequence === previewLoadSequence.current) {
        setSelectedEmail(email);
        setIsPreviewLoading(false);
      }
    }).catch((error) => {
      console.error('Failed to load email:', error);
      if (sequence === previewLoadSequence.current) {
        setIsPreviewLoading(false);
      }
    });
  }, [dbContext.sqliteClient, selectedEmailId, webApi]);

  /**
   * Open an email in the modal (mobile screen layout).
   */
  const openEmailModal = useCallback(async (emailId: number): Promise<void> => {
    setNewEmailIds(ids => {
      const next = new Set(ids);
      next.delete(emailId);
      return next;
    });
    if (!dbContext.sqliteClient) {
      return;
    }
    setEmailModalEmail(null);
    setEmailModalVisible(true);
    try {
      setEmailModalEmail(await loadAliasVaultEmail(webApi, dbContext.sqliteClient, emailId));
    } catch (error) {
      console.error('Failed to load email:', error);
      setEmailModalVisible(false);
    }
  }, [dbContext.sqliteClient, webApi]);

  /**
   * Select an email for the preview panel.
   */
  const selectEmail = useCallback((emailId: number): void => {
    setNewEmailIds(ids => {
      const next = new Set(ids);
      next.delete(emailId);
      return next;
    });
    setSelectedEmailId(emailId);
  }, []);

  /**
   * Remove deleted emails from the list and move the selection along.
   */
  const handleEmailsDeleted = (emailIds: number[]): void => {
    const deletedSelectedIndex = selectedEmailId !== null && emailIds.includes(selectedEmailId) ? emailList.findIndex(e => e.id === selectedEmailId) : -1;
    const remaining = emailList.filter(e => !emailIds.includes(e.id));
    setEmailList(remaining);
    setCheckedEmailIds(new Set());
    emailIds.forEach(id => knownEmailIds.current.delete(id));
    setTotalRecords(total => Math.max(0, total - emailIds.length));
    if (deletedSelectedIndex >= 0) {
      setSelectedEmailId(remaining.length > 0 ? remaining[Math.min(deletedSelectedIndex, remaining.length - 1)].id : null);
    }
  };

  /**
   * Delete every checked email after confirmation.
   */
  const showBulkDeleteConfirmation = async (): Promise<void> => {
    if (checkedEmailIds.size === 0) {
      return;
    }
    const confirmed = await showConfirmation(
      t('emails.home.bulkDeleteEmailTitle'),
      t('emails.home.bulkDeleteEmailConfirmation', { count: checkedEmailIds.size }),
      t('common.confirm'),
      t('common.cancel'),
    );
    if (!confirmed) {
      return;
    }

    try {
      const response = await webApi.authFetch<EmailBulkResponse>('Email/bulk', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...checkedEmailIds] }),
      });
      const deletedIds = response?.successfulEmailIds ?? [];
      notifications.addSuccessMessage(t('emails.home.bulkDeleteEmailSuccess', { count: deletedIds.length }), true);
      handleEmailsDeleted(deletedIds);
    } catch (error) {
      notifications.addErrorMessage(error instanceof Error ? error.message : t('common.errors.unknownError'), true);
      console.error('An error occurred while bulk deleting emails at server', error);
    }
  };

  /**
   * The preview panel.
   */
  const renderPreview = (): React.ReactNode => {
    if (isPreviewLoading) {
      return <EmailPreviewSkeleton />;
    }
    const entry = emailList.find(e => e.id === selectedEmailId);
    return (
      <EmailPreview
        email={selectedEmail}
        onEmailDeleted={emailId => handleEmailsDeleted([emailId])}
        item={entry?.item ?? null}
        onItemClick={ref => navigate(itemRoute(ref))} />
    );
  };

  /**
   * The list of rows for one of the layouts.
   */
  const renderRows = (onClick: (id: number) => void, withSelection: boolean): React.ReactNode => emailList.map(email => (
    <EmailRow
      key={email.id}
      email={email}
      onEmailCheck={checkEmail}
      onEmailClick={onClick}
      isChecked={checkedEmailIds.has(email.id)}
      isSelected={withSelection && selectedEmailId === email.id}
      isNewEmail={newEmailIds.has(email.id)} />
  ));

  return (
    <>
      {emailModalVisible && (
        <EmailModal email={emailModalEmail} onClose={() => setEmailModalVisible(false)} onEmailDeleted={() => void refreshData()} showItemLink />
      )}

      <PageHeader
        title={t('emails.title')}
        description={t('emails.home.pageDescription')}
        customActions={(
          <>
            {autoRefreshEnabled && currentPage === 1 && (
              <div className="w-3 h-3 mr-2 rounded-full bg-primary-300 border-2 border-primary-100 animate-pulse" title={t('emails.home.autoRefreshEnabledTooltip')}></div>
            )}
            <RefreshButton onClick={() => refreshData()} buttonText={t('common.refresh')} />
            {checkedEmailIds.size > 0 && (
              <DeleteAllSelectedButton onClick={showBulkDeleteConfirmation} buttonText={t('emails.home.deleteSelectedEmails', { count: checkedEmailIds.size })} />
            )}
          </>
        )} />

      <PageContent>
        {isLoading ? (
          <div className="px-4">
            <div className="block lg:hidden mt-6">
              <div className="bg-white border rounded-lg dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
                <ul className="divide-y divide-gray-200 dark:divide-gray-600">
                  {Array.from({ length: 5 }, (_, i) => <EmailRowSkeleton key={i} />)}
                </ul>
              </div>
            </div>
            <div className="hidden lg:flex mt-6 h-[calc(100vh-300px)] min-h-[600px]">
              <div className="w-1/4 bg-white border rounded-l-lg dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
                <div className="h-full overflow-y-auto">
                  <ul className="divide-y divide-gray-200 dark:divide-gray-600">
                    {Array.from({ length: 5 }, (_, i) => <EmailRowSkeleton key={i} />)}
                  </ul>
                </div>
              </div>
              <div className="w-3/4">
                <EmailPreviewSkeleton />
              </div>
            </div>
          </div>
        ) : noEmailClaims ? (
          <div className="p-4 mx-4 mt-4 bg-white border border-gray-200 rounded-lg shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="px-4 py-2 text-gray-400 rounded">
              <Text variant="muted">{t('emails.home.noEmailClaimsMessage')}</Text>
            </div>
          </div>
        ) : (
          <div className="px-4">
            <div className="block lg:hidden mt-6">
              <ResponsivePaginator currentPage={currentPage} pageSize={PAGE_SIZE} totalRecords={totalRecords} onPageChanged={(page) => void refreshData(true, page)} />

              <div className="bg-white border rounded-lg dark:bg-gray-800 dark:border-gray-700 overflow-hidden mt-4">
                <ul className="divide-y divide-gray-200 dark:divide-gray-600">
                  {emailList.length === 0 ? (
                    <li className="p-4 text-center text-gray-500 dark:text-gray-300">
                      {t('emails.home.noEmailsReceivedMessage')}
                    </li>
                  ) : renderRows(emailId => void openEmailModal(emailId), false)}
                </ul>
              </div>
            </div>

            <div className="hidden lg:flex mt-6 rounded-lg overflow-hidden">
              {emailList.length === 0 ? (
                <div className="w-full bg-white border rounded-lg dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
                  <div className="p-4 text-center text-gray-500 dark:text-gray-300">
                    {t('emails.home.noEmailsReceivedMessage')}
                  </div>
                </div>
              ) : (
                <div className="w-full h-[calc(100vh-300px)] min-h-[600px] flex rounded-lg overflow-hidden">
                  <div className="w-1/4 bg-white border border-r-0 dark:bg-gray-800 dark:border-gray-700 flex flex-col">
                    <div className="flex-1 overflow-y-auto" id="email-list-container">
                      <ul>
                        {renderRows(selectEmail, true)}
                        {hasMoreEmails && (
                          <li className="border-t border-gray-200 dark:border-gray-600 p-3 bg-gray-50 dark:bg-gray-700">
                            <button
                              onClick={loadMoreEmails}
                              disabled={isLoadingMore}
                              className="w-full px-4 py-2 text-sm font-medium text-primary-600 bg-primary-50 border border-primary-200 rounded-md hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed dark:text-primary-400 dark:bg-primary-900/20 dark:border-primary-800 dark:hover:bg-primary-900/30">
                              {isLoadingMore ? (
                                <span className="flex items-center justify-center">
                                  <Icon name="spinner" className="animate-spin -ml-1 mr-2 h-4 w-4" />
                                  {t('common.loading')}
                                </span>
                              ) : (
                                <span>{t('emails.loadMore', { count: totalRecords - emailList.length })}</span>
                              )}
                            </button>
                          </li>
                        )}
                      </ul>
                    </div>
                  </div>

                  <div className="w-3/4">
                    {renderPreview()}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </PageContent>
    </>
  );
};

export default EmailsHome;
