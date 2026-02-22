# VaultRegistry Contract — Canonical Specification

**Contract:** `vault-registry.compact`
**Language:** Compact >= 0.20
**SDK:** compact-runtime 0.14.0, ledger-v7 7.0.0

---

## Functions

### Owner-Only (verified via `ownerCommitment(local_secret_key())`)

| Function | Signature | Epic | State Effects |
|----------|-----------|------|---------------|
| `registerVault` | `(walletAddressHash: Bytes<32>): []` | 1.4 | Sets `owner`, increments `totalVaults`, inserts to `registrations`, initializes `vaultCidHash` |
| `updateVault` | `(newCidHash: Bytes<32>): []` | 2.1 | Updates `vaultCidHash` |
| `transferOwnership` | `(newOwnerCommitment: Bytes<32>): []` | 2.6 | Updates `owner`, resets `recoveryKeyHash`, `transferInitiatedAt`, `transferInitiator`, clears `backupWallets` |
| `storeRecoveryKeyHash` | `(keyHash: Bytes<32>): []` | 2.6 | Updates `recoveryKeyHash` |
| `addBackupWallet` | `(walletCommitment: Bytes<32>): []` | 2.6 | Inserts to `backupWallets` |
| `removeBackupWallet` | `(walletCommitment: Bytes<32>): []` | 2.6 | Removes from `backupWallets` |
| `cancelBackupTransfer` | `(): []` | 2.6 | Resets `transferInitiatedAt`, `transferInitiator` |

### Backup-Wallet-Only (verified via `backupCommitment(local_backup_key())` + `backupWallets.member()`)

| Function | Signature | Epic | State Effects |
|----------|-----------|------|---------------|
| `initiateBackupTransfer` | `(currentTime: Uint<64>): []` | 2.6 | Sets `transferInitiatedAt`, `transferInitiator`. Rejects `currentTime == 0` (sentinel collision). |
| `executeBackupTransfer` | `(newOwnerCommitment: Bytes<32>): []` | 2.6 | Updates `owner`, resets transfer state, clears `backupWallets` |

### Public (no access control)

| Function | Signature | Epic | State Effects |
|----------|-----------|------|---------------|
| `isRegistered` | `(walletAddressHash: Bytes<32>): Boolean` | 1.4 | None (read-only) |

### Pure Circuits (off-circuit computation)

| Function | Signature | Epic | Description |
|----------|-----------|------|-------------|
| `ownerCommitment` | `(sk: Bytes<32>): Bytes<32>` | 2.1 | `persistentCommit<Bytes<32>>(pad(32, "vault:owner:"), sk)` |
| `backupCommitment` | `(bk: Bytes<32>): Bytes<32>` | 2.6 | `persistentCommit<Bytes<32>>(pad(32, "vault:backup:"), bk)` |

### Planned (NOT implemented — deferred)

| Function | Epic | Reason |
|----------|------|--------|
| `getPublicKey(wallet)` witness | 5.5 | Requires AliasRegistry + encryption key infrastructure |
| `notifyNewMail(owner, emailCID)` | 5.6 | Requires SMTP bridge + email storage pipeline |
| `getRecoveryKey()` witness | 3.4 | Recovery key in vault blob (ADR-006), not Midnight private state |

---

## Access Control Matrix

| Function | Caller | Verification Method |
|----------|--------|---------------------|
| `registerVault` | Any (first-time) | `!registrations.member(hash)` |
| `updateVault` | Owner only | `ownerCommitment(local_secret_key())` |
| `transferOwnership` | Owner only | `ownerCommitment(local_secret_key())` |
| `storeRecoveryKeyHash` | Owner only | `ownerCommitment(local_secret_key())` |
| `addBackupWallet` | Owner only | `ownerCommitment(local_secret_key())` |
| `removeBackupWallet` | Owner only | `ownerCommitment(local_secret_key())` |
| `cancelBackupTransfer` | Owner only | `ownerCommitment(local_secret_key())` |
| `initiateBackupTransfer` | Backup wallet | `backupCommitment(local_backup_key())` + `backupWallets.member()` + `blockTimeGte()` |
| `executeBackupTransfer` | Backup wallet | `backupCommitment(local_backup_key())` + `backupWallets.member()` + `blockTimeGte(unlockTime)` |
| `isRegistered` | Any | None (read-only) |
| `ownerCommitment` | Pure | N/A |
| `backupCommitment` | Pure | N/A |

