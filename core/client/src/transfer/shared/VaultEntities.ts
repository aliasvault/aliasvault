import type { ItemType } from '@aliasvault/models/vault';

/**
 * An item with its child fields, as the export reads it and as the import produces it.
 */
export type ItemEntity = {
  Id: string;
  Name: string | null;
  ItemType: ItemType;
  FolderId: string | null;
  LogoId: string | null;
  CreatedAt: Date;
  UpdatedAt: Date;
  IsDeleted: boolean;
  FieldValues: FieldValueEntity[];
  Attachments: AttachmentEntity[];
  TotpCodes: TotpCodeEntity[];
  Passkeys: PasskeyEntity[];
};

/**
 * A field value: a system field (FieldKey set) or a custom field (FieldDefinitionId set).
 */
export type FieldValueEntity = {
  Id: string;
  ItemId: string;
  FieldKey: string | null;
  FieldDefinitionId: string | null;
  /** The definition of a custom field, carried along so the import can recreate it. */
  FieldDefinition?: FieldDefinitionEntity | null;
  Value: string | null;
  Weight: number;
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
  ItemId: string;
  RpId: string;
  UserHandle: Uint8Array | null;
  PublicKey: string;
  PrivateKey: string;
  PrfKey: Uint8Array | null;
  DisplayName: string;
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
  Source: string;
  FileData: Uint8Array | null;
  MimeType: string | null;
  FetchedAt: Date | null;
  IsDeleted: boolean;
};
