import { LogoKinds, type ItemType, type LogoKind } from '@aliasvault/models/vault';

import { AliasVaultCsvExportService } from '../../transfer/export/AliasVaultCsvExportService';
import { fromStandardFormat, toStandardFormat } from '../../utilities/DateHelpers';
import { BaseRepository } from '../BaseRepository';
import { scopedKey } from '../ItemRef';
import { AttachmentQueries, FieldDefinitionQueries, FieldHistoryQueries, FieldValueQueries, TotpCodeQueries } from '../queries/ItemQueries';

import type { AttachmentEntity, FieldDefinitionEntity, FieldHistoryEntity, FieldValueEntity, FolderEntity, ItemEntity, ItemTagEntity, LogoEntity, PasskeyEntity, TagEntity, TotpCodeEntity } from '../../transfer/shared/VaultEntities';
import type { IDatabaseClient } from '../BaseRepository';
import type { DbOp } from '../DbOp';
import type { LogoRepository } from './LogoRepository';

/**
 * Everything a full vault export carries.
 */
export type VaultExportData = {
  items: ItemEntity[];
  folders: FolderEntity[];
  tags: TagEntity[];
  itemTags: ItemTagEntity[];
  fieldDefinitions: FieldDefinitionEntity[];
};

/**
 * Keep track of what the import already wrote (shared and reused parent objects).
 */
export type ImportWriteSession = {
  /** Ids of the custom field definitions already written. */
  writtenDefinitionIds: Set<string>;
  /** Imported tag ids to the ids of the tags they were written as. */
  tagIds: Map<string, string>;
};

/**
 * Start an empty import write session.
 * @returns The session
 */
export function createImportWriteSession(): ImportWriteSession {
  return { writtenDefinitionIds: new Set(), tagIds: new Map() };
}

/** A row of a manifest-scoped child table, with the key of the item it hangs off. */
type ChildRow = { ItemId: string; ManifestId: string };

/** The tables a vault reset empties, dependents first. */
const RESET_TABLES = ['Attachments', 'FieldValues', 'FieldHistories', 'TotpCodes', 'Passkeys', 'ItemTags', 'ItemStats', 'FieldDefinitions', 'Tags', 'Items', 'Logos', 'Folders'];

/**
 * Repository for the import/export logic: reads whole item graphs for an export and writes imported item graphs
 * with their original timestamps.
 */
export class ImportExportRepository extends BaseRepository {
  /**
   * Constructor for the ImportExportRepository class.
   * @param client - The database client to use for the repository
   * @param logoRepository - The logo repository, to resolve the logo of an imported item
   */
  public constructor(client: IDatabaseClient, private logoRepository: LogoRepository) {
    super(client);
  }

  /**
   * The manifest every vault export reads: always the personal manifest.
   *
   * Note: shared manifests are not part of a regular vault export. Exporting a shared manifest is a separate,
   * admin-only flow in the family sharing UI.
   * @returns The personal manifest id
   */
  private *exportManifestId(): DbOp<string> {
    const manifestId = yield* this.personalManifestId();
    if (!manifestId) {
      throw new Error('This client has no personal manifest recorded yet; sync once before exporting.');
    }
    return manifestId;
  }

  /**
   * Export the personal manifest's live items, archived ones included, as an AliasVault CSV file (built from {@link getExportData}).
   * @returns The CSV file as UTF-8 bytes
   */
  public *exportToCsv(): DbOp<Uint8Array> {
    const data = yield* this.getExportData();
    return AliasVaultCsvExportService.exportItemsToCsv(data.items, data.folders);
  }

