import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { WalletProvider, useWallet } from '../context/WalletContext';
import { WalletConnect } from '../components/WalletConnect';
import { RecoveryDetails } from '../components/RecoveryDetails';
import { fetchRecoveryMetadata } from '../services/ipfsService';
import { loadGuardianKeys, getGuardianKeyBytes } from '../services/guardianKeyService';
import {
  joinContract,
  getContractState,
  isGuardian,
  GUARDIAN_THRESHOLD,
  type ContractHandle,
} from '../services/midnightService';
import {
  fetchSharePackage,
  findGuardianShareIndex,
  decryptGuardianShare,
  canReleaseShare,
} from '../services/shareReleaseService';
import { getNetworkConfig } from '../config/networkConfig';
import { bytesToHex, hexToUint8Array } from '@aliasvault/vault-sync';
import type { RecoveryMetadata, GuardianKeys } from '../types/recovery';
import type { RecoveryShareFile } from '@aliasvault/vault-sync';

type PageState =
  | { step: 'loading' }
  | { step: 'error'; message: string }
  | { step: 'metadata-loaded'; metadata: RecoveryMetadata }
  | { step: 'no-keys'; metadata: RecoveryMetadata }
  | { step: 'joining'; metadata: RecoveryMetadata }
  | { step: 'not-guardian'; metadata: RecoveryMetadata }
  | {
      step: 'ready';
      metadata: RecoveryMetadata;
      handle: ContractHandle;
      keys: GuardianKeys;
      approvalCount: number;
      owner: Uint8Array;
      recoveryInitiatedAt: bigint;
      recoveryComplete: boolean;
    }
  | { step: 'releasing'; metadata: RecoveryMetadata }
  | { step: 'released'; metadata: RecoveryMetadata; shareFile: RecoveryShareFile };

