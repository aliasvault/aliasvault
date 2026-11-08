import { isServerUnreachable } from '@aliasvault/client/api/errors/ExpectedFailure';
import { decryptEmailList } from '@aliasvault/client/email/EmailDecryption';
import { deleteEmails } from '@aliasvault/client/email/EmailDeletion';
import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import ConfirmDeleteModal from '@/entrypoints/popup/components/Dialogs/ConfirmDeleteModal';
import EllipsisMenu from '@/entrypoints/popup/components/EllipsisMenu';
import EmailCard from '@/entrypoints/popup/components/EmailCard';
import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import Icon from '@/entrypoints/popup/components/Icons/Icon';
import LoadingSpinner from '@/entrypoints/popup/components/LoadingSpinner';
import PageTitle from '@/entrypoints/popup/components/PageTitle';
import ReloadButton from '@/entrypoints/popup/components/ReloadButton';
import SelectionBar, { SelectionBarButton, SelectionMenuItem } from '@/entrypoints/popup/components/SelectionBar';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';
import { useListSelection } from '@/entrypoints/popup/hooks/useListSelection';
import { PopoutUtility } from '@/entrypoints/popup/utils/PopoutUtility';

import { logFailure } from '@/utils/Diagnostics';

import { useMinDurationLoading } from '@/hooks/useMinDurationLoading';

import type { InboxResponse, MailboxEmail } from '@aliasvault/models/webapi';

/**
 * What the selection keeps of an email: its id.
 */
const emailIdOf = (email: MailboxEmail): number => email.id;

/**
 * The selection key of an email id.
 */
