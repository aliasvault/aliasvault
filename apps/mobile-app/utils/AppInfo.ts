import { Platform } from 'react-native';

/**
 * AppInfo class which contains information about the application version
 * and default server URLs.
 */
export class AppInfo {
  /**
   * The current mobile app version. This should be updated with each release of the mobile app.
   */
  public static readonly VERSION = '0.27.0';

  /**
   * The API version to send to the server (base semver without stage suffixes).
   * Apple app store requires semver format without stage suffixes.
   */
  public static readonly API_VERSION = (() => {
    return AppInfo.VERSION.split('-')[0];
  })();

  /**
   * The client name to use in the X-AliasVault-Client header.
   * Detects the specific browser being used.
   */
  public static readonly CLIENT_NAME = (() : 'ios' | 'android' | 'app' => {
    const os = Platform.OS;

    if (os === 'ios') {
      return 'ios';
    }

    if (os === 'android') {
      return 'android';
    }

    return 'app';
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
}
