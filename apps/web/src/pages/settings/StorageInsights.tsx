import { BulkFaviconService } from '@aliasvault/client/items/BulkFaviconService';
import { fromStandardFormat } from '@aliasvault/client/utilities/DateFormatter';
import { LogoKinds } from '@aliasvault/models/vault';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import Button from '@/components/shared/Button';
import Card from '@/components/shared/Card';
import PageContent from '@/components/shared/PageContent';
import PageHeader from '@/components/shared/PageHeader';
import SortableTable, { SortableTableColumn, SortableTableRow, type TableColumn } from '@/components/shared/SortableTable';
import { useConfirmModal } from '@/context/ConfirmModalContext';
import { useDb } from '@/context/DbContext';
import { useNotifications } from '@/context/NotificationContext';
import { useWebApi } from '@/context/WebApiContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVaultMutate } from '@/hooks/useVaultMutate';
import { formatBytes } from '@/utils/FormatBytes';
import { itemRoute } from '@/utils/ItemRoute';

import type { AttachmentSizeRow, LogoSizeRow, StorageCounts } from '@aliasvault/client/database/repositories/StorageInsightsRepository';
import type { StorageStatisticsResponse } from '@aliasvault/models/webapi';

const tk = 'pages.main.settings.storageInsights';

/** Blob categories as the server stores them. */
const ATTACHMENT_CATEGORY = 'attachment';
const LOGO_CATEGORY = 'favicon';

/** Rows in each "largest" table. */
const TOP_ROWS = 10;

type Segment = {
  label: string;
  bytes: number;
  colorClass: string;
};

type LocalStats = {
  counts: StorageCounts;
  attachments: AttachmentSizeRow[];
  logos: LogoSizeRow[];
};

/**
 * One count tile of the overview card.
 */
const CountTile: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="p-4 border border-gray-200 rounded-lg dark:border-gray-700">
    <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
    <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">{value}</p>
  </div>
);

/**
 * Card heading with an optional description.
 */
