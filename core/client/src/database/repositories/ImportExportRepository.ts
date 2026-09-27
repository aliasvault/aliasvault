import { LogoKinds, type ItemType } from '@aliasvault/models/vault';

import { fromStandardFormat, toStandardFormat } from '../../utilities/DateFormatter';
import { BaseRepository } from '../BaseRepository';
import { scopedKey } from '../ItemRef';
import { AttachmentQueries, FieldDefinitionQueries, FieldValueQueries, ItemQueries, TotpCodeQueries } from '../queries/ItemQueries';
import { PasskeyQueries } from '../queries/PasskeyQueries';

import type { AttachmentEntity, FieldDefinitionEntity, FieldValueEntity, FolderEntity, ItemEntity, ItemTagEntity, LogoEntity, PasskeyEntity, TagEntity, TotpCodeEntity } from '../../transfer/shared/VaultEntities';
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
  logos: LogoEntity[];
};

/** A row of a manifest-scoped child table, with the key of the item it hangs off. */
type ChildRow = { ItemId: string; ManifestId: string };

/** The tables a vault reset empties, dependents first. */
const RESET_TABLES = ['Attachments', 'FieldValues', 'FieldHistories', 'TotpCodes', 'Passkeys', 'ItemTags', 'FieldDefinitions', 'Tags', 'Items', 'Logos', 'Folders'];

