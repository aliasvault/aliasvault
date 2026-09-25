/**
 * @aliasvault/client: Typescript AliasVault client core.
 *
 * Services are imported from their subpath (`@aliasvault/client/sync/VaultSyncEngine`). This root only exposes the
 * platform contract a host app registers at startup.
 */
export * from './platform/index';
