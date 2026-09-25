import { tryGetPlatform } from './ClientPlatform';

/**
 * The device's UI language as a BCP 47 tag: what the host reports, else the runtime's, else English.
 */
export function deviceLanguage(): string {
  return tryGetPlatform()?.deviceLanguage?.() ?? globalThis.navigator?.language ?? 'en';
}
