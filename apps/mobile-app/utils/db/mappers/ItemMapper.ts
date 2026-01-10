import type { Item, ItemField, ItemTagRef, ItemType } from '@/utils/dist/core/models/vault';

/**
 * Item with optional DeletedAt field for recently deleted items.
 */
export type ItemWithDeletedAt = Item & { DeletedAt?: string };

/**
 * Raw item row from database query.
 */
export type ItemRow = {
  Id: string;
  Name: string;
  ItemType: string;
  FolderId: string | null;
  FolderPath: string | null;
  Logo: Uint8Array | null;
  HasPasskey: number;
  HasAttachment: number;
  HasTotp: number;
  CreatedAt: string;
  UpdatedAt: string;
  DeletedAt?: string | null;
};

/**
 * Raw tag row from database query.
 */
export type TagRow = {
  ItemId: string;
  Id: string;
  Name: string;
  Color: string | null;
};

/**
 * Mapper class for converting database rows to Item objects.
 */
export class ItemMapper {
  /**
   * Map a single database row to an Item object.
   * @param row - Raw item row from database
   * @param fields - Processed fields for this item
   * @param tags - Tags for this item
   * @returns Item object
   */
  public static mapRow(
    row: ItemRow,
    fields: ItemField[] = [],
    tags: ItemTagRef[] = []
  ): Item {
    return {
      Id: row.Id,
      Name: row.Name,
      ItemType: row.ItemType as ItemType,
      Logo: row.Logo ?? undefined,
      FolderId: row.FolderId,
      FolderPath: row.FolderPath || null,
      Tags: tags,
      Fields: fields,
      HasPasskey: row.HasPasskey === 1,
      HasAttachment: row.HasAttachment === 1,
      HasTotp: row.HasTotp === 1,
      CreatedAt: row.CreatedAt,
      UpdatedAt: row.UpdatedAt
    };
  }

  /**
   * Map multiple database rows to Item objects with their fields and tags.
   * @param rows - Raw item rows from database
   * @param fieldsByItem - Map of ItemId to array of fields
   * @param tagsByItem - Map of ItemId to array of tags
   * @returns Array of Item objects
   */
  public static mapRows(
    rows: ItemRow[],
    fieldsByItem: Map<string, ItemField[]>,
    tagsByItem: Map<string, ItemTagRef[]>
  ): Item[] {
    return rows.map(row => this.mapRow(
      row,
      fieldsByItem.get(row.Id) || [],
      tagsByItem.get(row.Id) || []
    ));
  }

  /**
   * Group tag rows by ItemId into a map.
   * @param tagRows - Raw tag rows from database
   * @returns Map of ItemId to array of ItemTagRef
   */
  public static groupTagsByItem(tagRows: TagRow[]): Map<string, ItemTagRef[]> {
    const tagsByItem = new Map<string, ItemTagRef[]>();

    for (const tag of tagRows) {
      if (!tagsByItem.has(tag.ItemId)) {
        tagsByItem.set(tag.ItemId, []);
      }
      tagsByItem.get(tag.ItemId)!.push({
        Id: tag.Id,
        Name: tag.Name,
        Color: tag.Color || undefined
      });
    }

    return tagsByItem;
  }

  /**
   * Map tag rows to ItemTagRef array (for single item).
   * @param tagRows - Raw tag rows without ItemId
   * @returns Array of ItemTagRef
   */
  public static mapTagRows(tagRows: Omit<TagRow, 'ItemId'>[]): ItemTagRef[] {
    return tagRows.map(tag => ({
      Id: tag.Id,
      Name: tag.Name,
      Color: tag.Color || undefined
    }));
  }

  /**
   * Map a single item row for recently deleted items (includes DeletedAt).
   * @param row - Raw item row with DeletedAt
   * @param fields - Processed fields for this item
   * @returns Item object with DeletedAt
   */
  public static mapDeletedItemRow(
    row: ItemRow & { DeletedAt: string },
    fields: ItemField[] = []
  ): ItemWithDeletedAt {
    return {
      Id: row.Id,
      Name: row.Name,
      ItemType: row.ItemType as ItemType,
      Logo: row.Logo ? new Uint8Array(row.Logo) : undefined,
      FolderId: row.FolderId,
      FolderPath: row.FolderPath,
      DeletedAt: row.DeletedAt,
      HasPasskey: row.HasPasskey === 1,
      HasAttachment: row.HasAttachment === 1,
      HasTotp: row.HasTotp === 1,
      Fields: fields,
      CreatedAt: row.CreatedAt,
      UpdatedAt: row.UpdatedAt
    };
  }
}
