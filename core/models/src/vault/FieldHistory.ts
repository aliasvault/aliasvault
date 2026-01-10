/**
 * Field history record tracking changes to field values over time.
 * Used for fields that have EnableHistory=true (e.g., passwords).
 */
export type FieldHistory = {
    /** Unique identifier for this history record */
    Id: string;
    /** ID of the item this history belongs to */
    ItemId: string;
    /** Field key (e.g., 'login.password') */
    FieldKey: string;
    /** Snapshot of the field value(s) at this point in time */
    ValueSnapshot: string;
    /** When this change occurred */
    ChangedAt: string;
    /** When this history record was created */
    CreatedAt: string;
    /** When this history record was last updated */
    UpdatedAt: string;
}

/**
 * Maximum number of history records to keep per field.
 * Older records beyond this limit should be automatically pruned.
 */
export const MAX_FIELD_HISTORY_RECORDS = 10;
