import { sharingText } from '../sharing/SharingView';

import type { Folder } from '../database/repositories/FolderRepository';
import type { EmailClaimTransfer } from '../sync/VaultSyncEngine';
import type { Mailbox } from '@aliasvault/models/webapi';

/**
 * What an item shows when its email alias receives its emails somewhere else than the item's own vault or shared folder.
 */
export type AliasOwnerNotice = {
  /** Where the alias receives its emails now. */
  notice: string;
  /** The move to the item's vault or shared folder, or null when the user may not move the alias. */
  transfer: EmailClaimTransfer | null;
  /** The confirmation shown before moving the alias. */
  moveConfirm: string;
};

/**
 * The name of the shared folder a shared manifest is shown as (its root folder carries the manifest id as its id).
 * @param folders - all rendered folders
 * @param manifestId - the shared manifest
 */
function sharedFolderName(folders: Pick<Folder, 'Id' | 'ManifestId' | 'Name'>[], manifestId: string): string {
  const id = manifestId.toLowerCase();
  return folders.find(f => f.Id.toLowerCase() === id && f.ManifestId.toLowerCase() === id)?.Name ?? sharingText.sharedVault;
}

/**
 * The notice for an item in `itemManifestId` whose alias is owned elsewhere, or null when it is owned by the item's own manifest.
 * @param email - the alias address
 * @param mailbox - the mailbox response of the alias
 * @param itemManifestId - the manifest of the item showing the alias
 * @param personalManifestId - the user's personal manifest
 * @param folders - all rendered folders, to name shared folders
 */
export function aliasOwnerNotice(
  email: string,
  mailbox: Pick<Mailbox, 'ownerManifestId' | 'canTransfer' | 'claimVersion'>,
  itemManifestId: string,
  personalManifestId: string | null,
  folders: Pick<Folder, 'Id' | 'ManifestId' | 'Name'>[]
): AliasOwnerNotice | null {
  const owner = mailbox.ownerManifestId;
  if (!owner || owner.toLowerCase() === itemManifestId.toLowerCase()) {
    return null;
  }

  const text = sharingText.aliasOwner;
  /**
   * Whether the manifest is the user's personal one.
   */
  const isPersonal = (manifestId: string): boolean => manifestId.toLowerCase() === personalManifestId?.toLowerCase();
  return {
    notice: isPersonal(owner) ? text.inPersonalVault : text.inSharedFolder(sharedFolderName(folders, owner)),
    transfer: mailbox.canTransfer && mailbox.claimVersion !== null ? { address: email, sourceManifestId: owner, manifestId: itemManifestId, claimVersion: mailbox.claimVersion } : null,
    moveConfirm: isPersonal(itemManifestId) ? text.moveToPersonalVaultConfirm(email) : text.moveToSharedFolderConfirm(email, sharedFolderName(folders, itemManifestId)),
  };
}

/**
 * The text for an API error about the ownership of an alias, or null when the code is not one of those.
 * @param code - the API error code
 */
export function aliasOwnerErrorText(code: string | null | undefined): string | null {
  switch (code) {
    case 'CLAIM_OWNED_BY_OTHER_VAULT': return sharingText.errors.aliasOwnedByOtherFolder;
    default: return null;
  }
}

