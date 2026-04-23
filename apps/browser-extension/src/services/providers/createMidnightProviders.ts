/**
 * Shared factory for constructing the full MidnightProviders object.
 *
 * Used by all services that call findDeployedContract() — avoids duplicating
 * the 6-provider wiring pattern across MidnightContractService, AliasService,
 * BackupWalletService, and RecoveryClaimService.
 *
 * Uses dynamic imports for SDK packages (popup-context compatible) and
 * static imports for local provider files.
 */

import { InMemoryPrivateStateProvider } from './InMemoryPrivateStateProvider';
import { ExtensionZkConfigProvider } from './ExtensionZkConfigProvider';
import { LaceWalletProxy } from './LaceWalletProxy';
import { LaceMidnightProxy } from './LaceMidnightProxy';

/**
 * Create the full set of Midnight providers needed for findDeployedContract().
 *
 * @param indexerUrl - Indexer HTTP endpoint
 * @param wsIndexerUrl - Indexer WebSocket endpoint
 * @param proofServerUrl - Proof server HTTP endpoint
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createMidnightProviders(
  indexerUrl: string,
  wsIndexerUrl: string,
  proofServerUrl: string,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const { indexerPublicDataProvider } = await import(
    '@midnight-ntwrk/midnight-js-indexer-public-data-provider'
  );
  const { httpClientProofProvider } = await import(
    '@midnight-ntwrk/midnight-js-http-client-proof-provider'
  );

  const privateStateProvider = new InMemoryPrivateStateProvider();
  const publicDataProvider = indexerPublicDataProvider(indexerUrl, wsIndexerUrl);
  const zkConfigProvider = new ExtensionZkConfigProvider(fetch.bind(globalThis));
  const proofProvider = httpClientProofProvider(proofServerUrl, zkConfigProvider);
  const walletProvider = new LaceWalletProxy();
  const midnightProvider = new LaceMidnightProxy();

  return {
    privateStateProvider,
    publicDataProvider,
    zkConfigProvider,
    proofProvider,
    walletProvider,
    midnightProvider,
  };
}
