/**
 * The few user-facing strings the core produces itself. The host resolves each one through its own translation
 * system, so the core carries no translation files and no key naming of any app.
 * TODO: refactor this to use centralized translation system instead (on to-do list) once that is implemented.
 */
export enum TranslatableMessage {
  /** The local vault is newer than what this client understands; the app must be updated. */
  ClientOutdated = 'client-outdated',

  /** The vault still has to walk the sqlite-blob upgrade chain before the manifest migration can run. */
  VaultUpgradeRequired = 'vault-upgrade-required',
}
