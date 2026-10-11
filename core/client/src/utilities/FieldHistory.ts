/**
 * Field history value helpers.
 */

/**
 * The values in a `FieldHistories.ValueSnapshot`: a JSON list of strings, or the raw snapshot when it is not one.
 * @param snapshot - the stored snapshot
 * @returns The snapshot's values
 */
export function parseValueSnapshot(snapshot: string): string[] {
  try {
    const parsed: unknown = JSON.parse(snapshot);
    if (Array.isArray(parsed)) {
      return parsed.filter(value => value !== null && value !== undefined).map(String);
    }
    return typeof parsed === 'string' ? [parsed] : [snapshot];
  } catch {
    return [snapshot];
  }
}

/**
 * Whether a history snapshot holds exactly the given field value.
 * @param snapshot - the stored snapshot
 * @param value - the current field value
 * @returns True when both hold the same values in the same order
 */
export function snapshotEqualsValue(snapshot: string, value: string | string[] | null | undefined): boolean {
  const snapshotValues = withoutEmpty(parseValueSnapshot(snapshot));
  const currentValues = withoutEmpty(Array.isArray(value) ? value : [value]);
  return snapshotValues.length === currentValues.length && snapshotValues.every((entry, index) => entry === currentValues[index]);
}

/**
 * The previous values of a field: its history (newest first) without the newest record when that holds the current value.
 * @param records - the field's history records, newest first
 * @param value - the current field value
 * @returns The records to show as history
 */
export function previousFieldValues<T extends { ValueSnapshot: string }>(records: ReadonlyArray<T>, value: string | string[] | null | undefined): T[] {
  return records.length > 0 && snapshotEqualsValue(records[0].ValueSnapshot, value) ? records.slice(1) : [...records];
}

/**
 * The values that are not empty or whitespace-only.
 * @param values - the values to filter
 * @returns The non-empty values
 */
function withoutEmpty(values: ReadonlyArray<string | null | undefined>): string[] {
  return values.filter((value): value is string => typeof value === 'string' && value.trim() !== '');
}