  /**
   * Read every live item of the personal manifest with its child rows, plus the folders, tags, custom field definitions
   * and logos the items use. Archived items are included, deleted items (in trash) are not.
   * @returns The vault data
   */
  public *getExportData(): DbOp<VaultExportData> {
    const manifestId = yield* this.exportManifestId();

    const itemRows = yield* this.query<{ Id: string; ManifestId: string; Name: string | null; ItemType: string; FolderId: string | null; LogoId: string | null; ArchivedAt: string | null; CreatedAt: string; UpdatedAt: string }>(
      'SELECT Id, ManifestId, Name, ItemType, FolderId, LogoId, ArchivedAt, CreatedAt, UpdatedAt FROM Items WHERE IsDeleted = 0 AND DeletedAt IS NULL AND ManifestId = ? ORDER BY CreatedAt',
      [manifestId]
    );

    const fieldDefinitionRows = yield* this.query<{ Id: string; ManifestId: string; FieldType: string; Label: string; IsMultiValue: number; IsHidden: number; EnableHistory: number; Weight: number; ApplicableToTypes: string | null; CreatedAt: string; UpdatedAt: string }>(
      'SELECT Id, ManifestId, FieldType, Label, IsMultiValue, IsHidden, EnableHistory, Weight, ApplicableToTypes, CreatedAt, UpdatedAt FROM FieldDefinitions WHERE IsDeleted = 0 AND ManifestId = ?',
      [manifestId]
    );
    const fieldDefinitions = fieldDefinitionRows.map((row): FieldDefinitionEntity & { ManifestId: string } => ({
      Id: row.Id,
      ManifestId: row.ManifestId,
      FieldType: row.FieldType,
      Label: row.Label,
      IsMultiValue: row.IsMultiValue === 1,
      IsHidden: row.IsHidden === 1,
      EnableHistory: row.EnableHistory === 1,
      Weight: row.Weight,
      ApplicableToTypes: row.ApplicableToTypes,
      CreatedAt: fromStandardFormat(row.CreatedAt),
      UpdatedAt: fromStandardFormat(row.UpdatedAt),
      IsDeleted: false,
    }));
    const definitionsByKey = new Map(fieldDefinitions.map(definition => [scopedKey(definition.ManifestId, definition.Id), definition]));

    const fieldValueRows = yield* this.query<ChildRow & { Id: string; FieldKey: string | null; FieldDefinitionId: string | null; Value: string | null; Weight: number; CreatedAt: string; UpdatedAt: string }>(
      'SELECT fv.Id, fv.ItemId, fv.ManifestId, fv.FieldKey, fv.FieldDefinitionId, fv.Value, fv.Weight, fv.CreatedAt, fv.UpdatedAt FROM FieldValues fv INNER JOIN Items i ON i.Id = fv.ItemId AND i.ManifestId = fv.ManifestId WHERE fv.IsDeleted = 0 AND i.IsDeleted = 0 AND i.DeletedAt IS NULL AND i.ManifestId = ? ORDER BY fv.Weight, fv.ValueIndex',
      [manifestId]
    );
    const fieldValuesByItem = ImportExportRepository.groupByItem(fieldValueRows, (row): FieldValueEntity => ({
      Id: row.Id,
      ItemId: row.ItemId,
      FieldKey: row.FieldKey,
      FieldDefinitionId: row.FieldDefinitionId,
      FieldDefinition: row.FieldDefinitionId ? definitionsByKey.get(scopedKey(row.ManifestId, row.FieldDefinitionId)) ?? null : null,
      Value: row.Value,
      Weight: row.Weight,
      CreatedAt: fromStandardFormat(row.CreatedAt),
      UpdatedAt: fromStandardFormat(row.UpdatedAt),
      IsDeleted: false,
    }));

    const fieldHistoryRows = yield* this.query<ChildRow & { Id: string; FieldKey: string | null; FieldDefinitionId: string | null; ValueSnapshot: string; ChangedAt: string; CreatedAt: string; UpdatedAt: string }>(
      'SELECT fh.Id, fh.ItemId, fh.ManifestId, fh.FieldKey, fh.FieldDefinitionId, fh.ValueSnapshot, fh.ChangedAt, fh.CreatedAt, fh.UpdatedAt FROM FieldHistories fh INNER JOIN Items i ON i.Id = fh.ItemId AND i.ManifestId = fh.ManifestId WHERE fh.IsDeleted = 0 AND i.IsDeleted = 0 AND i.DeletedAt IS NULL AND i.ManifestId = ? ORDER BY fh.ChangedAt',
      [manifestId]
    );
    const fieldHistoriesByItem = ImportExportRepository.groupByItem(fieldHistoryRows, (row): FieldHistoryEntity => ({
      Id: row.Id,
      ItemId: row.ItemId,
      FieldKey: row.FieldKey,
      FieldDefinitionId: row.FieldDefinitionId,
      ValueSnapshot: row.ValueSnapshot,
      ChangedAt: fromStandardFormat(row.ChangedAt),
      CreatedAt: fromStandardFormat(row.CreatedAt),
      UpdatedAt: fromStandardFormat(row.UpdatedAt),
      IsDeleted: false,
    }));

    const attachmentRows = yield* this.query<ChildRow & { Id: string; Filename: string; Blob: Uint8Array | null; CreatedAt: string; UpdatedAt: string }>(
      'SELECT a.Id, a.ItemId, a.ManifestId, a.Filename, a.Blob, a.CreatedAt, a.UpdatedAt FROM Attachments a INNER JOIN Items i ON i.Id = a.ItemId AND i.ManifestId = a.ManifestId WHERE a.IsDeleted = 0 AND i.IsDeleted = 0 AND i.DeletedAt IS NULL AND i.ManifestId = ?',
      [manifestId]
    );
    const attachmentsByItem = ImportExportRepository.groupByItem(attachmentRows, (row): AttachmentEntity => ({
      Id: row.Id,
      ItemId: row.ItemId,
      Filename: row.Filename,
      Blob: row.Blob ? new Uint8Array(row.Blob) : new Uint8Array(0),
      CreatedAt: fromStandardFormat(row.CreatedAt),
      UpdatedAt: fromStandardFormat(row.UpdatedAt),
      IsDeleted: false,
    }));

    const totpRows = yield* this.query<ChildRow & { Id: string; Name: string; SecretKey: string; Algorithm: string | null; Digits: number | null; Period: number | null; CreatedAt: string; UpdatedAt: string }>(
      'SELECT t.Id, t.ItemId, t.ManifestId, t.Name, t.SecretKey, t.Algorithm, t.Digits, t.Period, t.CreatedAt, t.UpdatedAt FROM TotpCodes t INNER JOIN Items i ON i.Id = t.ItemId AND i.ManifestId = t.ManifestId WHERE t.IsDeleted = 0 AND i.IsDeleted = 0 AND i.DeletedAt IS NULL AND i.ManifestId = ?',
      [manifestId]
    );
    const totpCodesByItem = ImportExportRepository.groupByItem(totpRows, (row): TotpCodeEntity => ({
      Id: row.Id,
      ItemId: row.ItemId,
      Name: row.Name ?? '',
      SecretKey: row.SecretKey,
      Algorithm: row.Algorithm ?? 'SHA1',
      Digits: row.Digits ?? 6,
      Period: row.Period ?? 30,
      CreatedAt: fromStandardFormat(row.CreatedAt),
      UpdatedAt: fromStandardFormat(row.UpdatedAt),
      IsDeleted: false,
    }));

    const passkeyRows = yield* this.query<ChildRow & { Id: string; CredentialId: Uint8Array | null; RpId: string; UserHandle: Uint8Array | null; PublicKey: string; PrivateKey: string; PrfKey: Uint8Array | null; DisplayName: string; AdditionalData: Uint8Array | null; CreatedAt: string; UpdatedAt: string }>(
      'SELECT p.Id, p.CredentialId, p.ItemId, p.ManifestId, p.RpId, p.UserHandle, p.PublicKey, p.PrivateKey, p.PrfKey, p.DisplayName, p.AdditionalData, p.CreatedAt, p.UpdatedAt FROM Passkeys p INNER JOIN Items i ON i.Id = p.ItemId AND i.ManifestId = p.ManifestId WHERE p.IsDeleted = 0 AND i.IsDeleted = 0 AND i.DeletedAt IS NULL AND i.ManifestId = ?',
      [manifestId]
    );
    const passkeysByItem = ImportExportRepository.groupByItem(passkeyRows, (row): PasskeyEntity => ({
      Id: row.Id,
      CredentialId: row.CredentialId ? new Uint8Array(row.CredentialId) : null,
      ItemId: row.ItemId,
      RpId: row.RpId,
      UserHandle: row.UserHandle ? new Uint8Array(row.UserHandle) : null,
      PublicKey: row.PublicKey,
      PrivateKey: row.PrivateKey,
      PrfKey: row.PrfKey ? new Uint8Array(row.PrfKey) : null,
      DisplayName: row.DisplayName ?? '',
      AdditionalData: row.AdditionalData ? new Uint8Array(row.AdditionalData) : null,
      CreatedAt: fromStandardFormat(row.CreatedAt),
      UpdatedAt: fromStandardFormat(row.UpdatedAt),
      IsDeleted: false,
    }));

    // Only the logos the exported items point at.
    const logoIds = new Set(itemRows.map(row => row.LogoId).filter((id): id is string => id !== null));
    const logoRows = yield* this.query<{ Id: string; Kind: LogoKind; Source: string; Name: string | null; FileData: Uint8Array | null; MimeType: string | null; UpdatedAt: string }>(
      'SELECT Id, Kind, Source, Name, FileData, MimeType, UpdatedAt FROM Logos WHERE IsDeleted = 0 AND ManifestId = ?',
      [manifestId]
    );
    const logosById = new Map(logoRows.filter(row => logoIds.has(row.Id)).map((row): [string, LogoEntity] => [row.Id, {
      Id: row.Id,
      Kind: row.Kind,
      Source: row.Source,
      Name: row.Name,
      FileData: row.FileData ? new Uint8Array(row.FileData) : null,
      MimeType: row.MimeType,
      FetchedAt: fromStandardFormat(row.UpdatedAt),
      IsDeleted: false,
    }]));

    const items = itemRows.map((row): ItemEntity => {
      const key = scopedKey(row.ManifestId, row.Id);
      return {
        Id: row.Id,
        Name: row.Name,
        ItemType: row.ItemType as ItemType,
        FolderId: row.FolderId,
        Logo: row.LogoId ? logosById.get(row.LogoId) ?? null : null,
        ArchivedAt: row.ArchivedAt ? fromStandardFormat(row.ArchivedAt) : null,
        CreatedAt: fromStandardFormat(row.CreatedAt),
        UpdatedAt: fromStandardFormat(row.UpdatedAt),
        IsDeleted: false,
        FieldValues: fieldValuesByItem.get(key) ?? [],
        FieldHistories: fieldHistoriesByItem.get(key) ?? [],
        Attachments: attachmentsByItem.get(key) ?? [],
        TotpCodes: totpCodesByItem.get(key) ?? [],
        Passkeys: passkeysByItem.get(key) ?? [],
      };
    });

    const folderRows = yield* this.query<{ Id: string; Name: string; ParentFolderId: string | null; Weight: number; CreatedAt: string; UpdatedAt: string }>(
      'SELECT Id, Name, ParentFolderId, Weight, CreatedAt, UpdatedAt FROM Folders WHERE IsDeleted = 0 AND ManifestId = ?',
      [manifestId]
    );
    const folders = folderRows.map((row): FolderEntity => ({
      Id: row.Id,
      Name: row.Name,
      ParentFolderId: row.ParentFolderId,
      Weight: row.Weight,
      CreatedAt: fromStandardFormat(row.CreatedAt),
      UpdatedAt: fromStandardFormat(row.UpdatedAt),
      IsDeleted: false,
    }));

    const tagRows = yield* this.query<{ Id: string; Name: string; Color: string | null; DisplayOrder: number; CreatedAt: string; UpdatedAt: string }>(
      'SELECT Id, Name, Color, DisplayOrder, CreatedAt, UpdatedAt FROM Tags WHERE IsDeleted = 0 AND ManifestId = ?',
      [manifestId]
    );
    const tags = tagRows.map((row): TagEntity => ({
      Id: row.Id,
      Name: row.Name,
      Color: row.Color,
      DisplayOrder: row.DisplayOrder,
      CreatedAt: fromStandardFormat(row.CreatedAt),
      UpdatedAt: fromStandardFormat(row.UpdatedAt),
      IsDeleted: false,
    }));

    const itemTagRows = yield* this.query<{ ItemId: string; TagId: string }>('SELECT ItemId, TagId FROM ItemTags WHERE IsDeleted = 0 AND ManifestId = ?', [manifestId]);
    const itemTags = itemTagRows.map((row): ItemTagEntity => ({ ItemId: row.ItemId, TagId: row.TagId, IsDeleted: false }));

    return { items, folders, tags, itemTags, fieldDefinitions };
  }

