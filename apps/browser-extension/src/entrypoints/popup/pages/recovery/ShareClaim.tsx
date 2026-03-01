import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  fetchOnChainRecoveryKeyHash,
  fetchSharePackageFromIpfs,
  executeRecoveryClaim,
  callClaimRecoveryOnChain,
  getRecoveryState,
  validateImportedShare,
} from '@/services/RecoveryClaimService';
import type { RecoveryState } from '@/services/RecoveryClaimService';

/** Derived from validateImportedShare return type — single source of truth via ADR-003 */
type RecoveryShareFile = Awaited<ReturnType<typeof validateImportedShare>>;

const AUTO_CLEAR_SECONDS = 60;

type WizardStep =
  | { step: 'status-check' }
  | { step: 'status-loaded'; state: RecoveryState }
  | { step: 'import-shares'; state: RecoveryState }
  | { step: 'recovering' }
  | { step: 'display'; masterPassword: string }
  | { step: 'finalizing' }
  | { step: 'complete' }
  | { step: 'error'; message: string; recoverable?: boolean };

interface ShareClaimProps {
  /** GuardianRecovery contract address */
  guardianContractAddress?: string;
  /** VaultRegistry contract address (for recoveryKeyHash) */
  vaultRegistryAddress?: string;
  /** IPFS gateway domain */
  pinataGateway?: string;
  /** CID of the share package on IPFS */
  sharesCid?: string;
  /** Owner's secret key (for on-chain claim) — null if not yet available */
  secretKey?: Uint8Array | null;
}