/**
 * Repository for the import/export feature: reads whole item graphs for an export and writes imported item graphs
 * with their original timestamps, which the regular item repository does not allow.
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
   * Read every live item with its child rows, plus the folders, tags, custom field definitions and the logos the
   * items use. Trashed items are left out, archived items are included.
   * @returns The vault data
   */
  public *getExportData(): DbOp<VaultExportData> {
    const itemRows = yield* this.query<{ Id: string; ManifestId: string; Name: string | null; ItemType: string; FolderId: string | null; LogoId: string | null; CreatedAt: string; UpdatedAt: string }>(
      'SELECT Id, ManifestId, Name, ItemType, FolderId, LogoId, CreatedAt, UpdatedAt FROM Items WHERE IsDeleted = 0 AND DeletedAt IS NULL ORDER BY CreatedAt'
    );

    const fieldDefinitionRows = yield* this.query<{ Id: string; ManifestId: string; FieldType: string; Label: string; IsMultiValue: number; IsHidden: number; EnableHistory: number; Weight: number; ApplicableToTypes: string | null; CreatedAt: string; UpdatedAt: string }>(
      'SELECT Id, ManifestId, FieldType, Label, IsMultiValue, IsHidden, EnableHistory, Weight, ApplicableToTypes, CreatedAt, UpdatedAt FROM FieldDefinitions WHERE IsDeleted = 0'
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
      'SELECT fv.Id, fv.ItemId, fv.ManifestId, fv.FieldKey, fv.FieldDefinitionId, fv.Value, fv.Weight, fv.CreatedAt, fv.UpdatedAt FROM FieldValues fv INNER JOIN Items i ON i.Id = fv.ItemId AND i.ManifestId = fv.ManifestId WHERE fv.IsDeleted = 0 AND i.IsDeleted = 0 AND i.DeletedAt IS NULL ORDER BY fv.Weight'
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

    const attachmentRows = yield* this.query<ChildRow & { Id: string; Filename: string; Blob: Uint8Array | null; CreatedAt: string; UpdatedAt: string }>(
      'SELECT a.Id, a.ItemId, a.ManifestId, a.Filename, a.Blob, a.CreatedAt, a.UpdatedAt FROM Attachments a INNER JOIN Items i ON i.Id = a.ItemId AND i.ManifestId = a.ManifestId WHERE a.IsDeleted = 0 AND i.IsDeleted = 0 AND i.DeletedAt IS NULL'
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
      'SELECT t.Id, t.ItemId, t.ManifestId, t.Name, t.SecretKey, t.Algorithm, t.Digits, t.Period, t.CreatedAt, t.UpdatedAt FROM TotpCodes t INNER JOIN Items i ON i.Id = t.ItemId AND i.ManifestId = t.ManifestId WHERE t.IsDeleted = 0 AND i.IsDeleted = 0 AND i.DeletedAt IS NULL'
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

    const passkeyRows = yield* this.query<ChildRow & { Id: string; RpId: string; UserHandle: Uint8Array | null; PublicKey: string; PrivateKey: string; PrfKey: Uint8Array | null; DisplayName: string; CreatedAt: string; UpdatedAt: string }>(
      'SELECT p.Id, p.ItemId, p.ManifestId, p.RpId, p.UserHandle, p.PublicKey, p.PrivateKey, p.PrfKey, p.DisplayName, p.CreatedAt, p.UpdatedAt FROM Passkeys p INNER JOIN Items i ON i.Id = p.ItemId AND i.ManifestId = p.ManifestId WHERE p.IsDeleted = 0 AND i.IsDeleted = 0 AND i.DeletedAt IS NULL'
    );
    const passkeysByItem = ImportExportRepository.groupByItem(passkeyRows, (row): PasskeyEntity => ({
      Id: row.Id,
      ItemId: row.ItemId,
      RpId: row.RpId,
      UserHandle: row.UserHandle ? new Uint8Array(row.UserHandle) : null,
      PublicKey: row.PublicKey,
      PrivateKey: row.PrivateKey,
      PrfKey: row.PrfKey ? new Uint8Array(row.PrfKey) : null,
      DisplayName: row.DisplayName ?? '',
      CreatedAt: fromStandardFormat(row.CreatedAt),
      UpdatedAt: fromStandardFormat(row.UpdatedAt),
      IsDeleted: false,
    }));

    const items = itemRows.map((row): ItemEntity => {
      const key = scopedKey(row.ManifestId, row.Id);
      return {
        Id: row.Id,
        Name: row.Name,
        ItemType: row.ItemType as ItemType,
        FolderId: row.FolderId,
        LogoId: row.LogoId,
        CreatedAt: fromStandardFormat(row.CreatedAt),
        UpdatedAt: fromStandardFormat(row.UpdatedAt),
        IsDeleted: false,
        FieldValues: fieldValuesByItem.get(key) ?? [],
        Attachments: attachmentsByItem.get(key) ?? [],
        TotpCodes: totpCodesByItem.get(key) ?? [],
        Passkeys: passkeysByItem.get(key) ?? [],
      };
    });

    const folderRows = yield* this.query<{ Id: string; Name: string; ParentFolderId: string | null; Weight: number; CreatedAt: string; UpdatedAt: string }>(
      'SELECT Id, Name, ParentFolderId, Weight, CreatedAt, UpdatedAt FROM Folders WHERE IsDeleted = 0'
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
      'SELECT Id, Name, Color, DisplayOrder, CreatedAt, UpdatedAt FROM Tags WHERE IsDeleted = 0'
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

    const itemTagRows = yield* this.query<{ ItemId: string; TagId: string }>('SELECT ItemId, TagId FROM ItemTags WHERE IsDeleted = 0');
    const itemTags = itemTagRows.map((row): ItemTagEntity => ({ ItemId: row.ItemId, TagId: row.TagId, IsDeleted: false }));

    // Only the logos the exported items point at.
    const logoIds = new Set(items.map(item => item.LogoId).filter((id): id is string => id !== null));
    const logoRows = yield* this.query<{ Id: string; Source: string; FileData: Uint8Array | null; MimeType: string | null; UpdatedAt: string }>(
      'SELECT Id, Source, FileData, MimeType, UpdatedAt FROM Logos WHERE IsDeleted = 0'
    );
    const logos = logoRows.filter(row => logoIds.has(row.Id)).map((row): LogoEntity => ({
      Id: row.Id,
      Source: row.Source,
      FileData: row.FileData ? new Uint8Array(row.FileData) : null,
      MimeType: row.MimeType,
      FetchedAt: fromStandardFormat(row.UpdatedAt),
      IsDeleted: false,
    }));

    return { items, folders, tags, itemTags, fieldDefinitions, logos };
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
   * Insert an imported item with its field values, custom field definitions, TOTP codes, passkeys and
   * attachments, keeping the timestamps the source export carried.
   * @param item - The item graph to insert
   */
  public async insertImportedItem(item: ItemEntity): Promise<void> {
    return this.withTransaction(() => this.run(this.insertItemGraph(item)));
  }

  /**
   * Write one item graph.
   * @param item - The item graph
   */
  private *insertItemGraph(item: ItemEntity): DbOp<void> {
    const manifestId = yield* this.writeManifestId();
    const createdAt = toStandardFormat(item.CreatedAt);
    const updatedAt = toStandardFormat(item.UpdatedAt);

    yield* this.execute(ItemQueries.INSERT_ITEM, [
      item.Id,
      item.Name,
      item.ItemType,
      item.LogoId,
      item.FolderId,
      // Second bind of the folder id, then the manifest an item outside any folder joins (see INSERT_ITEM).
      item.FolderId,
      manifestId,
      createdAt,
      updatedAt,
      0,
    ]);

    // Custom field definitions come before the values that reference them; each is written once.
    const writtenDefinitions = new Set<string>();
    for (const fieldValue of item.FieldValues) {
      const definition = fieldValue.FieldDefinition;
      if (definition && !writtenDefinitions.has(definition.Id)) {
        writtenDefinitions.add(definition.Id);
        yield* this.execute(FieldDefinitionQueries.INSERT, [
          definition.Id,
          item.Id,
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

      yield* this.execute(FieldValueQueries.INSERT, [
        fieldValue.Id,
        item.Id,
        item.Id,
        manifestId,
        fieldValue.FieldDefinitionId,
        fieldValue.FieldKey,
        fieldValue.Value ?? '',
        fieldValue.Weight,
        toStandardFormat(fieldValue.CreatedAt),
        toStandardFormat(fieldValue.UpdatedAt),
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
        item.Id,
        manifestId,
        toStandardFormat(totpCode.CreatedAt),
        toStandardFormat(totpCode.UpdatedAt),
        0,
      ]);
    }

    for (const passkey of item.Passkeys) {
      yield* this.execute(PasskeyQueries.INSERT, [
        passkey.Id,
        item.Id,
        item.Id,
        manifestId,
        passkey.RpId,
        passkey.UserHandle,
        passkey.PublicKey,
        passkey.PrivateKey,
        passkey.PrfKey,
        passkey.DisplayName,
        null,
        toStandardFormat(passkey.CreatedAt),
        toStandardFormat(passkey.UpdatedAt),
        0,
      ]);
    }

    for (const attachment of item.Attachments) {
      yield* this.execute(AttachmentQueries.INSERT, [
        attachment.Id,
        attachment.Filename,
        attachment.Blob,
        item.Id,
        item.Id,
        manifestId,
        toStandardFormat(attachment.CreatedAt),
        toStandardFormat(attachment.UpdatedAt),
        0,
      ]);
    }
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
    for (const table of RESET_TABLES) {
      if (personalManifestId) {
        yield* this.execute(`DELETE FROM ${table} WHERE ManifestId = ?`, [personalManifestId]);
      } else {
        yield* this.execute(`DELETE FROM ${table}`);
      }
    }
  }
}