---

## State Variables

### Current (Epics 1-2)

| Field | Type | Purpose |
|-------|------|---------|
| `registrations` | `Set<Bytes<32>>` | Registered wallet address hashes |
| `totalVaults` | `Counter` | Total registered vaults |
| `owner` | `Bytes<32>` | Owner commitment (hiding, via `persistentCommit`) |
| `vaultCidHash` | `Bytes<32>` | SHA-256 hash of current vault CID |

### New (Epic 2.6, preparing for Epic 3)

| Field | Type | Purpose |
|-------|------|---------|
| `recoveryKeyHash` | `Bytes<32>` | Hash of recovery key (actual key in vault blob per ADR-006) |
| `backupWallets` | `Set<Bytes<32>>` | Authorized backup wallet commitments. Runtime interface: `{ isEmpty(), size(), member(), [Symbol.iterator]() }` |
| `transferInitiatedAt` | `Uint<64>` | Unix epoch seconds when backup transfer initiated (0 = none) |
| `transferInitiator` | `Bytes<32>` | Commitment of backup wallet that initiated transfer |

---

## Witnesses

| Witness | Returns | Purpose |
|---------|---------|---------|
| `local_secret_key()` | `Bytes<32>` | Owner's secret key from TypeScript private state |
| `local_backup_key()` | `Bytes<32>` | Backup wallet's secret key for backup wallet verification |

---

## Compact Language Constraints

| Constraint | Impact |
|-----------|--------|
| No `this.sender` | Caller identity via witness + `persistentCommit` |
| No `private state {}` block | Private state is TypeScript-only (`VaultRegistryPrivateState`) |
| No `currentTimestamp()` | Use `blockTimeGte/Gt/Lt/Lte(Uint<64>)` (Compact 0.17+) |
| `Uint<64>` no direct `+` | Cast: `(((val as Field) + (n as Field)) as Uint<64>)` |
| `disclose()` required | Circuit params must be disclosed before ledger/conditional use |
| `default<T>` is expression | `default<Bytes<32>>` not `default<Bytes<32>>()` |
| No array iteration in circuits | Backup wallets added one at a time (singular `addBackupWallet`); use `Set.resetToDefault()` to clear the entire set |

---

## Design Decisions

- **Owner identity:** `persistentCommit` (hiding commitment) with fixed domain separator `pad(32, "vault:owner:")` — non-rotating, OpenZeppelin ZOwnablePK pattern
- **Backup wallet identity:** Separate domain separator `pad(32, "vault:backup:")` prevents cross-role commitment collisions (same key produces different commitments for owner vs backup)
- **Time-lock:** 72-hour (259200 seconds) enforced **on-chain** via `blockTimeGte(unlockTime)` — not an off-chain workaround
- **Recovery key:** Only hash stored on-chain; actual key in encrypted vault blob (ADR-006: private state is device-local)
- **CID storage:** Full CID at app layer (TypeScript); only SHA-256 hash on-chain (Bytes<32> too small for full CID)

---

## Known Limitations

### Simulator cannot test positive executeBackupTransfer flow

The compact-runtime simulator's block time defaults to 0 and cannot be advanced. This makes `blockTimeGte(unlockTime)` impossible to satisfy with a real timestamp + 72-hour offset. Positive testing of the full initiate → wait → execute flow requires E2E on a local Midnight network with actual block time.
