import { familySharingText } from '../sharing/FamilySharingView';

import type { Folder } from '../database/repositories/FolderRepository';
import type { EmailClaimTransferRequest, Mailbox } from '@aliasvault/models/webapi';

/**
 * What an item shows when its email alias receives its emails somewhere else than the item's own vault or shared folder.
 */
export type AliasOwnerNotice = {
  /** Where the alias receives its emails now. */
  notice: string;
  /** Whether the user may move the alias to the item's vault or shared folder. */
  canMove: boolean;
  /** The confirmation shown before moving the alias. */
  moveConfirm: string;
};

/**
 * The API surface needed to move an alias, offered by the WebApiService of every host.
 */
type PostApi = {
  post<TRequest, TResponse>(endpoint: string, data: TRequest, parseJson?: boolean): Promise<TResponse>;
};

/**
 * The name of the shared folder a shared manifest is shown as (its root folder carries the manifest id as its id).
 * @param folders - all rendered folders
 * @param manifestId - the shared manifest
 */
function sharedFolderName(folders: Pick<Folder, 'Id' | 'ManifestId' | 'Name'>[], manifestId: string): string {
  const id = manifestId.toLowerCase();
  return folders.find(f => f.Id.toLowerCase() === id && f.ManifestId.toLowerCase() === id)?.Name ?? familySharingText.sharedVault;
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
  mailbox: Pick<Mailbox, 'ownerManifestId' | 'canTransfer'>,
  itemManifestId: string,
  personalManifestId: string | null,
  folders: Pick<Folder, 'Id' | 'ManifestId' | 'Name'>[]
): AliasOwnerNotice | null {
  const owner = mailbox.ownerManifestId?.toLowerCase();
  if (!owner || owner === itemManifestId.toLowerCase()) {
    return null;
  }

  const text = familySharingText.aliasOwner;
  /**
   * Whether the manifest is the user's personal one.
   */
  const isPersonal = (manifestId: string): boolean => manifestId.toLowerCase() === personalManifestId?.toLowerCase();
  return {
    notice: isPersonal(owner) ? text.inPersonalVault : text.inSharedFolder(sharedFolderName(folders, owner)),
    canMove: mailbox.canTransfer,
    moveConfirm: isPersonal(itemManifestId) ? text.moveToPersonalVaultConfirm(email) : text.moveToSharedFolderConfirm(email, sharedFolderName(folders, itemManifestId)),
  };
}

/**
 * The text for an API error about the ownership of an alias, or null when the code is not one of those.
 * @param code - the API error code
 */
export function aliasOwnerErrorText(code: string | null | undefined): string | null {
  switch (code) {
    case 'CLAIM_OWNED_BY_OTHER_VAULT': return familySharingText.errors.aliasOwnedByOtherFolder;
    default: return null;
  }
}

/**
 * Make the item's manifest the owner of the alias, so new mail for it is delivered there.
 * @param webApi - the host's API client
 * @param address - the alias address
 * @param itemManifestId - the manifest of the item showing the alias
 */
export async function moveAliasHere(webApi: PostApi, address: string, itemManifestId: string): Promise<void> {
  await webApi.post<EmailClaimTransferRequest, Response>('Vault/email-claims/transfer', { address, targetManifestId: itemManifestId }, false);
}
