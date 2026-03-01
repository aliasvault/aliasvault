import React, { useState, useCallback } from 'react';
import { VaultCidStore } from '@/services/VaultCidStore';
import { bytesToHex, hexToBytes, isValidHex, truncateHex, formatTimeRemaining } from '@/utils/hex';

/**
 * Backup Wallets settings page.
 * Allows the vault owner to:
 * - View registered backup wallets with maturation status
 * - Add new backup wallets (by entering a hex backup key)
 * - Remove existing backup wallets
 *
 * The 72-hour maturation period is enforced on-chain.
 * Client-side time display is informational only.
 */

interface BackupWalletDisplay {
  commitmentHex: string;
  registeredAt: bigint;
  matured: boolean;
  timeRemaining: number;
}

type PageState = 'idle' | 'loading' | 'adding' | 'removing' | 'error';

const MATURATION_HOURS = 72;

async function getSecretKeyBytes(): Promise<Uint8Array> {
  const secretKeyHex = await VaultCidStore.getSecretKey();
  if (!secretKeyHex) {
    throw new Error('Vault not unlocked — secret key unavailable');
  }
  return hexToBytes(secretKeyHex);
}

const BackupWallets: React.FC = () => {
  const [wallets, setWallets] = useState<BackupWalletDisplay[]>([]);
  const [pageState, setPageState] = useState<PageState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [newBackupKeyHex, setNewBackupKeyHex] = useState('');
  const [contractAddress, setContractAddress] = useState('');
  const [loaded, setLoaded] = useState(false);

  const loadWallets = useCallback(async () => {
    if (!contractAddress) {
      setError('Contract address is required');
      return;
    }

    setPageState('loading');
    setError(null);

    try {
      const { getBackupWalletStatus } = await import(
        '@/services/BackupWalletService'
      );
      const status = await getBackupWalletStatus(contractAddress);
      setWallets(
        status.map((w) => ({
          commitmentHex: bytesToHex(w.commitment),
          registeredAt: w.registeredAt,
          matured: w.matured,
          timeRemaining: w.timeRemaining,
        })),
      );
      setLoaded(true);
      setPageState('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load backup wallets');
      setPageState('error');
    }
  }, [contractAddress]);

  const handleAddWallet = async () => {
    if (!isValidHex(newBackupKeyHex, 64)) {
      setError('Backup key must be a 64-character hex string (32 bytes)');
      return;
    }

    setPageState('adding');
    setError(null);

    try {
      const secretKey = await getSecretKeyBytes();
      const backupKey = hexToBytes(newBackupKeyHex);
      const { addBackupWallet } = await import('@/services/BackupWalletService');
      await addBackupWallet(contractAddress, backupKey, secretKey);
      setNewBackupKeyHex('');
      await loadWallets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add backup wallet');
      setPageState('error');
    }
  };

  const handleRemoveWallet = async (commitmentHex: string) => {
    setPageState('removing');
    setError(null);

    try {
      const secretKey = await getSecretKeyBytes();
      const commitment = hexToBytes(commitmentHex);
      const { removeBackupWallet } = await import('@/services/BackupWalletService');
      await removeBackupWallet(contractAddress, commitment, secretKey);
      await loadWallets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove backup wallet');
      setPageState('error');
    }
  };

  return (
    <div className="space-y-4 p-4">
      {/* Contract Address Input */}
      {!loaded && (
        <section>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
              VaultRegistry Contract
            </h3>
            <input
              type="text"
              value={contractAddress}
              onChange={(e) => setContractAddress(e.target.value)}
              placeholder="Contract address"
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <button
              onClick={loadWallets}
              disabled={pageState === 'loading' || !contractAddress}
              className="mt-2 w-full px-4 py-2 bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white rounded-md text-sm transition-colors"
            >
              {pageState === 'loading' ? 'Loading...' : 'Load Backup Wallets'}
            </button>
          </div>
        </section>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Backup Wallet List */}
      {loaded && (
        <section>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="p-4">
              <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                Registered Backup Wallets ({wallets.length})
              </h3>
              {wallets.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No backup wallets registered.
                </p>
              ) : (
                <div className="space-y-2">
                  {wallets.map((wallet) => (
                    <div
                      key={wallet.commitmentHex}
                      className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-md"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-mono text-gray-700 dark:text-gray-300 truncate">
                          {truncateHex(wallet.commitmentHex)}
                        </p>
                        <div className="flex items-center mt-1">
                          {wallet.matured ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                              Ready
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                              Matures in {formatTimeRemaining(wallet.timeRemaining)}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveWallet(wallet.commitmentHex)}
                        disabled={pageState === 'removing'}
                        className="ml-2 p-1 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50 transition-colors"
                        title="Remove backup wallet"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Add Backup Wallet Form */}
      {loaded && (
        <section>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
              Add Backup Wallet
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Enter the backup key (64 hex characters). The backup wallet holder must store this key securely.
            </p>
            <input
              type="text"
              value={newBackupKeyHex}
              onChange={(e) => setNewBackupKeyHex(e.target.value)}
              placeholder="Backup key (64 hex chars)"
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-mono text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
              maxLength={64}
            />
            <button
              onClick={handleAddWallet}
              disabled={pageState === 'adding' || !newBackupKeyHex}
              className="mt-2 w-full px-4 py-2 bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white rounded-md text-sm transition-colors"
            >
              {pageState === 'adding' ? 'Adding...' : 'Add Backup Wallet'}
            </button>
          </div>
        </section>
      )}

      {/* Security Info */}
      {loaded && (
        <section>
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h3 className="text-sm font-medium text-blue-900 dark:text-blue-200 mb-1">
              {MATURATION_HOURS}-Hour Maturation Period
            </h3>
            <p className="text-xs text-blue-700 dark:text-blue-300">
              Newly added backup wallets must wait {MATURATION_HOURS} hours before they can execute
              a transfer. This gives the vault owner time to detect and remove any unauthorized
              backup wallets. The maturation check is enforced on-chain.
            </p>
          </div>
        </section>
      )}
    </div>
  );
};

export default BackupWallets;
