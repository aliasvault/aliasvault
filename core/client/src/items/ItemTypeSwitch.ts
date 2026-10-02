import { fieldAppliesToType, getSystemField } from '@aliasvault/models/vault';

import type { ItemType } from '@aliasvault/models/vault';

/**
 * A field value on an item form: one string, or a list for multi-value fields.
 */
export type FormFieldValue = string | string[];

/**
 * The outcome of switching an item form to another type.
 */
export type ItemTypeSwitchResult<T> = {
  /** The form values for the new type. */
  values: Record<string, T>;
  /** Values set aside because they do not apply to the new type. */
  stash: Record<string, T>;
  /** Keys of the stashed fields that were put back on the form. */
  restored: string[];
};

/**
 * Whether a form value is filled in.
 */
export function hasFormFieldValue(value: FormFieldValue | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  return Array.isArray(value) ? value.some(v => v.trim().length > 0) : value.trim().length > 0;
}

/**
 * Move the form values to another item type: stash what does not apply, put back stashed values that apply again.
 * @param values - The current form values, keyed by field key
 * @param stash - The values stashed by earlier switches on this form
 * @param newType - The type switched to
 * @param hasValue - Whether a value is filled in
 */
export function switchItemTypeFields<T>(values: Record<string, T>, stash: Record<string, T>, newType: ItemType, hasValue: (value: T) => boolean): ItemTypeSwitchResult<T> {
  const nextValues: Record<string, T> = {};
  const nextStash: Record<string, T> = { ...stash };
  const restored: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    const definition = getSystemField(key);
    if (!definition || fieldAppliesToType(definition, newType)) {
      nextValues[key] = value;
    } else if (hasValue(value)) {
      nextStash[key] = value;
    }
  }

  for (const [key, value] of Object.entries(nextStash)) {
    const definition = getSystemField(key);
    if (!definition || !fieldAppliesToType(definition, newType)) {
      continue;
    }
    if (!(key in nextValues) || !hasValue(nextValues[key])) {
      nextValues[key] = value;
      restored.push(key);
    }
    delete nextStash[key];
  }

  return { values: nextValues, stash: nextStash, restored };
}

/**
 * {@link switchItemTypeFields} for forms that keep their values as strings or string lists.
 */
export function switchItemTypeFieldValues(values: Record<string, FormFieldValue>, stash: Record<string, FormFieldValue>, newType: ItemType): ItemTypeSwitchResult<FormFieldValue> {
  return switchItemTypeFields(values, stash, newType, hasFormFieldValue);
}
