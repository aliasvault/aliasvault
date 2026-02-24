import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { WalletProvider, useWallet } from '../context/WalletContext';
import { WalletConnect } from '../components/WalletConnect';
import { RecoveryDetails } from '../components/RecoveryDetails';
import { ApprovalButton } from '../components/ApprovalButton';
import { fetchRecoveryMetadata } from '../services/ipfsService';
import { loadGuardianKeys, getGuardianKeyBytes } from '../services/guardianKeyService';
import {
  joinContract,
  getContractState,
  isGuardian,
  hasApproved,
  approveRecovery,
  GUARDIAN_THRESHOLD,
  type ContractHandle,
} from '../services/midnightService';
import { getNetworkConfig } from '../config/networkConfig';
import { bytesToHex, hexToUint8Array } from '@aliasvault/vault-sync';
import type { RecoveryMetadata, GuardianKeys } from '../types/recovery';

type PageState =
  | { step: 'loading' }
  | { step: 'error'; message: string }
  | { step: 'metadata-loaded'; metadata: RecoveryMetadata }
  | { step: 'no-keys'; metadata: RecoveryMetadata }
  | { step: 'joining'; metadata: RecoveryMetadata }
  | { step: 'not-guardian'; metadata: RecoveryMetadata }
  | { step: 'ready'; metadata: RecoveryMetadata; handle: ContractHandle; keys: GuardianKeys; approvalCount: number; isApproved: boolean; owner: Uint8Array; recoveryInitiatedAt: bigint; recoveryComplete: boolean };

function ApprovalContent() {
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
      const approved = hasApproved(handle, commitment);

      setState({
        step: 'ready',
        metadata,
        handle,
        keys,
        approvalCount: contractState.approvalCount,
        isApproved: approved,
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
        <h1>Approve Recovery</h1>
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
        <p>Contact the vault owner to add you as a guardian, or complete <Link to={`/setup/${state.metadata.contractAddress}`}>setup</Link> and share your commitment.</p>
      </div>
    );
  }

  // state.step === 'ready'
  const { metadata, handle, keys, isApproved, approvalCount, owner, recoveryInitiatedAt, recoveryComplete } = state;

  const isRecoveryActive = recoveryInitiatedAt > 0n && !recoveryComplete;

  let disabledReason: string | undefined;
  if (isApproved) disabledReason = 'You have already approved this recovery';
  else if (!isRecoveryActive) disabledReason = recoveryComplete ? 'Recovery already completed' : 'No active recovery request';

  async function handleApprove() {
    await approveRecovery(handle);
    const freshState = getContractState(handle);
    const commitment = hexToUint8Array(keys.commitment);
    const freshApproved = hasApproved(handle, commitment);
    setState((prev) => {
      if (prev.step !== 'ready') return prev;
      return {
        ...prev,
        approvalCount: freshState.approvalCount,
        isApproved: freshApproved,
        owner: freshState.owner,
        recoveryInitiatedAt: freshState.recoveryInitiatedAt,
        recoveryComplete: freshState.recoveryComplete,
      };
    });
  }

  return (
    <div>
      <h1>Approve Recovery</h1>
      <WalletConnect networkId={metadata.networkId} />

      <RecoveryDetails
        ownerCommitment={bytesToHex(owner)}
        recoveryInitiatedAt={recoveryInitiatedAt}
        approvalCount={approvalCount}
        threshold={GUARDIAN_THRESHOLD}
        recoveryComplete={recoveryComplete}
        hasCurrentGuardianApproved={isApproved}
      />

      <ApprovalButton
        onApprove={handleApprove}
        disabled={!!disabledReason}
        disabledReason={disabledReason}
      />
    </div>
  );
}

export function ApprovalPage() {
  return (
    <WalletProvider>
      <ApprovalContent />
    </WalletProvider>
  );
}
