import { Platform } from 'react-native';

/**
 * How the mobile app identifies itself to the client core (registered in platform/MobilePlatform.ts). Everything
 * else about the app and its defaults is read from the client core's AppInfo. The version scripts in /scripts
 * update the VERSION line in this file.
 */
export class MobileAppIdentity {
  /**
   * The current mobile app version. This should be updated with each release of the mobile app.
   */
  public static readonly VERSION = '0.31.0-alpha';

  /**
   * The client name to use in the X-AliasVault-Client header.
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
   * Prevent instantiation of this utility class
   */
  private constructor() {}
}
