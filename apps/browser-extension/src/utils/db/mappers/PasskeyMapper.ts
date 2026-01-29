import type { Passkey } from '@/utils/dist/core/models/vault';

/**
 * Raw passkey row from database query.
 */
export type PasskeyRow = {
  Id: string;
  ItemId: string;
  RpId: string;
  UserHandle: Uint8Array | null;
  PublicKey: string;
  PrivateKey: string;
  DisplayName: string;
  PrfKey: Uint8Array | null;
  AdditionalData: string | null;
  CreatedAt: string;
  UpdatedAt: string;
  IsDeleted: number;
}

/**
 * Extended passkey row with item information.
 */
export type PasskeyWithItemRow = PasskeyRow & {
  Username?: string | null;
  ServiceName?: string | null;
}

/**
 * Passkey with optional item information.
 */
export type PasskeyWithItem = Passkey & {
  Username?: string | null;
  ServiceName?: string | null;
};

/**
 * Convert a date string to epoch milliseconds.
 * @param dateString - Date string in ISO format
 * @returns Epoch milliseconds
 */
function dateToEpoch(dateString: string): number {
  return new Date(dateString).getTime();
}

/**
 * Mapper class for converting database rows to Passkey objects.
 */
export class PasskeyMapper {
  /**
   * Map a single database row to a Passkey object.
   * @param row - Raw passkey row from database
   * @returns Passkey object
   */
  public static mapRow(row: PasskeyRow): Passkey {
    return {
      Id: row.Id,
      ItemId: row.ItemId,
      RpId: row.RpId,
      UserHandle: row.UserHandle ?? undefined,
      PublicKey: row.PublicKey,
      PrivateKey: row.PrivateKey,
      DisplayName: row.DisplayName,
      PrfKey: row.PrfKey ?? undefined,
      AdditionalData: row.AdditionalData,
      CreatedAt: dateToEpoch(row.CreatedAt),
      UpdatedAt: dateToEpoch(row.UpdatedAt),
      IsDeleted: row.IsDeleted
    };
  }

  /**
   * Map a single database row to a Passkey with item information.
   * @param row - Raw passkey row with item data
   * @returns Passkey with Username and ServiceName
   */
  public static mapRowWithItem(row: PasskeyWithItemRow): PasskeyWithItem {
    return {
      ...this.mapRow(row),
      Username: row.Username,
      ServiceName: row.ServiceName
    };
  }

  /**
   * Map multiple database rows to Passkey objects.
   * @param rows - Raw passkey rows from database
   * @returns Array of Passkey objects
   */
  public static mapRows(rows: PasskeyRow[]): Passkey[] {
    return rows.map(row => this.mapRow(row));
  }

  /**
   * Map multiple database rows to Passkey objects with item information.
   * @param rows - Raw passkey rows with item data
   * @returns Array of Passkey with Username and ServiceName
   */
  public static mapRowsWithItem(rows: PasskeyWithItemRow[]): PasskeyWithItem[] {
    return rows.map(row => this.mapRowWithItem(row));
  }
}
