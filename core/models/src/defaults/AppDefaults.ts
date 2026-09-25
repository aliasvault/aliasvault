/**
 * Single source of truth for the client-wide connection defaults shared by every AliasVault client.
 *
 * This file is distributed by core/models/build.sh (scripts/generate-app-defaults.cjs) to the native platforms:
 *   - `apps/mobile-app/ios/VaultStoreKit/AppInfo.swift` (Swift)
 *   - `apps/mobile-app/android/app/src/main/java/net/aliasvault/app/utils/AppInfo.kt` (Kotlin)
 *
 * The TypeScript clients import the constants directly from `@aliasvault/models/defaults`.
 */

/**
 * The minimum supported AliasVault server (API) version. A client refuses to work against an older server and
 * tells the user to update it. Raise it when a client starts to depend on an endpoint or a response shape that
 * older servers lack.
 */
export const MIN_SERVER_VERSION = '0.12.0-dev';

/** The default AliasVault web client URL. */
export const DEFAULT_CLIENT_URL = 'https://app.aliasvault.com';

/** The default AliasVault web API URL. */
export const DEFAULT_API_URL = 'https://app.aliasvault.com/api';
