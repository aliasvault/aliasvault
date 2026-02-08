import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { sendMessage } from 'webext-bridge/popup';

import type { EncryptionKeyDerivationParams, VaultMetadata } from '@/utils/dist/shared/models/metadata';
import type { VaultResponse } from '@/utils/dist/shared/models/webapi';
import EncryptionUtility from '@/utils/EncryptionUtility';
import SqliteClient from '@/utils/SqliteClient';
import { VaultCidStore } from '@/services/VaultCidStore';
import { StoreVaultRequest } from '@/utils/types/messaging/StoreVaultRequest';
import type { VaultResponse as messageVaultResponse } from '@/utils/types/messaging/VaultResponse';

import { storage } from '#imports';

type DbContextType = {
  sqliteClient: SqliteClient | null;
  dbInitialized: boolean;
  dbAvailable: boolean;
  initializeDatabase: (vaultResponse: VaultResponse, derivedKey: string) => Promise<SqliteClient>;
  initializeDatabaseFromBlob: (encryptedBlobBase64: string, derivedKey: string) => Promise<SqliteClient>;
  extractAndCacheSecretKey: (sqliteClient: SqliteClient) => Promise<void>;
  storeEncryptionKey: (derivedKey: string) => Promise<void>;
  storeEncryptionKeyDerivationParams: (params: EncryptionKeyDerivationParams) => Promise<void>;
  clearDatabase: () => void;
  getVaultMetadata: () => Promise<VaultMetadata | null>;
  setCurrentVaultRevisionNumber: (revisionNumber: number) => Promise<void>;
  hasPendingMigrations: () => Promise<boolean>;
}

const DbContext = createContext<DbContextType | undefined>(undefined);

/**
 * DbProvider to provide the SQLite client to the app that components can use to make database queries.
 */
