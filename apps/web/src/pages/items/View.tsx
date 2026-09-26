import { FieldCategories, FieldKey, ItemTypes, TRASH_RETENTION_DEFAULT_DAYS, getFieldValue, type Attachment, type Item, type Passkey, type TotpCode } from '@aliasvault/models/vault';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import AttachmentViewer from '@/components/attachments/AttachmentViewer';
import RecentEmails from '@/components/email/RecentEmails';
import CopyPasteFormRow from '@/components/forms/CopyPasteFormRow';
import { type DisplayField, getUrlValues, groupDisplayFields, shouldBeFullWidth } from '@/components/items/DisplayField';
import FieldBlock from '@/components/items/FieldBlock';
import { buildFolderBreadcrumbs } from '@/components/items/FolderBreadcrumbs';
import ItemIcon from '@/components/items/ItemIcon';
import LoadingIndicator from '@/components/loading/LoadingIndicator';
import type { BreadcrumbItem } from '@/components/shared/Breadcrumb';
import Button from '@/components/shared/Button';
import Card from '@/components/shared/Card';
import FormModal from '@/components/shared/FormModal';
import LinkButton from '@/components/shared/LinkButton';
import PageContent from '@/components/shared/PageContent';
import PageHeader from '@/components/shared/PageHeader';
import TotpViewer from '@/components/totp/TotpViewer';
import { useDb } from '@/context/DbContext';
import { useNotifications } from '@/context/NotificationContext';
import { useEmailDomains } from '@/hooks/useEmailDomains';
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVaultMutate } from '@/hooks/useVaultMutate';
import { folderRoute, itemRoute } from '@/utils/ItemRoute';

import type { ItemRef } from '@aliasvault/client/database/ItemRef';
import type { Folder } from '@aliasvault/client/database/repositories/FolderRepository';

/**
 * A card section on the item page.
 */
const Section: React.FC<{ title?: string; children: React.ReactNode }> = ({ title, children }) => (
  <Card variant="section">
    {title && <h3 className="mb-4 text-xl font-semibold dark:text-white">{title}</h3>}
    {children}
  </Card>
);

/**
 * The fields of a section in the six column grid.
 */
const FieldGrid: React.FC<{ fields: DisplayField[]; item: ItemRef; fullWidth?: (field: DisplayField) => boolean; hideLabel?: boolean; withForm?: boolean }> = ({ fields, item, fullWidth, hideLabel = false, withForm = true }) => {
  const grid = (
    <div className="grid grid-cols-6 gap-6">
      {fields.map((field, index) => (
        <FieldBlock key={`${field.FieldKey}-${index}`} field={field} item={item} fullWidth={fullWidth ? fullWidth(field) : false} hideLabel={hideLabel} />
      ))}
    </div>
  );
  return withForm ? <form action="#">{grid}</form> : grid;
};

/**
 * The item details page.
 */
