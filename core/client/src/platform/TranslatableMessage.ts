/**
 * The few user-facing strings the core produces itself. The host resolves each one through its own translation
 * system, so the core carries no translation files and no key naming of any app.
 * TODO: refactor this to use centralized translation system instead (on to-do list) once that is implemented.
 */
export enum TranslatableMessage {
  /** Display name for a shared vault whose name is not known locally. */
  UnnamedSharedVault = 'unnamed-shared-vault',

  /** The local vault is newer than what this client understands; the app must be updated. */
  ClientOutdated = 'client-outdated',

  /** A shared vault's anchor folder cannot be deleted from the folder list. */
  SharedFolderDeleteRefused = 'shared-folder-delete-refused',
}