  /**
   * Group child rows by the key of their item.
   * @param rows - The rows
   * @param map - Maps a row to its entity
   * @returns The entities per item key (see {@link scopedKey})
   */
  private static groupByItem<TRow extends ChildRow, TEntity>(rows: TRow[], map: (row: TRow) => TEntity): Map<string, TEntity[]> {
    const grouped = new Map<string, TEntity[]>();
    for (const row of rows) {
      const key = scopedKey(row.ManifestId, row.ItemId);
      const list = grouped.get(key) ?? [];
      list.push(map(row));
      grouped.set(key, list);
    }
    return grouped;
  }

  /**
   * Resolve the logo an imported item gets for a source domain: the favicon the item's manifest already holds when
   * it has image data, else a row filled (or refilled) with the given bytes, else the favicon another manifest holds.
   * @param source - The Logos.Source key (the domain)
   * @param faviconBytes - The favicon bytes to store, or null when none are available
   * @returns The logo id, or null when the item gets no logo
   */
  public async resolveImportLogo(source: string, faviconBytes: Uint8Array | null): Promise<string | null> {
    const scope = await this.run(this.writeManifestId());
    const currentDateTime = this.now();

    const existing = (await this.run(this.query<{ Id: string; FileData: Uint8Array | null }>(
      'SELECT Id, FileData FROM Logos WHERE ManifestId = ? AND Kind = ? AND Source = ? AND IsDeleted = 0 LIMIT 1',
      [scope, LogoKinds.Favicon, source]
    )))[0];
    if (existing && existing.FileData && existing.FileData.length > 0) {
      return existing.Id;
    }

    if (faviconBytes && faviconBytes.length > 0) {
      return this.logoRepository.getOrCreate(scope, LogoKinds.Favicon, source, faviconBytes, currentDateTime, { mimeType: 'image/x-icon' });
    }

    return this.logoRepository.ensureInScope(scope, LogoKinds.Favicon, source, currentDateTime);
  }