const ItemView: React.FC = () => {
  const { manifestId, id } = useParams<{ manifestId: string; id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dbContext = useDb();
  const notifications = useNotifications();
  const domains = useEmailDomains();
  const { executeVaultMutationAsync } = useVaultMutate();
  usePageTitle(t('pages.main.items.view.ViewItemPageTitle'));

  const [isLoading, setIsLoading] = useState(true);
  const [item, setItem] = useState<Item | null>(null);
  const [folder, setFolder] = useState<Folder | null>(null);
  const [totpCodes, setTotpCodes] = useState<TotpCode[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [breadcrumbItems, setBreadcrumbItems] = useState<BreadcrumbItem[]>([]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  /**
   * Load the item and everything shown with it.
   */
  const loadEntry = useCallback((): void => {
    const client = dbContext.sqliteClient;
    if (!client || !manifestId || !id) {
      return;
    }
    setIsLoading(true);

    const ref = { Id: id, ManifestId: manifestId };
    const loaded = client.items.getById(ref);
    if (!loaded) {
      notifications.addErrorMessage(t('pages.main.items.view.ItemNotFoundError'));
      navigate('/items', { replace: true });
      return;
    }

    const allFolders = client.folders.getAll();
    const folderRef = loaded.FolderId ? { Id: loaded.FolderId, ManifestId: loaded.ManifestId } : null;
    const itemFolder = folderRef ? allFolders.find(f => f.Id === folderRef.Id && f.ManifestId === folderRef.ManifestId) ?? null : null;
    const crumbs = folderRef ? buildFolderBreadcrumbs(folderRef, allFolders) : [];
    crumbs.push({ displayName: t('pages.main.items.view.ViewItemBreadcrumb') });

    setItem(loaded);
    setFolder(itemFolder);
    setBreadcrumbItems(crumbs);
    setTotpCodes(client.items.getTotpCodesForItem(ref));
    setAttachments(client.items.getAttachmentsForItem(ref));
    setPasskeys(client.passkeys.getByItemId(ref));
    setIsLoading(false);
  }, [dbContext.sqliteClient, manifestId, id, navigate, notifications, t]);

  // Reload when the vault is (re)loaded, so changes synced from other devices show without a refresh.
  useEffect(() => loadEntry(), [loadEntry]);

  useKeyboardShortcut('ge', () => {
    if (item) {
      navigate(itemRoute(item, true));
    }
  });
  useKeyboardShortcut('gd', () => setShowDeleteModal(true));

  const groupedFields = useMemo(() => item ? groupDisplayFields(item) : null, [item]);
  const urlValues = useMemo(() => item ? getUrlValues(item) : [], [item]);
  const emailAddress = item ? getFieldValue(item, FieldKey.LoginEmail) ?? '' : '';

  /**
   * Delete the item (move it to the trash / recently deleted items) and go back to the list.
   */
  const confirmDelete = async (): Promise<void> => {
    if (isDeleting) {
      return;
    }
    if (!item) {
      notifications.addErrorMessage(t('pages.main.items.delete.DeleteItemNotFoundError'), true);
      setShowDeleteModal(false);
      return;
    }

    setIsDeleting(true);
    try {
      await executeVaultMutationAsync(async () => {
        await dbContext.sqliteClient?.items.trash(item);
      });
      notifications.addSuccessMessage(t('pages.main.items.delete.DeleteSuccessMessage'));
      navigate('/items');
    } finally {
      setIsDeleting(false);
      setShowDeleteModal(false);
    }
  };

  if (isLoading || !item || !groupedFields) {
    return <LoadingIndicator />;
  }

  const isLoginLike = item.ItemType === ItemTypes.Login || item.ItemType === ItemTypes.Alias;
  const loginFields = groupedFields[FieldCategories.Login];
  const aliasFields = groupedFields[FieldCategories.Alias];
  const cardFields = groupedFields[FieldCategories.Card];
  const notesFields = groupedFields[FieldCategories.Notes];
  const customFields = groupedFields[FieldCategories.Custom];
  const firstName = aliasFields.find(f => f.FieldKey === FieldKey.AliasFirstName)?.Value ?? '';
  const lastName = aliasFields.find(f => f.FieldKey === FieldKey.AliasLastName)?.Value ?? '';
  const passkey = passkeys[0];

  return (
    <>
      <PageHeader
        breadcrumbItems={breadcrumbItems}
        title={t('pages.main.items.view.ViewItemTitle')}
        customActions={(
          <>
            <LinkButton smallText={t('pages.main.items.view.EditButtonMobile')} text={t('pages.main.items.view.EditButtonDesktop')} href={itemRoute(item, true)} color="primary" />
            <Button color="danger" onClick={() => setShowDeleteModal(true)}>
              <span className="md:hidden">{t('pages.main.items.view.DeleteButtonMobile')}</span>
              <span className="hidden md:inline">{t('pages.main.items.view.DeleteButtonDesktop')}</span>
            </Button>
          </>
        )}
      />

      <PageContent>
        <div className="grid grid-cols-1 px-4 md:grid-cols-2 lg:grid-cols-3 lg:gap-4 dark:bg-gray-900">
          <div className="col-span-1 md:col-span-2 lg:col-span-1">
            <Section>
              <div className="items-center flex space-x-4">
                <ItemIcon item={item} altText={item.Name ?? 'Item'} sizeClass="w-14 h-14" />
                <div className="flex-1 min-w-0">
                  <h3 className="mb-1 text-xl font-bold text-gray-900 dark:text-white truncate">{item.Name ?? t('pages.main.items.view.Untitled')}</h3>
                  {urlValues.map((url) => (
                    <div key={url} className="text-sm truncate">
                      {/^https?:\/\//i.test(url)
                        ? <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary-600 break-all dark:text-primary-400 hover:underline">{url}</a>
                        : <span className="text-gray-700 break-all dark:text-gray-300">{url}</span>}
                    </div>
                  ))}
                  {folder && (
                    <Link to={folderRoute(folder)} className="inline-flex items-center gap-2 mt-2 px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                      <svg className="w-4 h-4 text-orange-500" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
                      </svg>
                      <span>{folder.Name}</span>
                    </Link>
                  )}
                </div>
              </div>
            </Section>

            {isLoginLike && emailAddress.length > 0 && <RecentEmails emailAddress={emailAddress} />}

            {totpCodes.length > 0 && <TotpViewer totpCodes={totpCodes} />}

            {item.ItemType !== ItemTypes.Note && notesFields.length > 0 && (
              <Section title={t('pages.main.items.view.NotesSection')}>
                <FieldGrid fields={notesFields} item={item} hideLabel withForm={false} />
              </Section>
            )}

            {attachments.some(a => !a.IsDeleted) && <AttachmentViewer attachments={attachments} />}
          </div>

          <div className="col-span-1 md:col-span-2 lg:col-span-2">
            {isLoginLike && loginFields.length > 0 && (
              <Card variant="section">
                <h3 className="mb-2 text-xl font-semibold dark:text-white">{t('pages.main.items.view.LoginDetailsSection')}</h3>
                <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
                  <span>{domains.isAliasVaultSupportedDomain(emailAddress) ? t('pages.main.items.view.GeneratedItemDescription') : t('pages.main.items.view.StoredItemDescription')}</span>
                </p>

                {passkey && (
                  <div className="mb-6 p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
                    <div className="flex items-start gap-3">
                      <svg className="w-5 h-5 text-gray-600 dark:text-gray-400 mt-0.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                      </svg>
                      <div className="flex-1">
                        <div className="mb-1">
                          <span className="text-sm font-semibold text-gray-900 dark:text-white">{t('pages.main.items.view.PasskeyLabel')}</span>
                        </div>
                        <div className="space-y-1 mb-2">
                          {passkey.RpId.trim().length > 0 && (
                            <div>
                              <span className="text-xs text-gray-500 dark:text-gray-400">{t('pages.main.items.view.PasskeySiteLabel')}: </span>
                              <span className="text-sm text-gray-900 dark:text-white">{passkey.RpId}</span>
                            </div>
                          )}
                          {(passkey.DisplayName ?? '').trim().length > 0 && (
                            <div>
                              <span className="text-xs text-gray-500 dark:text-gray-400">{t('pages.main.items.view.PasskeyDisplayNameLabel')}: </span>
                              <span className="text-sm text-gray-900 dark:text-white">{passkey.DisplayName}</span>
                            </div>
                          )}
                        </div>
                        <p className="text-xs text-gray-600 dark:text-gray-400">{t('pages.main.items.view.PasskeyHelpText')}</p>
                      </div>
                    </div>
                  </div>
                )}

                <FieldGrid fields={loginFields} item={item} fullWidth={f => shouldBeFullWidth(f, loginFields)} />
              </Card>
            )}

            {item.ItemType === ItemTypes.Alias && aliasFields.length > 0 && (
              <Section title={t('pages.main.items.view.AliasSection')}>
                <form action="#">
                  <div className="grid grid-cols-6 gap-6">
                    {firstName.trim().length > 0 && lastName.trim().length > 0 && (
                      <div className="col-span-6">
                        <CopyPasteFormRow id="alias-full-name" label={t('pages.main.items.view.FullNameLabel')} value={`${firstName} ${lastName}`} />
                      </div>
                    )}
                    {aliasFields.map((field, index) => (
                      <FieldBlock key={`${field.FieldKey}-${index}`} field={field} item={item} fullWidth={shouldBeFullWidth(field, aliasFields)} />
                    ))}
                  </div>
                </form>
              </Section>
            )}

            {item.ItemType === ItemTypes.CreditCard && cardFields.length > 0 && (
              <Section title={t('pages.main.items.view.CardSection')}>
                <FieldGrid fields={cardFields} item={item} fullWidth={f => shouldBeFullWidth(f, cardFields)} />
              </Section>
            )}

            {item.ItemType === ItemTypes.Note && notesFields.length > 0 && (
              <Section title={t('pages.main.items.view.NotesSection')}>
                <FieldGrid fields={notesFields} item={item} hideLabel withForm={false} />
              </Section>
            )}

            {customFields.length > 0 && (
              <Section>
                <FieldGrid fields={customFields} item={item} fullWidth={() => true} />
              </Section>
            )}
          </div>
        </div>
      </PageContent>

      <FormModal
        isOpen={showDeleteModal}
        title={t('pages.main.items.delete.DeleteItemTitle')}
        iconBackgroundClass="bg-red-100 dark:bg-red-900/30"
        confirmText={t('pages.main.items.delete.YesImSureButton')}
        cancelText={t('pages.main.items.delete.NoCancelButton')}
        confirmButtonClass="bg-red-600 hover:bg-red-700"
        isLoading={isDeleting}
        onConfirm={() => void confirmDelete()}
        onClose={() => {
          if (!isDeleting) {
            setShowDeleteModal(false);
          }
        }}
        icon={(
          <svg className="h-6 w-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        )}
      >
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">{t('pages.main.items.delete.DeleteItemDescription', { 0: TRASH_RETENTION_DEFAULT_DAYS })}</p>
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-md p-3">
          <p className="text-sm font-medium text-gray-900 dark:text-white break-all">{item.Name ?? ''}</p>
        </div>
      </FormModal>
    </>
  );
};

export default ItemView;
