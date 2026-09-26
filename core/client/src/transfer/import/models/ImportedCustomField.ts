import type { FieldType } from '@aliasvault/models/vault';

/**
 * A single custom (user-defined) field value with the metadata of its field definition.
 */
export type ImportedCustomField = {
  DefinitionId: string;
  Label: string;
  Value?: string | null;
  FieldType: FieldType;
  IsMultiValue: boolean;
  IsHidden: boolean;
  EnableHistory: boolean;
  /** Display order weight of the field definition (custom field ordering in the UI). */
  Weight: number;
  /** Display order weight of this individual value (ordering within a multi-value field). */
  ValueWeight: number;
  /** The applicable item types as a JSON array (e.g. '["Login","Identity"]'); null means all types. */
  ApplicableToTypes?: string | null;
};