  /**
   * Resolve the logo an item carried in from an AliasVault export, keeping its kind: a favicon goes through
   * {@link resolveImportLogo}, a built-in logo is recreated from its catalog key and an uploaded one from its bytes.
   * @param logo - The carried logo
   * @returns The logo id, or null when the item gets no logo
   */
  public async resolveCarriedLogo(logo: LogoEntity): Promise<string | null> {
    if (logo.Kind === LogoKinds.Favicon) {
      return this.resolveImportLogo(logo.Source, logo.FileData);
    }

    const scope = await this.run(this.writeManifestId());
    const currentDateTime = this.now();
    const options = { mimeType: logo.MimeType, name: logo.Name };

    if (logo.Kind === LogoKinds.Builtin) {
      return this.logoRepository.getOrCreate(scope, LogoKinds.Builtin, logo.Source, null, currentDateTime, options);
    }

    // An uploaded logo is keyed by the hash of its bytes, so it is stored the way an upload is rather than trusting the file's key.
    if (logo.FileData && logo.FileData.length > 0) {
      return this.logoRepository.storeUpload(scope, logo.FileData, currentDateTime, options);
    }

    return this.logoRepository.ensureInScope(scope, LogoKinds.Custom, logo.Source, currentDateTime);
  }

  /**
   * Insert an imported item with its field values and history, custom field definitions, tags, TOTP codes, passkeys
   * and attachments, keeping the timestamps the source export carried.
   * @param item - The item graph to insert
   * @param logoId - The id of the item's logo in this vault (from {@link resolveImportLogo} or {@link resolveCarriedLogo}), or null
   * @param session - What this import already wrote, shared across its items
   */
  public async insertImportedItem(item: ItemEntity, logoId: string | null, session: ImportWriteSession = createImportWriteSession()): Promise<void> {
    return this.withTransaction(() => this.run(this.insertItemGraph(item, logoId, session)));
  }

