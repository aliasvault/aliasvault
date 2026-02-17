/**
 * AppInfo class which contains information about the application version
 * and default server URLs.
 */
export class AppInfo {
  /**
   * The current extension version. This should be updated with each release of the extension.
   */
  public static readonly VERSION = '0.27.0-alpha';

  /**
   * The API version to send to the server (base semver without stage suffixes).
   * Apple app store requires semver format without stage suffixes.
   */
  public static readonly API_VERSION = (() : string => {
    return AppInfo.VERSION.split('-')[0];
  })();

  /**
   * The minimum supported AliasVault server (API) version. If the server version is below this, the
   * client will throw an error stating that the server should be updated.
   */
  public static readonly MIN_SERVER_VERSION = '0.12.0-dev';

  /**
   * The client name to use in the X-AliasVault-Client header.
   * Detects the specific browser being used.
   */
  public static readonly CLIENT_NAME = (() : 'chrome' | 'firefox' | 'edge' | 'safari' | 'browser' => {
    // This uses the WXT environment variables to detect the specific browser being used.
    const env = import.meta.env;

    if (env.FIREFOX) {
      return 'firefox';
    }

    if (env.CHROME) {
      return 'chrome';
    }

    if (env.EDGE) {
      return 'edge';
    }

    if (env.SAFARI) {
      return 'safari';
    }

    return 'browser';
  })();

  /**
   * The default AliasVault client URL.
   */
  public static readonly DEFAULT_CLIENT_URL = 'https://app.aliasvault.net';

  /**
   * The default AliasVault web API URL.
   */
  public static readonly DEFAULT_API_URL = 'https://app.aliasvault.net/api';

  /**
   * Prevent instantiation of this utility class
   */
  private constructor() {}

  /**
   * Checks if a given server version is supported
   * @param serverVersion The version to check
   * @returns boolean indicating if the version is supported
   */
  public static isServerVersionSupported(serverVersion: string): boolean {
    return this.versionGreaterThanOrEqualTo(serverVersion, this.MIN_SERVER_VERSION);
  }

  /**
   * Checks if version1 is greater than or equal to version2, following SemVer rules.
   * Pre-release versions (e.g., -alpha, -beta) are considered lower than release versions.
   * @param version1 First version string (e.g., "1.2.3" or "1.2.3-beta")
   * @param version2 Second version string (e.g., "1.2.0" or "1.2.0-alpha")
   * @returns true if version1 >= version2, false otherwise
   */
  public static versionGreaterThanOrEqualTo(version1: string, version2: string): boolean {
    // Split versions into core and pre-release parts
    const [core1, preRelease1] = version1.split('-');
    const [core2, preRelease2] = version2.split('-');

    const parts1 = core1.split('.').map(Number);
    const parts2 = core2.split('.').map(Number);

    // Compare core versions first
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const part1 = parts1[i] ?? 0;
      const part2 = parts2[i] ?? 0;

      if (part1 > part2) {
        return true;
      }
      if (part1 < part2) {
        return false;
      }
    }

    // If core versions are equal, check pre-release versions.
    if (!preRelease1 && preRelease2) {
      return true;
    }
    if (preRelease1 && !preRelease2) {
      return false;
    }
    if (!preRelease1 && !preRelease2) {
      return true;
    }

    // Both have pre-release versions, compare them lexically
    return preRelease1 >= preRelease2;
  }
}
