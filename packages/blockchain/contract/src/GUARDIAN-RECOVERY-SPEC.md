# GuardianRecovery Contract — Canonical Specification

**Contract:** `guardian-recovery.compact`
**Language:** Compact >= 0.20
**SDK:** compact-runtime 0.14.0, ledger-v7 7.0.0

---

## Functions

### Owner-Only (verified via `ownerCommitment(local_secret_key())`)

| Function | Signature | Story | State Effects |
|----------|-----------|-------|---------------|
| `initialize` | `(ownerCom: Bytes<32>): []` | 3.1 | Sets `owner`. Rejects if already initialized. |
| `addGuardian` | `(guardianCom: Bytes<32>): []` | 3.1 | Inserts to `guardians`, increments `guardianCount`. Max 3. |
| `removeGuardian` | `(guardianCom: Bytes<32>): []` | 3.1 | Removes from `guardians`, decrements `guardianCount`. Blocked during active recovery. |
| `storeSharesCidHash` | `(cidHash: Bytes<32>): []` | 3.1 | Updates `sharesCidHash`. |
| `initiateRecovery` | `(currentTime: Uint<64>): []` | 3.1 | Sets `recoveryInitiatedAt`. Rejects if `currentTime == 0` or recovery already active. |
| `claimRecovery` | `(): []` | 3.1 | Sets `recoveryComplete = true`. Requires 72h time-lock + 2-of-3 guardian threshold. |
| `cancelRecovery` | `(): []` | 3.1 | Resets `recoveryInitiatedAt`, clears `approvedGuardians`. |

### Guardian-Only (verified via `guardianCommitment(local_guardian_key())` + `guardians.member()`)

| Function | Signature | Story | State Effects |
|----------|-----------|-------|---------------|
| `approveRecovery` | `(): []` | 3.1 | Inserts guardian commitment to `approvedGuardians`. Rejects if no recovery active or already approved. |

### Pure Circuits (off-circuit computation)

| Function | Signature | Story | Description |
|----------|-----------|-------|-------------|
| `ownerCommitment` | `(sk: Bytes<32>): Bytes<32>` | 3.1 | `persistentCommit<Bytes<32>>(pad(32, "recovery:owner:"), sk)` |
| `guardianCommitment` | `(gk: Bytes<32>): Bytes<32>` | 3.1 | `persistentCommit<Bytes<32>>(pad(32, "recovery:guardian:"), gk)` |

---

## Access Control Matrix

| Function | Caller | Verification Method |
|----------|--------|---------------------|
| `initialize` | Any (first-time) | `owner == default<Bytes<32>>` |
| `addGuardian` | Owner only | `ownerCommitment(local_secret_key())` |
| `removeGuardian` | Owner only | `ownerCommitment(local_secret_key())` |
| `storeSharesCidHash` | Owner only | `ownerCommitment(local_secret_key())` |
| `initiateRecovery` | Owner only | `ownerCommitment(local_secret_key())` + `blockTimeGte()` |
| `claimRecovery` | Owner only | `ownerCommitment(local_secret_key())` + `blockTimeGte(unlockTime)` |
| `cancelRecovery` | Owner only | `ownerCommitment(local_secret_key())` |
| `approveRecovery` | Guardian only | `guardianCommitment(local_guardian_key())` + `guardians.member()` |
| `ownerCommitment` | Pure | N/A |
| `guardianCommitment` | Pure | N/A |

---

## State Variables

| Field | Type | Purpose |
|-------|------|---------|
| `owner` | `Bytes<32>` | Owner commitment (hiding, via `persistentCommit`) |
| `guardians` | `Set<Bytes<32>>` | Guardian commitment set (max 3). Runtime: `{ isEmpty(), size(), member(), [Symbol.iterator]() }` |
| `guardianCount` | `Counter` | Number of registered guardians |
| `recoveryInitiatedAt` | `Uint<64>` | Unix epoch seconds when recovery initiated (0 = none) |
| `approvedGuardians` | `Set<Bytes<32>>` | Guardians that approved the current recovery |
| `sharesCidHash` | `Bytes<32>` | Hash of IPFS CID containing encrypted Shamir shares |
| `recoveryComplete` | `Boolean` | True after successful `claimRecovery` |

---

## Witnesses

| Witness | Returns | Purpose |
|---------|---------|---------|
| `local_secret_key()` | `Bytes<32>` | Owner's secret key from TypeScript private state |
| `local_guardian_key()` | `Bytes<32>` | Guardian's key from TypeScript private state |

---

## Compact Language Constraints

| Constraint | Impact |
|-----------|--------|
| No `this.sender` | Caller identity via witness + `persistentCommit` |
| No `private state {}` block | Private state is TypeScript-only (`GuardianRecoveryPrivateState`) |
| No `currentTimestamp()` | Use `blockTimeGte/Gt/Lt/Lte(Uint<64>)` (Compact 0.17+) |
| `Uint<64>` no direct `+` | Cast: `(((val as Field) + (n as Field)) as Uint<64>)` |
| `disclose()` required | Circuit params must be disclosed before ledger/conditional use |
| `default<T>` is expression | `default<Bytes<32>>` not `default<Bytes<32>>()` |
| No array iteration in circuits | Guardians added one at a time; use `Set.resetToDefault()` to clear |

---

## Design Decisions

- **Deployment model:** Per-vault instance — each vault owner deploys their own GuardianRecovery contract
- **Owner identity:** `persistentCommit` (hiding commitment) with domain separator `pad(32, "recovery:owner:")` — different from VaultRegistry's `"vault:owner:"` to prevent cross-contract commitment collisions
- **Guardian identity:** Separate domain separator `pad(32, "recovery:guardian:")` prevents cross-role commitment collisions
- **Time-lock:** 72-hour (259200 seconds) enforced **on-chain** via `blockTimeGte(unlockTime)` — not an off-chain workaround
- **Threshold:** 2-of-3 guardians required for recovery claim, checked via `approvedGuardians.size() >= 2`
- **Guardian limit:** Maximum 3 guardians enforced via `guardianCount.lessThan(3)` counter check
- **Shares storage:** Only hash of IPFS CID on-chain; actual encrypted Shamir shares on IPFS
- **No cross-contract calls:** GuardianRecovery cannot directly call VaultRegistry; application layer coordinates

---

## Known Limitations

### Simulator cannot test positive claimRecovery flow

The compact-runtime simulator's block time defaults to 0 and cannot be advanced. This makes `blockTimeGte(unlockTime)` impossible to satisfy with a real timestamp + 72-hour offset. Positive testing of the full initiate → approve → claim flow requires E2E on a local Midnight network with actual block time.

### No cross-contract coordination

GuardianRecovery and VaultRegistry are separate contracts. The application layer (TypeScript CLI/extension) must coordinate between them — e.g., using recovery completion to trigger a VaultRegistry ownership transfer.

### Post-recovery terminal state

After `claimRecovery()` succeeds, the contract is in a terminal state (`recoveryComplete = true`). There is no reset circuit to clear this state for reuse. Per the per-vault deployment model, the owner deploys a new GuardianRecovery instance for subsequent recovery cycles.

### Guardian removal blocked during active recovery

`removeGuardian()` is rejected while `recoveryInitiatedAt != 0`. This prevents a security gap where a removed guardian's approval would still count toward the 2-of-3 threshold. To remove a guardian during recovery, the owner must first call `cancelRecovery()`, then remove the guardian, then re-initiate recovery.