  /**
   * Write one item graph.
   * @param item - The item graph
   * @param logoId - The id of the item's logo in this vault, or null
   * @param session - What this import already wrote
   */
  private *insertItemGraph(item: ItemEntity, logoId: string | null, session: ImportWriteSession): DbOp<void> {
    const manifestId = yield* this.writeManifestId();

    yield* this.execute(
      'INSERT INTO Items (Id, Name, ItemType, LogoId, FolderId, ManifestId, ArchivedAt, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)',
      [item.Id, item.Name, item.ItemType, logoId, item.FolderId, manifestId, item.ArchivedAt ? toStandardFormat(item.ArchivedAt) : null, toStandardFormat(item.CreatedAt), toStandardFormat(item.UpdatedAt)]
    );

    // Custom field definitions come before the values and history that reference them.
    for (const definition of [...item.FieldValues, ...item.FieldHistories].map(row => row.FieldDefinition)) {
      if (definition) {
        yield* this.insertFieldDefinition(definition, manifestId, session);
      }
    }

    // Values of one multi-value field are numbered in file order.
    const valueIndexes = new Map<string, number>();
    for (const fieldValue of item.FieldValues) {
      const fieldIdentity = fieldValue.FieldDefinitionId ?? fieldValue.FieldKey ?? '';
      const valueIndex = valueIndexes.get(fieldIdentity) ?? 0;
      valueIndexes.set(fieldIdentity, valueIndex + 1);

      yield* this.execute(FieldValueQueries.INSERT, [
        fieldValue.Id,
        item.Id,
        manifestId,
        fieldValue.FieldDefinitionId,
        fieldValue.FieldKey,
        fieldValue.Value ?? '',
        fieldValue.Weight,
        valueIndex,
        toStandardFormat(fieldValue.CreatedAt),
        toStandardFormat(fieldValue.UpdatedAt),
        0,
      ]);
    }

    for (const fieldHistory of item.FieldHistories) {
      yield* this.execute(FieldHistoryQueries.INSERT, [
        fieldHistory.Id,
        item.Id,
        manifestId,
        fieldHistory.FieldDefinitionId,
        fieldHistory.FieldKey,
        fieldHistory.ValueSnapshot,
        toStandardFormat(fieldHistory.ChangedAt),
        toStandardFormat(fieldHistory.CreatedAt),
        toStandardFormat(fieldHistory.UpdatedAt),
        0,
      ]);
    }

    for (const totpCode of item.TotpCodes) {
      yield* this.execute(TotpCodeQueries.INSERT, [
        totpCode.Id,
        totpCode.Name,
        totpCode.SecretKey,
        totpCode.Algorithm,
        totpCode.Digits,
        totpCode.Period,
        item.Id,
        manifestId,
        toStandardFormat(totpCode.CreatedAt),
        toStandardFormat(totpCode.UpdatedAt),
        0,
      ]);
    }

    for (const passkey of item.Passkeys) {
      yield* this.execute(
        'INSERT INTO Passkeys (Id, CredentialId, ItemId, ManifestId, RpId, UserHandle, PublicKey, PrivateKey, PrfKey, DisplayName, AdditionalData, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)',
        [passkey.Id, passkey.CredentialId, item.Id, manifestId, passkey.RpId, passkey.UserHandle, passkey.PublicKey, passkey.PrivateKey, passkey.PrfKey, passkey.DisplayName, passkey.AdditionalData, toStandardFormat(passkey.CreatedAt), toStandardFormat(passkey.UpdatedAt)]
      );
    }

    for (const attachment of item.Attachments) {
      yield* this.execute(AttachmentQueries.INSERT, [
        attachment.Id,
        attachment.Filename,
        attachment.Blob,
        item.Id,
        manifestId,
        toStandardFormat(attachment.CreatedAt),
        toStandardFormat(attachment.UpdatedAt),
        0,
      ]);
    }

    for (const tag of item.Tags ?? []) {
      const tagId = yield* this.resolveImportTag(tag, manifestId, session);
      yield* this.execute(
        'INSERT OR IGNORE INTO ItemTags (ManifestId, ItemId, TagId, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, ?, ?, 0)',
        [manifestId, item.Id, tagId, toStandardFormat(item.CreatedAt), toStandardFormat(item.UpdatedAt)]
      );
    }
  }