function ReleaseShareContent() {
  const { cid } = useParams<{ cid: string }>();
  const { isConnected } = useWallet();
  const [state, setState] = useState<PageState>({ step: 'loading' });

  // Fetch metadata on mount
  useEffect(() => {
    if (!cid) {
      setState({ step: 'error', message: 'Missing CID in URL' });
      return;
    }
    let cancelled = false;
    fetchRecoveryMetadata(cid)
      .then((metadata) => {
        if (!cancelled) setState({ step: 'metadata-loaded', metadata });
      })
      .catch((err) => {
        if (!cancelled) setState({ step: 'error', message: err instanceof Error ? err.message : 'Failed to fetch metadata' });
      });
    return () => { cancelled = true; };
  }, [cid]);

  // After wallet connects + metadata loaded, load keys and join contract
  const joinAndVerify = useCallback(async (metadata: RecoveryMetadata) => {
    const keys = loadGuardianKeys(metadata.contractAddress);
    if (!keys) {
      setState({ step: 'no-keys', metadata });
      return;
    }

    setState({ step: 'joining', metadata });

    try {
      const config = getNetworkConfig(metadata.networkId);
      const guardianKeyBytes = getGuardianKeyBytes(keys);
      const handle = await joinContract(metadata.contractAddress, guardianKeyBytes, config);

      const commitment = hexToUint8Array(keys.commitment);
      if (!isGuardian(handle, commitment)) {
        setState({ step: 'not-guardian', metadata });
        return;
      }

      const contractState = getContractState(handle);

      setState({
        step: 'ready',
        metadata,
        handle,
        keys,
        approvalCount: contractState.approvalCount,
        owner: contractState.owner,
        recoveryInitiatedAt: contractState.recoveryInitiatedAt,
        recoveryComplete: contractState.recoveryComplete,
      });
    } catch (err) {
      setState({
        step: 'error',
        message: err instanceof Error ? err.message : 'Failed to join contract',
      });
    }
  }, []);

  const metadataForJoin = state.step === 'metadata-loaded' ? state.metadata : null;

  useEffect(() => {
    if (isConnected && metadataForJoin) {
      joinAndVerify(metadataForJoin);
    }
  }, [isConnected, metadataForJoin, joinAndVerify]);

  // Handle share release
  async function handleRelease() {
    if (state.step !== 'ready') return;
    const { metadata, keys } = state;

    if (!metadata.sharesCid) {
      setState({ step: 'error', message: 'Recovery metadata missing sharesCid' });
      return;
    }

    setState({ step: 'releasing', metadata });

    try {
      const sharePackage = await fetchSharePackage(metadata.sharesCid);
      const shareIndex = await findGuardianShareIndex(sharePackage, keys.rsaPrivateKey);
      const shareFile = await decryptGuardianShare(sharePackage, shareIndex, keys.rsaPrivateKey);
      setState({ step: 'released', metadata, shareFile });
    } catch (err) {
      setState({
        step: 'error',
        message: err instanceof Error ? err.message : 'Failed to release share',
      });
    }
  }

  function handleCopy(shareFile: RecoveryShareFile) {
    navigator.clipboard.writeText(JSON.stringify(shareFile, null, 2)).catch(() => {});
  }

  function handleDownload(shareFile: RecoveryShareFile) {
    const json = JSON.stringify(shareFile, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recovery-share-${shareFile.shareIndex}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (state.step === 'loading') {
    return <p data-testid="loading">Loading recovery request...</p>;
  }

  if (state.step === 'error') {
    return (
      <div data-testid="error">
        <h2>Error</h2>
        <p>{state.message}</p>
      </div>
    );
  }

  if (state.step === 'metadata-loaded') {
    return (
      <div>
        <h1>Release Share</h1>
        <p>Recovery request for contract: <code>{state.metadata.contractAddress}</code></p>
        <WalletConnect networkId={state.metadata.networkId} />
        {!isConnected && <p>Connect your wallet to continue.</p>}
      </div>
    );
  }

  if (state.step === 'no-keys') {
    return (
      <div data-testid="no-keys">
        <h2>Guardian Keys Not Found</h2>
        <p>No guardian keys found for contract <code>{state.metadata.contractAddress}</code>.</p>
        <p>Please complete the <Link to={`/setup/${state.metadata.contractAddress}`}>guardian setup</Link> first.</p>
      </div>
    );
  }

  if (state.step === 'joining') {
    return <p data-testid="joining">Connecting to contract...</p>;
  }

  if (state.step === 'not-guardian') {
    return (
      <div data-testid="not-guardian">
        <h2>Not a Registered Guardian</h2>
        <p>Your guardian commitment is not registered on this contract.</p>
      </div>
    );
  }

  if (state.step === 'releasing') {
    return <p data-testid="releasing">Decrypting your share...</p>;
  }

  if (state.step === 'released') {
    const { shareFile } = state;
    return (
      <div data-testid="released">
        <h1>Share Released</h1>
        <p>Your share has been decrypted successfully. Send this file to the vault owner via a secure channel.</p>
        <pre data-testid="share-json">{JSON.stringify(shareFile, null, 2)}</pre>
        <button data-testid="copy-button" onClick={() => handleCopy(shareFile)}>
          Copy to Clipboard
        </button>
        <button data-testid="download-button" onClick={() => handleDownload(shareFile)}>
          Download as File
        </button>
      </div>
    );
  }

  // state.step === 'ready'
  const { metadata, approvalCount, owner, recoveryInitiatedAt, recoveryComplete } = state;

  const releaseCheck = canReleaseShare(
    recoveryInitiatedAt,
    approvalCount,
    GUARDIAN_THRESHOLD,
    recoveryComplete,
  );

  return (
    <div>
      <h1>Release Share</h1>
      <WalletConnect networkId={metadata.networkId} />

      <RecoveryDetails
        ownerCommitment={bytesToHex(owner)}
        recoveryInitiatedAt={recoveryInitiatedAt}
        approvalCount={approvalCount}
        threshold={GUARDIAN_THRESHOLD}
        recoveryComplete={recoveryComplete}
        hasCurrentGuardianApproved={true}
      />

      {releaseCheck.canRelease ? (
        <button data-testid="release-button" onClick={handleRelease}>
          Release My Share
        </button>
      ) : (
        <div data-testid="cannot-release">
          <p>{releaseCheck.reason}</p>
        </div>
      )}
    </div>
  );
}

export function ReleaseSharePage() {
  return (
    <WalletProvider>
      <ReleaseShareContent />
    </WalletProvider>
  );
}
