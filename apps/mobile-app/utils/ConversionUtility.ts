/**
 * Utility class for conversion operations.
 * TODO: make this a shared utility class in root /core/ folder so we can reuse it between
 * browser extension/mobile app and possibly WASM client.
 */
class ConversionUtility {
  /**
   * Normalize a username by converting it to lowercase and trimming whitespace.
   * @param username The username to normalize.
   * @returns The normalized username.
   */
  public normalizeUsername(username: string): string {
    return username.toLowerCase().trim();
  }
}

export default new ConversionUtility();