const CardHeading: React.FC<{ title: string; description?: string }> = ({ title, description }) => (
  <>
    <h3 className={`${description ? 'mb-2' : 'mb-4'} text-lg font-medium text-gray-900 dark:text-white`}>{title}</h3>
    {description && <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">{description}</p>}
  </>
);

/**
 * Share of a total as a percentage, 0 when the total is 0.
 * @param part - the part
 * @param total - the total
 */
const percent = (part: number, total: number): number => (total === 0 ? 0 : (part / total) * 100);

/**
 * A stored UTC timestamp as a local yyyy-mm-dd date.
 * @param value - the stored timestamp
 */
const formatDate = (value: string): string => {
  const date = fromStandardFormat(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/**
 * Vault storage insights page.
 */
const StorageInsights: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dbContext = useDb();
  const webApi = useWebApi();
  const notifications = useNotifications();
  const { showConfirmation } = useConfirmModal();
  const { executeVaultMutationAsync } = useVaultMutate();
  usePageTitle(t(`${tk}.PageTitle`));

  const [localStats, setLocalStats] = useState<LocalStats | null>(null);
  const [serverStats, setServerStats] = useState<StorageStatisticsResponse | null>(null);
  const [serverStatsFailed, setServerStatsFailed] = useState(false);
  const [isDeletingLogos, setIsDeletingLogos] = useState(false);
  const [redownloadProgress, setRedownloadProgress] = useState<{ processed: number; total: number } | null>(null);

  /**
   * Read the counts and the largest attachments and logos from the local vault.
   */
  const loadLocalStats = useCallback((): void => {
    const client = dbContext.sqliteClient;
    if (!client) {
      return;
    }
    setLocalStats({
      counts: client.storageInsights.getCounts(),
      attachments: client.storageInsights.getLargestAttachments(TOP_ROWS),
      logos: client.storageInsights.getLargestLogos(TOP_ROWS),
    });
  }, [dbContext.sqliteClient]);

  /**
   * Fetch the exact stored size from the server.
   */
  const loadServerStats = useCallback((): void => {
    webApi.get<StorageStatisticsResponse>('Vault/storage')
      .then((stats) => {
        setServerStats(stats);
        setServerStatsFailed(false);
      })
      .catch((error: unknown) => {
        console.error('Failed to load the vault storage statistics:', error);
        setServerStatsFailed(true);
      });
  }, [webApi]);

  useEffect(() => {
    loadLocalStats();
  }, [loadLocalStats]);

  useEffect(() => {
    loadServerStats();
  }, [loadServerStats]);

  /**
   * Open the item a table row belongs to.
   * @param id - the item id
   * @param manifestId - the item's manifest
   */
  const openItem = (id: string, manifestId: string): void => {
    void navigate(itemRoute({ Id: id, ManifestId: manifestId }));
  };

  /**
   * Reload both sources after a logo action changed the vault.
   */
  const reload = (): void => {
    loadLocalStats();
    loadServerStats();
  };

  /**
   * The server size per category, summed over every vault the user can open.
   */
  const segments = useMemo((): Segment[] => {
    if (!serverStats) {
      return [];
    }
    let credentials = 0;
    let attachments = 0;
    let logos = 0;
    for (const manifest of serverStats.manifests) {
      credentials += manifest.manifestBytes + manifest.bucketBytes;
      for (const blob of manifest.blobs) {
        if (blob.category === ATTACHMENT_CATEGORY) {
          attachments += blob.bytes;
        } else if (blob.category === LOGO_CATEGORY) {
          logos += blob.bytes;
        } else {
          credentials += blob.bytes;
        }
      }
    }
    return [
      { label: t(`${tk}.BreakdownCredentialsLabel`), bytes: credentials, colorClass: 'bg-blue-500' },
      { label: t(`${tk}.BreakdownAttachmentsLabel`), bytes: attachments, colorClass: 'bg-amber-500' },
      { label: t(`${tk}.BreakdownLogosLabel`), bytes: logos, colorClass: 'bg-emerald-500' },
    ];
  }, [serverStats, t]);

  const totalBytes = segments.reduce((sum, segment) => sum + segment.bytes, 0);
  const isLogoActionRunning = isDeletingLogos || redownloadProgress !== null;

  const attachmentColumns: TableColumn[] = [
    { title: t(`${tk}.ColumnFilename`) },
    { title: t(`${tk}.ColumnSize`) },
    { title: t(`${tk}.ColumnItem`) },
    { title: t(`${tk}.ColumnCreated`) },
  ];
  const logoColumns: TableColumn[] = [
    { title: t(`${tk}.ColumnWebsiteURL`) },
    { title: t(`${tk}.ColumnSize`) },
    { title: t(`${tk}.ColumnItemCount`) },
  ];

  /**
   * Remove every favicon from the personal vault after confirmation.
   */
  const deleteAllLogos = async (): Promise<void> => {
    const client = dbContext.sqliteClient;
    if (!client || isLogoActionRunning) {
      return;
    }
    const confirmed = await showConfirmation(t(`${tk}.DeleteAllLogosConfirmTitle`), t(`${tk}.DeleteAllLogosConfirmMessage`), t('sharedResources.Confirm'), t('sharedResources.Cancel'));
    if (!confirmed) {
      return;
    }
    setIsDeletingLogos(true);
    try {
      await executeVaultMutationAsync(async () => {
        await client.logos.deleteAllFavicons();
      });
      notifications.addSuccessMessage(t('sharedResources.Success'));
    } catch (error) {
      console.error('Failed to delete the logos:', error);
      notifications.addErrorMessage(t('sharedResources.ErrorGeneric'), true);
    } finally {
      setIsDeletingLogos(false);
      reload();
    }
  };

  /**
   * Fetch the favicon of every item in the personal vault again after confirmation.
   */
  const redownloadAllLogos = async (): Promise<void> => {
    const client = dbContext.sqliteClient;
    if (!client || isLogoActionRunning) {
      return;
    }
    const confirmed = await showConfirmation(t(`${tk}.RedownloadAllLogosConfirmTitle`), t(`${tk}.RedownloadAllLogosConfirmMessage`), t('sharedResources.Confirm'), t('sharedResources.Cancel'));
    if (!confirmed) {
      return;
    }
    setRedownloadProgress({ processed: 0, total: 0 });
    try {
      let rateLimited = false;
      await executeVaultMutationAsync(async () => {
        const result = await BulkFaviconService.refreshVaultFavicons(client, webApi, (processed, total) => setRedownloadProgress({ processed, total }));
        rateLimited = result.status === 'rateLimited';
      });
      if (rateLimited) {
        notifications.addErrorMessage(t('sharedResources.ErrorGeneric'), true);
      } else {
        notifications.addSuccessMessage(t('sharedResources.Success'));
      }
    } catch (error) {
      console.error('Failed to re-download the logos:', error);
      notifications.addErrorMessage(t('sharedResources.ErrorGeneric'), true);
    } finally {
      setRedownloadProgress(null);
      reload();
    }
  };

  return (
    <>
      <PageHeader breadcrumbItems={[{ displayName: t(`${tk}.BreadcrumbTitle`) }]} title={t(`${tk}.PageTitle`)} description={t(`${tk}.PageDescription`)} />

      <PageContent>
        <Card>
          <h3 className="mb-2 text-lg font-medium text-gray-900 dark:text-white">{t(`${tk}.ServerTotalTitle`)}</h3>
          {serverStatsFailed ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('sharedResources.ErrorGeneric')}</p>
          ) : serverStats ? (
            <>
              <p className="text-4xl font-semibold text-gray-900 dark:text-white">{formatBytes(totalBytes)}</p>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t(`${tk}.ServerTotalDescription`)}</p>
            </>
          ) : (
            <p className="text-gray-600 dark:text-gray-400">{t('sharedResources.Loading')}</p>
          )}
        </Card>

        <Card>
          <CardHeading title={t(`${tk}.CountsTitle`)} />
          {localStats ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <CountTile label={t(`${tk}.ItemCountLabel`)} value={localStats.counts.ItemCount} />
              <CountTile label={t(`${tk}.ItemsWithAttachmentsLabel`)} value={localStats.counts.ItemsWithAttachments} />
              <CountTile label={t(`${tk}.ItemsWithLogosLabel`)} value={localStats.counts.ItemsWithLogos} />
              <CountTile label={t(`${tk}.BreakdownAttachmentsLabel`)} value={localStats.counts.AttachmentCount} />
              <CountTile label={t(`${tk}.BreakdownLogosLabel`)} value={localStats.counts.LogoCount} />
            </div>
          ) : (
            <p className="text-gray-600 dark:text-gray-400">{t('sharedResources.Loading')}</p>
          )}
        </Card>

        {totalBytes > 0 && (
          <Card>
            <CardHeading title={t(`${tk}.BreakdownTitle`)} />
            <div className="flex w-full h-4 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
              {segments.map(segment => (
                <div key={segment.label} className={segment.colorClass} style={{ width: `${percent(segment.bytes, totalBytes).toFixed(2)}%` }} title={segment.label}></div>
              ))}
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3 text-sm">
              {segments.map(segment => (
                <div key={segment.label} className="flex items-center gap-2">
                  <span className={`inline-block w-3 h-3 rounded-sm ${segment.colorClass}`}></span>
                  <span className="text-gray-700 dark:text-gray-300">{segment.label}:</span>
                  <span className="font-medium text-gray-900 dark:text-white">{formatBytes(segment.bytes)} ({percent(segment.bytes, totalBytes).toFixed(1)}%)</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {localStats && (
          <>
            <Card>
              <CardHeading title={t(`${tk}.TopAttachmentsTitle`)} description={t(`${tk}.TopAttachmentsDescription`)} />
              {localStats.attachments.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">-</p>
              ) : (
                <SortableTable columns={attachmentColumns} sortColumn="" sortDirection="desc" onSortChanged={() => undefined}>
                  {localStats.attachments.map(attachment => (
                    <SortableTableRow key={`${attachment.ManifestId}:${attachment.Id}`} onClick={() => openItem(attachment.ItemId, attachment.ManifestId)}>
                      <SortableTableColumn isPrimary>{attachment.Filename}</SortableTableColumn>
                      <SortableTableColumn>{formatBytes(attachment.SizeBytes)}</SortableTableColumn>
                      <SortableTableColumn>{attachment.ItemName?.trim() ? attachment.ItemName : '-'}</SortableTableColumn>
                      <SortableTableColumn>{formatDate(attachment.CreatedAt)}</SortableTableColumn>
                    </SortableTableRow>
                  ))}
                </SortableTable>
              )}
            </Card>

            <Card>
              <CardHeading title={t(`${tk}.TopLogosTitle`)} description={t(`${tk}.TopLogosDescription`)} />
              {localStats.logos.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">-</p>
              ) : (
                <SortableTable columns={logoColumns} sortColumn="" sortDirection="desc" onSortChanged={() => undefined}>
                  {localStats.logos.map(logo => {
                    const firstItemId = logo.FirstItemId;
                    return (
                      <SortableTableRow key={`${logo.ManifestId}:${logo.Id}`} onClick={firstItemId ? (): void => openItem(firstItemId, logo.ManifestId) : undefined}>
                        <SortableTableColumn isPrimary>{logo.Kind === LogoKinds.Favicon ? logo.Source : (logo.Name ?? '-')}</SortableTableColumn>
                        <SortableTableColumn>{formatBytes(logo.SizeBytes)}</SortableTableColumn>
                        <SortableTableColumn>{logo.ItemCount}</SortableTableColumn>
                      </SortableTableRow>
                    );
                  })}
                </SortableTable>
              )}
            </Card>
          </>
        )}

        <Card>
          <CardHeading title={t(`${tk}.LogoManagementTitle`)} description={t(`${tk}.LogoManagementDescription`)} />
          {redownloadProgress && (
            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-700 dark:text-gray-300 mb-1">
                <span>{t('sharedResources.Loading')}</span>
                <span>{redownloadProgress.processed} / {redownloadProgress.total}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                <div className="bg-primary-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${percent(redownloadProgress.processed, redownloadProgress.total).toFixed(1)}%` }}></div>
              </div>
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-3">
            <Button color="secondary" isDisabled={isLogoActionRunning} onClick={() => void redownloadAllLogos()}>{t(`${tk}.RedownloadAllLogosButton`)}</Button>
            <Button color="danger" isDisabled={isLogoActionRunning} onClick={() => void deleteAllLogos()}>{t(`${tk}.DeleteAllLogosButton`)}</Button>
          </div>
        </Card>
      </PageContent>
    </>
  );
};

export default StorageInsights;