export const DbProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  /**
   * SQLite client.
   */
  const [sqliteClient, setSqliteClient] = useState<SqliteClient | null>(null);

  /**
   * Database initialization state. If true, the database has been initialized and the dbAvailable state is correct.
   */
  const [dbInitialized, setDbInitialized] = useState(false);

  /**
   * Database availability state. If true, the database is available. If false, the database is not available and needs to be unlocked or retrieved again from the API.
   */
  const [dbAvailable, setDbAvailable] = useState(false);

  const initializeDatabase = useCallback(async (vaultResponse: VaultResponse, derivedKey: string) => {
    // Attempt to decrypt the blob.
    const decryptedBlob = await EncryptionUtility.symmetricDecrypt(
      vaultResponse.vault.blob,
      derivedKey
    );

    // Initialize the SQLite client.
    const client = new SqliteClient();
    await client.initializeFromBase64(decryptedBlob);

    setSqliteClient(client);
    setDbInitialized(true);
    setDbAvailable(true);

    /**
     * Store encrypted vault and metadata in background worker (session storage).
     */
    const request: StoreVaultRequest = {
      vaultBlob: vaultResponse.vault.blob,
      publicEmailDomainList: vaultResponse.vault.publicEmailDomainList,
      privateEmailDomainList: vaultResponse.vault.privateEmailDomainList,
      hiddenPrivateEmailDomainList: vaultResponse.vault.hiddenPrivateEmailDomainList,
      vaultRevisionNumber: vaultResponse.vault.currentRevisionNumber,
    };

    await sendMessage('STORE_VAULT', request, 'background');

    return client;
  }, []);

  /**
   * Initialize database from a raw encrypted blob (blockchain load flow).
   * Unlike initializeDatabase(), this does not expect a VaultResponse with metadata.
   * The encrypted blob comes from IPFS download (base64-encoded for message passing).
   */
  const initializeDatabaseFromBlob = useCallback(async (encryptedBlobBase64: string, derivedKey: string) => {
    // Decrypt the blob using the derived key.
    const decryptedBlob = await EncryptionUtility.symmetricDecrypt(
      encryptedBlobBase64,
      derivedKey
    );

    // Initialize the SQLite client.
    const client = new SqliteClient();
    await client.initializeFromBase64(decryptedBlob);

    setSqliteClient(client);
    setDbInitialized(true);
    setDbAvailable(true);

    // Store encrypted vault in background worker (session storage).
    // Blockchain flow does not have email domain lists or revision numbers —
    // those are stored inside the SQLite DB itself.
    const request: StoreVaultRequest = {
      vaultBlob: encryptedBlobBase64,
      publicEmailDomainList: [],
      privateEmailDomainList: [],
      hiddenPrivateEmailDomainList: [],
      vaultRevisionNumber: 0,
    };

    await sendMessage('STORE_VAULT', request, 'background');

    return client;
  }, []);

  /**
   * Extract the secretKey from the SQLite Settings table and cache it in VaultCidStore.
   * Per ADR-006, Midnight private state is device-local. The secretKey (used for owner commitment)
   * is stored in the encrypted vault so it travels across devices via IPFS.
   * On a new device, we extract it after first vault load and cache it locally.
   */
  const extractAndCacheSecretKey = useCallback(async (client: SqliteClient) => {
    try {
      const existingKey = await VaultCidStore.getSecretKey();
      if (existingKey) {
        // secretKey already cached locally — skip extraction
        return;
      }

      // Read secretKey from SQLite Settings table
      const secretKeyHex = await VaultCidStore.readSecretKeyFromVault(client);
      if (secretKeyHex) {
        await VaultCidStore.setSecretKey(secretKeyHex);
      }
    } catch (error) {
      console.error('Failed to extract secretKey from vault:', error);
      // Non-fatal: secretKey extraction failure doesn't block vault loading.
      // The user can still browse their vault; saves will fail until secretKey is available.
    }
  }, []);

  const checkStoredVault = useCallback(async () => {
    try {
      const response = await sendMessage('GET_VAULT', {}, 'background') as messageVaultResponse;
      if (response?.vault) {
        const client = new SqliteClient();
        await client.initializeFromBase64(response.vault);

        setSqliteClient(client);
        setDbInitialized(true);
        setDbAvailable(true);
        // Metadata is already stored in session storage by background worker
      } else {
        setDbInitialized(true);
        setDbAvailable(false);
      }
    } catch (error) {
      console.error('Error retrieving vault from background:', error);
      setDbInitialized(true);
      setDbAvailable(false);
    }
  }, []);

  /**
   * Get the vault metadata from session storage.
   */
  const getVaultMetadata = useCallback(async () : Promise<VaultMetadata | null> => {
    try {
      const publicEmailDomains = await storage.getItem('session:publicEmailDomains') as string[] | null;
      const privateEmailDomains = await storage.getItem('session:privateEmailDomains') as string[] | null;
      const hiddenPrivateEmailDomains = await storage.getItem('session:hiddenPrivateEmailDomains') as string[] | null;
      const vaultRevisionNumber = await storage.getItem('session:vaultRevisionNumber') as number | null;

      if (!publicEmailDomains && !privateEmailDomains) {
        return null;
      }

      return {
        publicEmailDomains: publicEmailDomains ?? [],
        privateEmailDomains: privateEmailDomains ?? [],
        hiddenPrivateEmailDomains: hiddenPrivateEmailDomains ?? [],
        vaultRevisionNumber: vaultRevisionNumber ?? 0,
      };
    } catch (error) {
      console.error('Error getting vault metadata from session storage:', error);
      return null;
    }
  }, []);

  /**
   * Set the current vault revision number in session storage.
   */
  const setCurrentVaultRevisionNumber = useCallback(async (revisionNumber: number) => {
    await storage.setItem('session:vaultRevisionNumber', revisionNumber);
  }, []);

  /**
   * Check if there are pending migrations.
   */
  const hasPendingMigrations = useCallback(async () => {
    if (!sqliteClient) {
      return false;
    }
    return await sqliteClient.hasPendingMigrations();
  }, [sqliteClient]);

  /**
   * Check if database is initialized and try to retrieve vault from background
   */
  useEffect(() : void => {
    if (!dbInitialized) {
      checkStoredVault();
    }
  }, [dbInitialized, checkStoredVault]);

  /**
   * Store encryption key in background worker.
   */
  const storeEncryptionKey = useCallback(async (encryptionKey: string) : Promise<void> => {
    await sendMessage('STORE_ENCRYPTION_KEY', encryptionKey, 'background');
  }, []);

  /**
   * Store encryption key derivation params in background worker.
   */
  const storeEncryptionKeyDerivationParams = useCallback(async (params: EncryptionKeyDerivationParams) : Promise<void> => {
    await sendMessage('STORE_ENCRYPTION_KEY_DERIVATION_PARAMS', params, 'background');
  }, []);

  /**
   * Clear database and remove from background worker, called when logging out.
   */
  const clearDatabase = useCallback(() : void => {
    setSqliteClient(null);
    setDbInitialized(false);
    setDbAvailable(false);
    sendMessage('CLEAR_VAULT', {}, 'background');
  }, []);

  const contextValue = useMemo(() => ({
    sqliteClient,
    dbInitialized,
    dbAvailable,
    initializeDatabase,
    initializeDatabaseFromBlob,
    extractAndCacheSecretKey,
    storeEncryptionKey,
    storeEncryptionKeyDerivationParams,
    clearDatabase,
    getVaultMetadata,
    setCurrentVaultRevisionNumber,
    hasPendingMigrations,
  }), [sqliteClient, dbInitialized, dbAvailable, initializeDatabase, initializeDatabaseFromBlob, extractAndCacheSecretKey, storeEncryptionKey, storeEncryptionKeyDerivationParams, clearDatabase, getVaultMetadata, setCurrentVaultRevisionNumber, hasPendingMigrations]);

  return (
    <DbContext.Provider value={contextValue}>
      {children}
    </DbContext.Provider>
  );
};

/**
 * Hook to use the DbContext
 */
export const useDb = () : DbContextType => {
  const context = useContext(DbContext);
  if (context === undefined) {
    throw new Error('useDb must be used within a DbProvider');
  }
  return context;
};
