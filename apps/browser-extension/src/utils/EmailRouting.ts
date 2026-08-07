import { FieldKey } from '@/utils/dist/core/models/vault';
import type { CodecManifest } from '@/utils/RustCore';
import type { EmailRoutingPush } from '@/utils/types/EmailRoutingPush';

/**
 * Build the email routing set a push sends to the server from the canonicalized manifests.
 *
 * Which manifest an alias belongs to decides how its mail is encrypted. Every row has already been 
 * routed into the manifest that owns it by the codec, so an address found in a shared manifest is a 
 * shared alias and everything in the user's own manifest is personal.
 *
 * @param manifests - every manifest one canonicalize run produced, the user's own included
 * @param personalManifestId - the id of the user's own manifest; its addresses stay personal
 * @param privateEmailDomains - domains the server hosts mail for; addresses outside them are not claimed
 * @returns The addresses to claim, each against the manifest that owns it
 */
export function buildEmailRouting(manifests: CodecManifest[], personalManifestId: string, privateEmailDomains: string[]): EmailRoutingPush {
  const manifestIdByAddress = new Map<string, string>();

  /**
   * Record every claimable address one manifest carries against that manifest.
   * @param manifest - the manifest to read the items and their login-email fields from
   * @param manifestId - the manifest's id
   */
  const collect = (manifest: CodecManifest, manifestId: string): void => {
    const liveItemIds = new Set(
      rowsOf(manifest, 'Items').filter(row => !row.IsDeleted && row.DeletedAt == null).map(row => String(row.Id))
    );

    for (const fieldValue of rowsOf(manifest, 'FieldValues')) {
      if (fieldValue.FieldKey !== FieldKey.LoginEmail || fieldValue.IsDeleted) {
        continue;
      }
      if (!liveItemIds.has(String(fieldValue.ItemId))) {
        continue;
      }

      const address = typeof fieldValue.Value === 'string' ? fieldValue.Value : '';
      const domain = address.split('@')[1];
      if (!domain || !privateEmailDomains.includes(domain)) {
        continue;
      }

      // A shared manifest always wins the address; the personal manifest only claims one nothing else has.
      if (manifestId !== personalManifestId || !manifestIdByAddress.has(address)) {
        manifestIdByAddress.set(address, manifestId);
      }
    }
  };

  /**
   * Whether a manifest is the user's own.
   * @param manifest - the manifest to test
   * @returns True when it is the manifest this vault is written from
   */
  const isOwn = (manifest: CodecManifest): boolean => manifest.manifestId === personalManifestId;

  /*
   * The user's own manifest first: an address it also carries stays personal only while no shared manifest
   * claims it, and `collect` lets a later shared claim override that (but never the reverse).
   */
  for (const manifest of [...manifests].sort((a, b) => Number(isOwn(b)) - Number(isOwn(a)))) {
    collect(manifest, manifest.manifestId);
  }

  return { emailAddressList: [...manifestIdByAddress].map(([address, manifestId]) => ({ address, manifestId })) };
}

/**
 * The rows of one manifest table, or an empty list when the manifest does not carry that table.
 * @param manifest - the manifest to read from
 * @param table - the table name
 * @returns The table's rows
 */
function rowsOf(manifest: CodecManifest, table: string): Array<Record<string, unknown>> {
  return manifest.tables[table] ?? [];
}
