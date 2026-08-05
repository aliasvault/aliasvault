import { FieldKey } from '@/utils/dist/core/models/vault';
import type { CodecManifest } from '@/utils/RustCore';
import type { EmailRoutingPush } from '@/utils/types/EmailRoutingPush';

/**
 * Build the email routing set a push sends to the server from the canonicalized manifests.
 *
 * Which manifest an alias belongs to decides how its mail is encrypted. Every row has already been 
 * routed into the manifest that owns it by the codec, so an address found in a shared manifest is a 
 * shared alias and everything left in the root manifest is personal.
 *
 * @param rootManifest - the canonicalized root manifest
 * @param sharedManifests - the shared manifests produced by the same canonicalize run
 * @param privateEmailDomains - domains the server hosts mail for; addresses outside them are not claimed
 * @returns The addresses to claim, split into personal and shared-manifest ones
 */
export function buildEmailRouting(rootManifest: CodecManifest, sharedManifests: CodecManifest[], privateEmailDomains: string[]): EmailRoutingPush {
  const manifestIdByAddress = new Map<string, string | null>();

  /**
   * Record every claimable address one manifest carries against that manifest.
   * @param manifest - the manifest to read the items and their login-email fields from
   * @param manifestId - the manifest's id, or null for the root manifest (its addresses stay personal)
   */
  const collect = (manifest: CodecManifest, manifestId: string | null): void => {
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

      if (manifestId !== null || !manifestIdByAddress.has(address)) {
        manifestIdByAddress.set(address, manifestId);
      }
    }
  };

  collect(rootManifest, null);
  for (const manifest of sharedManifests) {
    collect(manifest, manifest.manifestId);
  }

  const routing: EmailRoutingPush = { emailAddressList: [], sharedEmailAddressList: [] };
  for (const [address, manifestId] of manifestIdByAddress) {
    if (manifestId) {
      routing.sharedEmailAddressList.push({ address, manifestId });
    } else {
      routing.emailAddressList.push(address);
    }
  }

  return routing;
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
