import type { ItemType, LogoKind } from '@aliasvault/models/vault';

/**
 * An item with its child fields, as the export reads it and as the import produces it.
 */
export type ItemEntity = {
  Id: string;
  Name: string | null;
  ItemType: ItemType;
  FolderId: string | null;
  ArchivedAt: Date | null;
  CreatedAt: Date;
  UpdatedAt: Date;
  IsDeleted: boolean;
  FieldValues: FieldValueEntity[];
  FieldHistories: FieldHistoryEntity[];
  Attachments: AttachmentEntity[];
  TotpCodes: TotpCodeEntity[];
  Passkeys: PasskeyEntity[];
  /** The item's logo, null when it has none. */
  Logo: LogoEntity | null;
  Tags?: TagEntity[];
};

/**
 * A field value: a system field (FieldKey set) or a custom field (FieldDefinitionId set).
 */
export type FieldValueEntity = {
  Id: string;
  ItemId: string;
  FieldKey: string | null;
  FieldDefinitionId: string | null;
  FieldDefinition?: FieldDefinitionEntity | null;
  Value: string | null;
  Weight: number;
  CreatedAt: Date;
  UpdatedAt: Date;
  IsDeleted: boolean;
};

/**
 * A previous value of a field: a system field (FieldKey set) or a custom field (FieldDefinitionId set).
 */
export type FieldHistoryEntity = {
  Id: string;
  ItemId: string;
  FieldKey: string | null;
  FieldDefinitionId: string | null;
  FieldDefinition?: FieldDefinitionEntity | null;
  ValueSnapshot: string;
  ChangedAt: Date;
  CreatedAt: Date;
  UpdatedAt: Date;
  IsDeleted: boolean;
};

/**
 * A custom field definition.
 */
export type FieldDefinitionEntity = {
  Id: string;
  FieldType: string;
  Label: string;
  IsMultiValue: boolean;
  IsHidden: boolean;
  EnableHistory: boolean;
  Weight: number;
  ApplicableToTypes: string | null;
  CreatedAt: Date;
  UpdatedAt: Date;
  IsDeleted: boolean;
};

/**
 * A TOTP code.
 */
export type TotpCodeEntity = {
  Id: string;
  ItemId: string;
  Name: string;
  SecretKey: string;
  Algorithm: string;
  Digits: number;
  Period: number;
  CreatedAt: Date;
  UpdatedAt: Date;
  IsDeleted: boolean;
};

/**
 * A passkey.
 */
export type PasskeyEntity = {
  Id: string;
  CredentialId: Uint8Array | null;
  ItemId: string;
  RpId: string;
  UserHandle: Uint8Array | null;
  PublicKey: string;
  PrivateKey: string;
  PrfKey: Uint8Array | null;
  DisplayName: string;
  AdditionalData: Uint8Array | null;
  CreatedAt: Date;
  UpdatedAt: Date;
  IsDeleted: boolean;
};

/**
 * An attachment.
 */
export type AttachmentEntity = {
  Id: string;
  ItemId: string;
  Filename: string;
  Blob: Uint8Array;
  CreatedAt: Date;
  UpdatedAt: Date;
  IsDeleted: boolean;
};

/**
 * A folder.
 */
export type FolderEntity = {
  Id: string;
  Name: string;
  ParentFolderId: string | null;
  Weight: number;
  CreatedAt: Date;
  UpdatedAt: Date;
  IsDeleted: boolean;
};

/**
 * A tag.
 */
export type TagEntity = {
  Id: string;
  Name: string;
  Color: string | null;
  DisplayOrder: number;
  CreatedAt: Date;
  UpdatedAt: Date;
  IsDeleted: boolean;
};

/**
 * An item-tag association.
 */
export type ItemTagEntity = {
  ItemId: string;
  TagId: string;
  IsDeleted: boolean;
};

/**
 * A logo (favicon, built-in or uploaded image).
 */
export type LogoEntity = {
  Id: string;
  Kind: LogoKind;
  Source: string;
  Name: string | null;
  FileData: Uint8Array | null;
  MimeType: string | null;
  FetchedAt: Date | null;
  IsDeleted: boolean;
};