  /**
   * Write a custom field definition, once per import.
   * @param definition - The definition
   * @param manifestId - The manifest to write into
   * @param session - What this import already wrote
   */
  private *insertFieldDefinition(definition: FieldDefinitionEntity, manifestId: string, session: ImportWriteSession): DbOp<void> {
    if (session.writtenDefinitionIds.has(definition.Id)) {
      return;
    }
    session.writtenDefinitionIds.add(definition.Id);
    yield* this.execute(FieldDefinitionQueries.INSERT, [
      definition.Id,
      manifestId,
      definition.FieldType,
      definition.Label,
      definition.IsMultiValue ? 1 : 0,
      definition.IsHidden ? 1 : 0,
      definition.EnableHistory ? 1 : 0,
      definition.Weight,
      definition.ApplicableToTypes,
      toStandardFormat(definition.CreatedAt),
      toStandardFormat(definition.UpdatedAt),
      0,
    ]);
  }

  /**
   * The tag an imported tag is written as: the vault's own tag with the same name when there is one, else a new tag.
   * @param tag - The imported tag
   * @param manifestId - The manifest to write into
   * @param session - What this import already wrote
   * @returns The tag id
   */
  private *resolveImportTag(tag: TagEntity, manifestId: string, session: ImportWriteSession): DbOp<string> {
    const known = session.tagIds.get(tag.Id);
    if (known) {
      return known;
    }

    const existing = (yield* this.query<{ Id: string }>('SELECT Id FROM Tags WHERE ManifestId = ? AND IsDeleted = 0 AND Name = ? COLLATE NOCASE LIMIT 1', [manifestId, tag.Name.trim()]))[0];
    let tagId = existing?.Id;
    if (!tagId) {
      tagId = tag.Id;
      yield* this.execute(
        'INSERT INTO Tags (Id, ManifestId, Name, Color, DisplayOrder, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
        [tagId, manifestId, tag.Name.trim(), tag.Color, tag.DisplayOrder, toStandardFormat(tag.CreatedAt), toStandardFormat(tag.UpdatedAt)]
      );
    }

    session.tagIds.set(tag.Id, tagId);
    return tagId;
  }

  /**
   * Empty the user's own vault: every row of the personal manifest in every item-related table is hard deleted,
   * dependents first. Rows of shared manifests are left alone. Settings and encryption keys are kept.
   */
  public async hardDeleteAllVaultData(): Promise<void> {
    return this.withTransaction(() => this.run(this.deleteAllRows()));
  }

  /**
   * Delete the rows of the reset.
   */
  private *deleteAllRows(): DbOp<void> {
    const personalManifestId = yield* this.personalManifestId();
    if (!personalManifestId) {
      throw new Error('This client has no personal manifest recorded yet; sync once before resetting the vault.');
    }
    for (const table of RESET_TABLES) {
      yield* this.execute(`DELETE FROM ${table} WHERE ManifestId = ?`, [personalManifestId]);
    }
  }
}
