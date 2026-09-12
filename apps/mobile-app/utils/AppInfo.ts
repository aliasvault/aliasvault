import { Platform } from 'react-native';

import { DEFAULT_API_URL, DEFAULT_CLIENT_URL } from '@aliasvault/models/defaults';

/**
 * AppInfo class which contains information about the application version
 * and default server URLs.
 */
export class AppInfo {
  /**
   * The current mobile app version. This should be updated with each release of the mobile app.
   */
  public static readonly VERSION = '0.31.0-alpha';

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
   * The default AliasVault client URL (shared by every client, see AppDefaults in the models package).
   */
  public static readonly DEFAULT_CLIENT_URL = DEFAULT_CLIENT_URL;

  /**
   * The default AliasVault web API URL (shared by every client, see AppDefaults in the models package).
   */
  public static readonly DEFAULT_API_URL = DEFAULT_API_URL;

  /**
   * Prevent instantiation of this utility class
   */
  private constructor() {}
}