const ShareClaim: React.FC<ShareClaimProps> = ({
  guardianContractAddress,
  vaultRegistryAddress,
  pinataGateway,
  sharesCid,
  secretKey,
}) => {
  const [wizardState, setWizardState] = useState<WizardStep>({ step: 'status-check' });
  const [shareFiles, setShareFiles] = useState<RecoveryShareFile[]>([]);
  const [shareInput, setShareInput] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [countdown, setCountdown] = useState(AUTO_CLEAR_SECONDS);
  const passwordRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Step 1: Check recovery status on mount
  useEffect(() => {
    if (!guardianContractAddress || !sharesCid) {
      setWizardState({
        step: 'error',
        message: 'Missing required parameters. Navigate to this page from the recovery initiation flow.',
      });
      return;
    }
    let cancelled = false;
    getRecoveryState(guardianContractAddress)
      .then((state) => {
        if (cancelled) return;
        if (!state) {
          setWizardState({ step: 'error', message: 'Contract not found' });
          return;
        }
        setWizardState({ step: 'status-loaded', state });
      })
      .catch((err) => {
        if (!cancelled) {
          setWizardState({
            step: 'error',
            message: err instanceof Error ? err.message : 'Failed to read contract state',
          });
        }
      });
    return () => { cancelled = true; };
  }, [guardianContractAddress, sharesCid]);

  // Auto-clear timer for password display
  useEffect(() => {
    if (wizardState.step !== 'display') return;
    setCountdown(AUTO_CLEAR_SECONDS);

    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          // Clear password
          passwordRef.current = null;
          setWizardState({ step: 'error', message: 'Password auto-cleared for security', recoverable: false });
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [wizardState.step]);

  // Clean up password on unmount
  useEffect(() => {
    return () => {
      passwordRef.current = null;
    };
  }, []);

  const handleImportShare = useCallback(async () => {
    setImportError(null);
    try {
      const parsed: unknown = JSON.parse(shareInput);
      const validated = await validateImportedShare(parsed);

      // Check for duplicate share index
      if (shareFiles.some((s) => s.shareIndex === validated.shareIndex)) {
        setImportError(`Share with index ${validated.shareIndex} already imported`);
        return;
      }

      setShareFiles((prev) => [...prev, validated]);
      setShareInput('');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Invalid share file JSON');
    }
  }, [shareInput, shareFiles]);

  const handleRemoveShare = useCallback((index: number) => {
    setShareFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleRecover = useCallback(async () => {
    if (!sharesCid || !pinataGateway || !vaultRegistryAddress) {
      setWizardState({ step: 'error', message: 'Missing recovery configuration' });
      return;
    }
    setWizardState({ step: 'recovering' });

    try {
      // Fetch IPFS share package
      const sharePackage = await fetchSharePackageFromIpfs(
        sharesCid,
        pinataGateway,
      );

      // Read on-chain recovery key hash
      const onChainHash = await fetchOnChainRecoveryKeyHash(vaultRegistryAddress);
      if (!onChainHash) {
        setWizardState({
          step: 'error',
          message: 'Recovery key hash not found on VaultRegistry',
          recoverable: true,
        });
        return;
      }

      // Execute off-chain claim
      const result = await executeRecoveryClaim(
        shareFiles,
        sharePackage,
        onChainHash,
      );

      passwordRef.current = result.masterPassword;
      setWizardState({ step: 'display', masterPassword: result.masterPassword });
    } catch (err) {
      setWizardState({
        step: 'error',
        message: err instanceof Error ? err.message : 'Recovery failed',
        recoverable: true,
      });
    }
  }, [shareFiles, sharesCid, pinataGateway, vaultRegistryAddress]);

  const handleCopyPassword = useCallback(() => {
    if (passwordRef.current) {
      navigator.clipboard.writeText(passwordRef.current).catch(() => {});
    }
  }, []);

  const handleFinalize = useCallback(async () => {
    if (!secretKey) {
      setWizardState({
        step: 'error',
        message: 'Secret key not available. Unlock your vault first to call on-chain claimRecovery.',
        recoverable: false,
      });
      return;
    }

    setWizardState({ step: 'finalizing' });

    try {
      await callClaimRecoveryOnChain(guardianContractAddress!, secretKey);
      passwordRef.current = null;
      if (timerRef.current) clearInterval(timerRef.current);
      setWizardState({ step: 'complete' });
    } catch (err) {
      setWizardState({
        step: 'error',
        message: err instanceof Error ? err.message : 'On-chain claim failed',
        recoverable: false,
      });
    }
  }, [guardianContractAddress, secretKey]);

  // --- Render ---

  if (wizardState.step === 'status-check') {
    return <p data-testid="loading">Loading recovery status...</p>;
  }

  if (wizardState.step === 'error') {
    return (
      <div data-testid="error" className="p-4">
        <h2 className="text-lg font-semibold text-red-600">Error</h2>
        <p className="mt-2 text-sm">{wizardState.message}</p>
      </div>
    );
  }

  if (wizardState.step === 'status-loaded') {
    const { state } = wizardState;
    const hasEnoughApprovals = state.approvalCount >= 2;
    const isActive = state.recoveryInitiatedAt > 0n;

    return (
      <div data-testid="status-check" className="p-4">
        <h2 className="text-lg font-semibold">Recovery Status</h2>
        <div className="mt-3 space-y-2 text-sm">
          <p>Recovery active: <strong>{isActive ? 'Yes' : 'No'}</strong></p>
          <p>Approvals: <strong>{state.approvalCount}/2</strong></p>
          <p>Already completed: <strong>{state.recoveryComplete ? 'Yes' : 'No'}</strong></p>
        </div>

        {state.recoveryComplete && (
          <p className="mt-3 text-red-600 text-sm">Recovery already completed. Deploy a new GuardianRecovery instance for future recovery.</p>
        )}

        {!isActive && !state.recoveryComplete && (
          <p className="mt-3 text-yellow-600 text-sm">No active recovery. Initiate recovery first.</p>
        )}

        {isActive && hasEnoughApprovals && !state.recoveryComplete && (
          <button
            data-testid="proceed-button"
            onClick={() => setWizardState({ step: 'import-shares', state })}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded"
          >
            Proceed to Share Import
          </button>
        )}

        {isActive && !hasEnoughApprovals && (
          <p className="mt-3 text-yellow-600 text-sm">Waiting for more guardian approvals ({state.approvalCount}/2).</p>
        )}
      </div>
    );
  }

  if (wizardState.step === 'import-shares') {
    return (
      <div data-testid="import-shares" className="p-4">
        <h2 className="text-lg font-semibold">Import Guardian Shares</h2>
        <p className="mt-2 text-sm text-gray-600">
          Paste or upload 2 or more RecoveryShareFile JSON from your guardians.
        </p>

        <div className="mt-3">
          <textarea
            data-testid="share-input"
            value={shareInput}
            onChange={(e) => setShareInput(e.target.value)}
            placeholder='{"version":1,"shareIndex":0,"shareHex":"..."}'
            className="w-full h-24 p-2 border rounded text-xs font-mono"
          />
          <button
            data-testid="add-share-button"
            onClick={handleImportShare}
            className="mt-2 px-3 py-1 bg-blue-600 text-white rounded text-sm"
          >
            Add Share
          </button>
          {importError && (
            <p data-testid="import-error" className="mt-1 text-red-600 text-xs">{importError}</p>
          )}
        </div>

        {shareFiles.length > 0 && (
          <div className="mt-3">
            <h3 className="text-sm font-medium">Imported Shares ({shareFiles.length})</h3>
            <ul className="mt-1 space-y-1">
              {shareFiles.map((sf, i) => (
                <li key={sf.shareIndex} className="flex items-center justify-between text-xs bg-gray-50 dark:bg-gray-800 p-2 rounded">
                  <span data-testid={`share-item-${sf.shareIndex}`}>
                    Share #{sf.shareIndex}
                  </span>
                  <button
                    data-testid={`remove-share-${sf.shareIndex}`}
                    onClick={() => handleRemoveShare(i)}
                    className="text-red-500 text-xs"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {shareFiles.length >= 2 && (
          <button
            data-testid="recover-button"
            onClick={handleRecover}
            className="mt-4 px-4 py-2 bg-green-600 text-white rounded"
          >
            Recover Password
          </button>
        )}
      </div>
    );
  }

  if (wizardState.step === 'recovering') {
    return <p data-testid="recovering">Recovering master password...</p>;
  }

  if (wizardState.step === 'display') {
    return (
      <div data-testid="display-password" className="p-4">
        <h2 className="text-lg font-semibold text-green-600">Password Recovered</h2>

        <div className="mt-3">
          <div className="relative">
            <input
              data-testid="password-field"
              type={revealed ? 'text' : 'password'}
              value={wizardState.masterPassword}
              readOnly
              className="w-full p-2 pr-20 border rounded font-mono text-sm"
            />
            <button
              data-testid="reveal-button"
              onClick={() => setRevealed((prev) => !prev)}
              className="absolute right-12 top-1/2 -translate-y-1/2 text-xs text-blue-600"
            >
              {revealed ? 'Hide' : 'Show'}
            </button>
            <button
              data-testid="copy-password-button"
              onClick={handleCopyPassword}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-blue-600"
            >
              Copy
            </button>
          </div>
        </div>

        <p data-testid="auto-clear-warning" className="mt-2 text-sm text-yellow-600">
          This password will be cleared from memory in {countdown} seconds.
        </p>

        <div className="mt-4 border-t pt-4">
          <button
            data-testid="finalize-button"
            onClick={handleFinalize}
            className="px-4 py-2 bg-red-600 text-white rounded"
          >
            Complete Recovery (On-Chain)
          </button>
          <p className="mt-1 text-xs text-gray-500">
            Sets recoveryComplete = true (terminal state). Deploy a new GuardianRecovery instance for future recovery.
          </p>
        </div>
      </div>
    );
  }

  if (wizardState.step === 'finalizing') {
    return <p data-testid="finalizing">Calling claimRecovery on contract...</p>;
  }

  // wizardState.step === 'complete'
  return (
    <div data-testid="complete" className="p-4">
      <h2 className="text-lg font-semibold text-green-600">Recovery Complete</h2>
      <p className="mt-2 text-sm">
        Your contract is now in terminal state. Deploy a new GuardianRecovery instance for future recovery.
      </p>
    </div>
  );
};

export default ShareClaim;
