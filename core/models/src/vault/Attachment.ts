/**
 * Attachment SQLite database type.
 */
export type Attachment = {
    Id: string;
    Filename: string;
    Blob: Uint8Array | number[];
    ItemId: string;
    CreatedAt: string;
    UpdatedAt: string;
    IsDeleted?: boolean;
}
