import type { EnvConfig } from '../config/env.js';
import type { AliasLookupService } from '../services/aliasLookup.js';
import type { EmailKeyLookupService } from '../services/emailKeyLookup.js';
import type { EmailEncryptor } from '../services/emailEncryptor.js';
import type { ManifestManager } from '../services/manifestManager.js';
import type { NotificationQueue } from '../services/notificationQueue.js';
import type { IpfsService } from '@aliasvault/ipfs-service';

export interface BridgeContext {
  config: EnvConfig;
  aliasLookup: AliasLookupService;
  emailKeyLookup: EmailKeyLookupService;
  emailEncryptor: EmailEncryptor;
  manifestManager: ManifestManager;
  notificationQueue: NotificationQueue;
  ipfs: IpfsService;
  walletReady: boolean;
  /** Read current inboxManifestCid from a VaultRegistry's public ledger via indexer. */
  readInboxManifestCid: (contractAddress: string) => Promise<string | null>;
  /** Check if the indexer is reachable. Returns true if a basic query succeeds. */
  checkIndexerHealth: () => Promise<boolean>;
}
