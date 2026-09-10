import { FieldKey } from '@aliasvault/models/vault';

import type { EmailRoutingPush } from './EmailRoutingPush';
import type { CodecManifest } from '../rust/RustCore';

/**
 * Build the email routing set a push sends to the server from the canonicalized manifests.
 *
 * The push is one entry per (address, manifest) pair: an address carried by several manifests is emitted once per manifest,
 * and the server links the claim to each of them so incoming mail gets one key wrap per linked manifest.
 *
 * @param manifests - every manifest one canonicalize run produced, the user's own included
 * @param privateEmailDomains - domains the server hosts mail for; addresses outside them are not claimed
 * @returns The (address, manifest) pairs to claim, each with its routing state, plus the manifests they were read from
 */
export function buildEmailRouting(manifests: CodecManifest[], privateEmailDomains: string[]): EmailRoutingPush {
  const byPair = new Map<string, { address: string, manifestId: string, paused: boolean }>();

  for (const manifest of manifests) {
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

      const address = typeof fieldValue.Value === 'string' ? fieldValue.Value.trim().toLowerCase() : '';
      const domain = address.split('@')[1];
      if (!domain || !privateEmailDomains.includes(domain)) {
        continue;
      }

      const pairKey = `${address}\0${manifest.manifestId}`;
      const existing = byPair.get(pairKey);
      const paused = Boolean(fieldValue.IsDisabled);
      if (existing) {
        // Several items in one manifest may carry the same address; one of them still wanting mail keeps it routed.
        existing.paused = existing.paused && paused;
      } else {
        byPair.set(pairKey, { address, manifestId: manifest.manifestId, paused });
      }
    }
  }

  return { emailAddressList: [...byPair.values()], coveredManifestIds: manifests.map(manifest => manifest.manifestId) };
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
