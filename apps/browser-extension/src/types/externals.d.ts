/**
 * Ambient module declarations for packages that are dynamically imported at runtime
 * but not installed in the browser-extension dev environment.
 *
 * These modules are loaded via `await import()` at runtime when the extension
 * communicates with the Midnight blockchain. They are not needed during development
 * or testing of the browser extension itself.
 */

// Midnight SDK packages (loaded at runtime via dynamic import)
declare module '@midnight-ntwrk/midnight-js-contracts';
declare module '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
declare module '@midnight-ntwrk/midnight-js-http-client-proof-provider';
declare module '@midnight-ntwrk/compact-js';

// AliasVault workspace packages (loaded at runtime via dynamic import)
declare module '@aliasvault/contract';
declare module '@aliasvault/vault-sync' {
  export interface RecoveryShareFile {
    version: 1;
    shareIndex: number;
    shareHex: string;
  }
  export interface GuardianSharePackage {
    version: 2;
    vaultOwnerCommitment: string;
    threshold: number;
    totalShares: number;
    encryptedPassword: string;
    shares: Array<{ index: number; encryptedShare: string }>;
  }
  export interface RecoveryClaimResult {
    masterPassword: string;
  }
  export class RecoveryClaimError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
  }
  export function validateShareFile(data: unknown): RecoveryShareFile;
  export function parseSharePackageFromBytes(bytes: Uint8Array): GuardianSharePackage;
  export function claimRecovery(params: {
    sharePackage: GuardianSharePackage;
    shareFiles: RecoveryShareFile[];
    onChainRecoveryKeyHash: Uint8Array;
  }): Promise<RecoveryClaimResult>;
}

// argon2 WASM bundle (no @types available)
declare module 'argon2-browser/dist/argon2-bundled.min.js';
