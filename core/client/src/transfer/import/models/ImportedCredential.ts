import type { ImportedAlias } from './ImportedAlias';
import type { ImportedAttachment } from './ImportedAttachment';
import type { ImportedCreditcard } from './ImportedCreditcard';
import type { ImportedCustomField } from './ImportedCustomField';
import type { ImportedPasskey } from './ImportedPasskey';
import type { ItemType } from '@aliasvault/models/vault';

/**
 * A credential in the intermediary import format.
 */
export type ImportedCredential = {
  /** Service name (e.g. "Facebook", "Gmail"). */
  ServiceName?: string | null;
  ServiceUrls?: string[] | null;
  Username?: string | null;
  Password?: string | null;
  Email?: string | null;
  /** 2FA secret key, either bare or as an otpauth:// URI. */
  TwoFactorSecret?: string | null;
  Notes?: string | null;
  CreatedAt?: Date | null;
  UpdatedAt?: Date | null;
  /** Favicon bytes, populated from .avux imports or other sources that provide logo data. */
  FaviconBytes?: Uint8Array | null;
  Alias?: ImportedAlias | null;
  /** Folder path from the source (e.g. "Business" or "Personal/Work"). */
  FolderPath?: string | null;
  /** The item type. If null, defaults to Login or Alias (when alias data is present). */
  ItemType?: ItemType | null;
  Creditcard?: ImportedCreditcard | null;
  Passkeys?: ImportedPasskey[] | null;
  Tags?: string[] | null;
  Attachments?: ImportedAttachment[] | null;
  CustomFieldValues?: ImportedCustomField[] | null;
};
