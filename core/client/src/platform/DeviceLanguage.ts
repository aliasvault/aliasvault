/**
 * The device's UI language as a BCP 47 tag, or English when the runtime exposes none.
 */
export function deviceLanguage(): string {
  return globalThis.navigator?.language ?? 'en';
}
