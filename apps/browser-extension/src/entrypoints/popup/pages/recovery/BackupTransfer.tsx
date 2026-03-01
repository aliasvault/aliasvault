import React, { useState } from 'react';
import { bytesToHex, hexToBytes, isValidHex, formatTimeRemaining } from '@/utils/hex';

/**
 * Backup Transfer page.
 * Allows a backup wallet holder to execute an ownership transfer
 * if their backup wallet has matured (registered >= 72 hours ago).
 *
 * Flow:
 * 1. User enters the VaultRegistry contract address
 * 2. User enters their backup key (hex)
 * 3. System checks if backup wallet is registered and mature
 * 4. User enters new owner commitment (hex)
 * 5. Execute backupTransfer on contract
 * 6. Success confirmation
 */

type PageState =
  | 'identify'     // Enter contract address + backup key
  | 'verifying'    // Checking backup wallet status
  | 'verified'     // Backup wallet found and mature — ready to transfer
  | 'not-mature'   // Backup wallet found but not mature
  | 'not-found'    // Backup wallet not registered
  | 'transfer'     // Entering new owner commitment
  | 'executing'    // Calling contract
  | 'success'      // Transfer complete
  | 'error';       // Error state

const BackupTransfer: React.FC = () => {
  const [pageState, setPageState] = useState<PageState>('identify');
  const [contractAddress, setContractAddress] = useState('');
  const [backupKeyHex, setBackupKeyHex] = useState('');
  const [newOwnerCommitmentHex, setNewOwnerCommitmentHex] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);

  const handleVerify = async () => {
    if (!contractAddress) {
      setError('Contract address is required');
      return;
    }
    if (!isValidHex(backupKeyHex, 64)) {
      setError('Backup key must be a 64-character hex string (32 bytes)');
      return;
    }

    setPageState('verifying');
    setError(null);

    try {
      const { getBackupWalletStatus, computeBackupCommitment } = await import('@/services/BackupWalletService');

      const backupKey = hexToBytes(backupKeyHex);
      const commitment = await computeBackupCommitment(backupKey);
      const commitmentHex = bytesToHex(commitment);

      const wallets = await getBackupWalletStatus(contractAddress);
      const myWallet = wallets.find(
        (w) => bytesToHex(w.commitment) === commitmentHex,
      );

      if (!myWallet) {
        setPageState('not-found');
        return;
      }

      if (myWallet.matured) {
        setPageState('verified');
      } else {
        setTimeRemaining(myWallet.timeRemaining);
        setPageState('not-mature');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
      setPageState('error');
    }
  };

  const handleTransfer = async () => {
    if (!isValidHex(newOwnerCommitmentHex, 64)) {
      setError('New owner commitment must be a 64-character hex string (32 bytes)');
      return;
    }

    setPageState('executing');
    setError(null);

    try {
      const { executeBackupTransfer } = await import('@/services/BackupWalletService');
      const backupKey = hexToBytes(backupKeyHex);
      const newOwnerCommitment = hexToBytes(newOwnerCommitmentHex);

      await executeBackupTransfer(contractAddress, backupKey, newOwnerCommitment);
      setPageState('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer failed');
      setPageState('error');
    }
  };

  return (
    <div className="space-y-4 p-4">
      {/* Step 1: Identify */}
      {(pageState === 'identify' || pageState === 'verifying') && (
        <section>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
              Backup Transfer
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Enter the VaultRegistry contract address and your backup key to check eligibility.
            </p>
            <div className="space-y-3">
              <input
                type="text"
                value={contractAddress}
                onChange={(e) => setContractAddress(e.target.value)}
                placeholder="VaultRegistry contract address"
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <input
                type="text"
                value={backupKeyHex}
                onChange={(e) => setBackupKeyHex(e.target.value)}
                placeholder="Backup key (64 hex chars)"
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-mono text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                maxLength={64}
              />
              <button
                onClick={handleVerify}
                disabled={pageState === 'verifying'}
                className="w-full px-4 py-2 bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white rounded-md text-sm transition-colors"
              >
                {pageState === 'verifying' ? 'Verifying...' : 'Verify Eligibility'}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Not Found */}
      {pageState === 'not-found' && (
        <section>
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <h3 className="text-sm font-medium text-red-900 dark:text-red-200 mb-1">
              Backup Wallet Not Found
            </h3>
            <p className="text-xs text-red-700 dark:text-red-300 mb-3">
              Your backup key does not match any registered backup wallet for this contract.
            </p>
            <button
              onClick={() => setPageState('identify')}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white rounded-md text-sm transition-colors"
            >
              Try Again
            </button>
          </div>
        </section>
      )}

      {/* Not Mature */}
      {pageState === 'not-mature' && (
        <section>
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <h3 className="text-sm font-medium text-yellow-900 dark:text-yellow-200 mb-1">
              Backup Wallet Not Yet Mature
            </h3>
            <p className="text-xs text-yellow-700 dark:text-yellow-300 mb-3">
              Your backup wallet is registered but the 72-hour maturation period has not elapsed.
              {timeRemaining > 0 && ` ${formatTimeRemaining(timeRemaining)}.`}
            </p>
            <button
              onClick={() => setPageState('identify')}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white rounded-md text-sm transition-colors"
            >
              Back
            </button>
          </div>
        </section>
      )}

      {/* Verified — Ready to Transfer */}
      {(pageState === 'verified' || pageState === 'executing') && (
        <section>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
            <div className="flex items-center mb-3">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 mr-2">
                Eligible
              </span>
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                Execute Backup Transfer
              </h3>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Enter the new owner commitment to transfer vault ownership. This action is irreversible.
            </p>
            <div className="space-y-3">
              <input
                type="text"
                value={newOwnerCommitmentHex}
                onChange={(e) => setNewOwnerCommitmentHex(e.target.value)}
                placeholder="New owner commitment (64 hex chars)"
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-mono text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                maxLength={64}
              />
              <button
                onClick={handleTransfer}
                disabled={pageState === 'executing' || !newOwnerCommitmentHex}
                className="w-full px-4 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-md text-sm transition-colors"
              >
                {pageState === 'executing' ? 'Transferring...' : 'Transfer Ownership'}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Success */}
      {pageState === 'success' && (
        <section>
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
            <h3 className="text-sm font-medium text-green-900 dark:text-green-200 mb-1">
              Ownership Transferred
            </h3>
            <p className="text-xs text-green-700 dark:text-green-300">
              Vault ownership has been transferred to the new owner. All backup wallets and recovery
              state have been cleared. You are now the new owner.
            </p>
          </div>
        </section>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          {pageState === 'error' && (
            <button
              onClick={() => { setPageState('identify'); setError(null); }}
              className="mt-2 px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white rounded-md text-sm transition-colors"
            >
              Try Again
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default BackupTransfer;
