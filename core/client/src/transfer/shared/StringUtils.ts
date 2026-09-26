/**
 * Whether a value is null, undefined, empty or whitespace only.
 * @param value - The value
 * @returns True when there is no text
 */
export function isBlank(value: string | null | undefined): value is null | undefined | '' {
  return !value || value.trim().length === 0;
}

/**
 * The value, or null when it is blank.
 * @param value - The value
 * @returns The value, or null
 */
export function nullIfBlank(value: string | null | undefined): string | null {
  return isBlank(value) ? null : value;
}

/**
 * The non-blank values of a list.
 * @param values - The values
 * @returns The values that hold text
 */
export function nonBlank(values: readonly (string | null | undefined)[]): string[] {
  return values.filter((value): value is string => !isBlank(value));
}