const emailKey = (id: number): string => String(id);

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
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalRecords, setTotalRecords] = useState<number>(0);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);

  /**
   * Loading state with minimum duration for more fluid UX.
   */
  const [isLoading, setIsLoading] = useMinDurationLoading(true, 100);
  const [hasLoaded, setHasLoaded] = useState(false);
  const selection = useListSelection(emails, emailIdOf, emailKey);
  const { exit: exitSelection } = selection;
  /** The emails waiting for delete confirmation, and whether they are the bulk selection. */
  const [pendingDelete, setPendingDelete] = useState<{ ids: number[]; bulk: boolean } | null>(null);

  /**
   * Page size for pagination.
   */
  const PAGE_SIZE = 50;

  /**
   * Loads emails from the web API.
   */
  const loadEmails = useCallback(async (reset: boolean = true) : Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      exitSelection();

      if (!dbContext?.sqliteClient) {
        return;
      }

      // Check if we are in offline mode
      if (dbContext.isOffline) {
        setIsLoading(false);
        setIsInitialLoading(false);
        return;
      }

      try {
        // The server resolves the mailbox from the caller's active alias claims.
        const data = await webApi.get<InboxResponse>(`EmailBox?page=1&pageSize=${PAGE_SIZE}`);

        // Decrypt emails locally using private key associated with the email address.
        const encryptionKeys = dbContext.sqliteClient.encryptionKeys.getAll();

        // Decrypt emails locally using public/private key pairs.
        const decryptedEmails = await decryptEmailList(data.mails, data.publicKeys, encryptionKeys);

        if (reset) {
          setEmails(decryptedEmails);
          setCurrentPage(data.currentPage);
          setTotalRecords(data.totalRecords);
        }
      } catch (error) {
        logFailure('[Emails] Loading the mailbox failed', error);
        if (isServerUnreachable(error)) {
          await dbContext.setIsOffline(true);
          return;
        }
        throw new Error(t('common.errors.unknownError'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errors.unknownError'));
    } finally {
      setIsLoading(false);
      setIsInitialLoading(false);
      setHasLoaded(true);
    }
  }, [dbContext, webApi, setIsLoading, setIsInitialLoading, t, PAGE_SIZE, exitSelection]);

  /**
   * Loads more emails (next page).
   */
  const loadMoreEmails = useCallback(async () : Promise<void> => {
    if (isLoadingMore || !dbContext?.sqliteClient || dbContext.isOffline) {
      return;
    }

    try {
      setIsLoadingMore(true);
      setError(null);

      const nextPage = currentPage + 1;

      const data = await webApi.get<InboxResponse>(`EmailBox?page=${nextPage}&pageSize=${PAGE_SIZE}`);

      // Decrypt emails locally
      const encryptionKeys = dbContext.sqliteClient.encryptionKeys.getAll();
      const decryptedEmails = await decryptEmailList(data.mails, data.publicKeys, encryptionKeys);

      // Append to existing emails
      setEmails((prevEmails) => [...prevEmails, ...decryptedEmails]);
      setCurrentPage(data.currentPage);
      setTotalRecords(data.totalRecords);
    } catch (err) {
      logFailure('Failed to load more emails', err);
      if (isServerUnreachable(err)) {
        await dbContext.setIsOffline(true);
        return;
      }
      setError(err instanceof Error ? err.message : t('common.errors.unknownError'));
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, dbContext, webApi, currentPage, PAGE_SIZE, t]);

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
      return t('emails.time.justNow');
    } else if (secondsAgo < 3600) {
      // Less than 1 hour ago
      const minutes = Math.floor(secondsAgo / 60);
      if (minutes === 1) {
        return t('emails.time.minutesAgo_single', { count: minutes });
      } else {
        return t('emails.time.minutesAgo_plural', { count: minutes });
      }
    } else if (secondsAgo < 86400) {
      // Less than 24 hours ago
      const hours = Math.floor(secondsAgo / 3600);
      if (hours === 1) {
        return t('emails.time.hoursAgo_single', { count: hours });
      } else {
        return t('emails.time.hoursAgo_plural', { count: hours });
      }
    } else if (secondsAgo < 172800) {
      // Less than 48 hours ago
      return t('emails.time.yesterday');
    } else {
      // Older than 48 hours
      return emailDate.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit'
      });
    }
  };

  /**
   * Delete the emails waiting for confirmation and drop them from the list.
   */
  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) {
      return;
    }
    const { ids, bulk } = pendingDelete;
    setPendingDelete(null);
    try {
      const deleted = new Set(await deleteEmails(webApi, ids));
      setEmails(current => current.filter(email => !deleted.has(email.id)));
      setTotalRecords(total => Math.max(0, total - deleted.size));
      if (bulk) {
        exitSelection();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errors.unknownError'));
    }
  };

  const deleteModal = (
    <ConfirmDeleteModal
      isOpen={pendingDelete !== null}
      onClose={() => setPendingDelete(null)}
      onConfirm={() => void confirmDelete()}
      title={pendingDelete?.bulk ? t('emails.home.bulkDeleteEmailTitle') : t('emails.deleteEmail')}
      message={pendingDelete?.bulk ? t('emails.home.bulkDeleteEmailConfirmation', { count: pendingDelete.ids.length }) : t('emails.deleteEmailConfirm')}
      confirmText={t('common.delete')}
    />
  );

  const spinner = (
    <div className="flex justify-center items-center p-8">
      <LoadingSpinner />
    </div>
  );

  if (isLoading && !hasLoaded) {
    return spinner;
  }

  // Show offline message if in offline mode
  if (dbContext.isOffline) {
    return (
      <div>
        <div className="flex justify-between items-center mb-4">
          <PageTitle>{t('emails.title')}</PageTitle>
        </div>
        <div className="text-gray-500 dark:text-gray-400 space-y-2">
          <p className="text-sm">
            {t('emails.offlineMessage')}
          </p>
        </div>
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div>
        <div className="flex justify-between items-center mb-4">
          <PageTitle>{t('emails.title')}</PageTitle>
          <ReloadButton onClick={loadEmails} />
        </div>
        {isLoading && spinner}
        {!isLoading && error && <p className="text-sm text-red-500">{t('common.error')}: {error}</p>}
        {!isLoading && !error && (
          <div className="text-gray-500 dark:text-gray-400 space-y-2">
            <p className="text-sm">
              {t('emails.emptyMessage')}
            </p>
          </div>
        )}
      </div>
    );
  }

  const hasMoreEmails = totalRecords > emails.length;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <PageTitle>{t('emails.title')}</PageTitle>
        <div className="flex items-center gap-2">
          <EllipsisMenu id="emails-list-menu" label={t('common.moreOptions')}>
            <SelectionMenuItem isActive={selection.isActive} onToggle={() => (selection.isActive ? exitSelection() : selection.enter())} />
          </EllipsisMenu>
          <ReloadButton onClick={() => loadEmails(true)} />
        </div>
      </div>
      {isLoading ? spinner : (
        <div>
          {error && <p className="mb-4 text-sm text-red-500">{t('common.error')}: {error}</p>}
          <div className="space-y-2">
            {emails.map((email) => (
              <EmailCard
                key={email.id}
                email={email}
                dateLabel={formatEmailDate(email.dateSystem)}
                selectionMode={selection.isActive}
                isSelected={selection.isSelected(email)}
                onSelect={selection.toggle}
                onDelete={id => setPendingDelete({ ids: [id], bulk: false })}
              />
            ))}
          </div>

          {/* Load More Button */}
          {hasMoreEmails && emails.length > 0 && (
            <div className="mt-4">
              <button
                onClick={loadMoreEmails}
                disabled={isLoadingMore}
                className="w-full px-4 py-2 text-sm font-medium text-primary-600 bg-primary-50 border border-primary-200 rounded-md hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed dark:text-primary-400 dark:bg-primary-900/20 dark:border-primary-800 dark:hover:bg-primary-900/30"
              >
                {isLoadingMore ? (
                  <span className="flex items-center justify-center">
                    <Icon name="spinner" className="animate-spin -ml-1 mr-2 h-4 w-4" />
                    {t('common.loading')}
                  </span>
                ) : (
                  <span>{t('emails.loadMore', { count: totalRecords - emails.length })}</span>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {selection.isActive && (
        <SelectionBar count={selection.selection.length} visibleCount={emails.length} onSelectAll={selection.selectAll} onClose={exitSelection} dialogOpen={pendingDelete !== null}>
          <SelectionBarButton id="selection-delete" icon="trash" label={t('common.delete')} onClick={() => setPendingDelete({ ids: selection.selection, bulk: true })} disabled={selection.selection.length === 0} danger />
        </SelectionBar>
      )}
      {deleteModal}
    </div>
  );
};

export default EmailsList;
