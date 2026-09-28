/**
 * Local storage wrapper.
 */

/**
 * Read a string preference.
 * @param key - the localStorage key
 */
export function getLocalPreference(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Write a string preference.
 * @param key - the localStorage key
 * @param value - the value
 */
export function setLocalPreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode); the preference then simply does not persist.
  }
}

/**
 * Remove a preference.
 * @param key - the localStorage key
 */
export function removeLocalPreference(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // See setLocalPreference.
  }
}

/**
 * Read a JSON preference.
 * @param key - the localStorage key
 */
export function getLocalPreferenceJson<T>(key: string): T | null {
  const raw = getLocalPreference(key);
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Write a JSON preference.
 * @param key - the localStorage key
 * @param value - the value
 */
export function setLocalPreferenceJson(key: string, value: unknown): void {
  setLocalPreference(key, JSON.stringify(value));
}
