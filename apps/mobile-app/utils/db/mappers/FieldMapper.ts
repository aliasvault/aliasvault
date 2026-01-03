import type { ItemField, FieldType } from '@/utils/dist/core/models/vault';
import { FieldTypes, getSystemField } from '@/utils/dist/core/models/vault';

/**
 * Raw field row from database query.
 */
export type FieldRow = {
  ItemId: string;
  FieldKey: string | null;
  FieldDefinitionId: string | null;
  CustomLabel: string | null;
  CustomFieldType: string | null;
  CustomIsHidden: number | null;
  CustomEnableHistory: number | null;
  Value: string;
  DisplayOrder: number;
};

/**
 * Intermediate field representation before grouping.
 */
export type ProcessedField = {
  ItemId: string;
  FieldKey: string;
  Label: string;
  FieldType: string;
  IsHidden: number;
  Value: string;
  DisplayOrder: number;
  IsCustomField: boolean;
  EnableHistory: boolean;
};

/**
 * Mapper class for processing database field rows into ItemField objects.
 * Handles both system fields (with FieldKey) and custom fields (with FieldDefinitionId).
 */
export class FieldMapper {
  /**
   * Process raw field rows from database into a map of ItemId -> ItemField[].
   * Handles system vs custom fields and multi-value field grouping.
   * @param rows - Raw field rows from database
   * @returns Map of ItemId to array of ItemField objects
   */
  public static processFieldRows(rows: FieldRow[]): Map<string, ItemField[]> {
    // First, convert rows to processed fields with proper metadata
    const processedFields = rows.map(row => this.processFieldRow(row));

    // Group by ItemId and FieldKey (to handle multi-value fields)
    const fieldsByItem = new Map<string, ItemField[]>();
    const fieldValuesByKey = new Map<string, string[]>();

    for (const field of processedFields) {
      const key = `${field.ItemId}_${field.FieldKey}`;

      // Accumulate values for the same field
      if (!fieldValuesByKey.has(key)) {
        fieldValuesByKey.set(key, []);
      }
      fieldValuesByKey.get(key)!.push(field.Value);

      // Create ItemField entry only once per unique FieldKey per item
      if (!fieldsByItem.has(field.ItemId)) {
        fieldsByItem.set(field.ItemId, []);
      }

      const itemFields = fieldsByItem.get(field.ItemId)!;
      const existingField = itemFields.find(f => f.FieldKey === field.FieldKey);

      if (!existingField) {
        itemFields.push({
          FieldKey: field.FieldKey,
          Label: field.Label,
          FieldType: field.FieldType as FieldType,
          Value: '', // Will be set below
          IsHidden: field.IsHidden === 1,
          DisplayOrder: field.DisplayOrder,
          IsCustomField: field.IsCustomField,
          EnableHistory: field.EnableHistory
        });
      }
    }

    // Set Values (single value or array for multi-value fields)
    for (const [itemId, fields] of fieldsByItem) {
      for (const field of fields) {
        const key = `${itemId}_${field.FieldKey}`;
        const values = fieldValuesByKey.get(key) || [];

        if (values.length === 1) {
          field.Value = values[0];
        } else {
          field.Value = values;
        }
      }
    }

    return fieldsByItem;
  }

  /**
   * Process a single field row to extract proper metadata.
   * System fields use FieldKey and get metadata from SystemFieldRegistry.
   * Custom fields use FieldDefinitionId and get metadata from the row.
   * @param row - Raw field row
   * @returns Processed field with proper metadata
   */
  private static processFieldRow(row: FieldRow): ProcessedField {
    if (row.FieldKey) {
      // System field: has FieldKey, get metadata from SystemFieldRegistry
      const systemField = getSystemField(row.FieldKey);
      return {
        ItemId: row.ItemId,
        FieldKey: row.FieldKey,
        Label: row.FieldKey, // Use FieldKey as label; UI layer translates via fieldLabels.*
        FieldType: systemField?.FieldType || FieldTypes.Text,
        IsHidden: systemField?.IsHidden ? 1 : 0,
        Value: row.Value,
        DisplayOrder: row.DisplayOrder,
        IsCustomField: false,
        EnableHistory: systemField?.EnableHistory ?? false
      };
    } else {
      // Custom field: has FieldDefinitionId, get metadata from FieldDefinitions
      return {
        ItemId: row.ItemId,
        FieldKey: row.FieldDefinitionId || '', // Use FieldDefinitionId (UUID) as the key for custom fields
        Label: row.CustomLabel || '',
        FieldType: row.CustomFieldType || FieldTypes.Text,
        IsHidden: row.CustomIsHidden || 0,
        Value: row.Value,
        DisplayOrder: row.DisplayOrder,
        IsCustomField: true,
        EnableHistory: row.CustomEnableHistory === 1
      };
    }
  }

  /**
   * Process field rows for a single item (without ItemId in result).
   * Used when fetching a single item by ID.
   * @param rows - Raw field rows for a single item
   * @returns Array of ItemField objects
   */
  public static processFieldRowsForSingleItem(rows: Omit<FieldRow, 'ItemId'>[]): ItemField[] {
    const fieldValuesByKey = new Map<string, string[]>();
    const uniqueFields = new Map<string, {
      FieldKey: string;
      Label: string;
      FieldType: string;
      IsHidden: number;
      DisplayOrder: number;
      IsCustomField: boolean;
      EnableHistory: boolean;
    }>();

    for (const row of rows) {
      const fieldKey = row.FieldKey || row.FieldDefinitionId || '';

      // Accumulate values
      if (!fieldValuesByKey.has(fieldKey)) {
        fieldValuesByKey.set(fieldKey, []);
      }
      fieldValuesByKey.get(fieldKey)!.push(row.Value);

      // Store field metadata (only once per FieldKey)
      if (!uniqueFields.has(fieldKey)) {
        if (row.FieldKey) {
          // System field
          const systemField = getSystemField(row.FieldKey);
          uniqueFields.set(fieldKey, {
            FieldKey: row.FieldKey,
            Label: row.FieldKey, // Use FieldKey as label; UI layer translates via fieldLabels.*
            FieldType: systemField?.FieldType || FieldTypes.Text,
            IsHidden: systemField?.IsHidden ? 1 : 0,
            DisplayOrder: row.DisplayOrder,
            IsCustomField: false,
            EnableHistory: systemField?.EnableHistory ?? false
          });
        } else {
          // Custom field
          uniqueFields.set(fieldKey, {
            FieldKey: fieldKey,
            Label: row.CustomLabel || '',
            FieldType: row.CustomFieldType || FieldTypes.Text,
            IsHidden: row.CustomIsHidden || 0,
            DisplayOrder: row.DisplayOrder,
            IsCustomField: true,
            EnableHistory: row.CustomEnableHistory === 1
          });
        }
      }
    }

    // Build fields array with proper single/multi values
    return Array.from(uniqueFields.entries()).map(([fieldKey, metadata]) => {
      const values = fieldValuesByKey.get(fieldKey) || [];
      return {
        ...metadata,
        FieldType: metadata.FieldType as FieldType,
        Value: values.length === 1 ? values[0] : values,
        IsHidden: metadata.IsHidden === 1,
        IsCustomField: metadata.IsCustomField,
        EnableHistory: metadata.EnableHistory
      };
    });
  }
}
