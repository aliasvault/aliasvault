# AliasVault Contract Deployment Rubric — Self-Assessment

Status: done (initial pass)
Date: 2026-04-18
Author: Claude (manual scoring — MCP tool `midnight-review-contract` is unavailable from Claude Code per `7-0-local-devnet-research.md`)
Rubric source: Midnight Fireside Dev Hang transcript (Nick Stanford, 2026-04-11) — three categories: **value at risk**, **privacy at risk**, **state-space at risk**. A score of 3 on any axis blocks deployment until resolved.
Scale: 1 = low, 2 = moderate, 3 = blocks deployment

## Scope

Three production contracts in `packages/blockchain/contract/src/`:

| File | Lines | Circuits exported |
|---|---|---|
| `vault-registry.compact` | 284 | 11 (registerVault, updateVault, transferOwnership, storeRecoveryKeyHash, addBackupWallet, removeBackupWallet, backupTransfer, setEmailPublicKey, setMailRelay, notifyNewMail, isRegistered) + 3 pure (ownerCommitment, backupCommitment, relayCommitment) |
| `alias-registry.compact` | 90 | 4 (claimAlias, getOwner, getContractAddress, releaseAlias) + 1 pure (ownerCommitment) |
| `guardian-recovery.compact` | 203 | 7 (initialize, addGuardian, removeGuardian, storeSharesCidHash, initiateRecovery, approveRecovery, claimRecovery, cancelRecovery) + 2 pure (ownerCommitment, guardianCommitment) |

## Summary Table

| Contract | Value | Privacy | State-space | Overall |
|---|:---:|:---:|:---:|---|
| **VaultRegistry** | 1 | 2 | 2 | OK |
| **AliasRegistry** | 1 | 2 | **3** | **BLOCKER** — open `claimAlias` enables cheap state inflation |
| **GuardianRecovery** | **2–3** | 2 | 1 | **BLOCKER (conditional)** — depends on real-node `blockTimeGte` enforcement |

## VaultRegistry — 1 / 2 / 2 (OK)

### Value at risk — 1 (low)
- Contract holds no NIGHT/dust/tokens. The `vaultCidHash` is an integrity commitment to an IPFS CID; mis-setting it loses vault access (recoverable via backup wallet or guardian recovery) but is not monetary loss.
- `transferOwnership` (line 175) and `updateVault` (line 164) require `ownerCommitment(local_secret_key())` proof. Clean gating.
- `addBackupWallet` timestamp validation (line 212) uses `blockTimeGte(time)` to reject future timestamps — but accepts past timestamps. An owner-role attacker could add a backup with `timestamp = 1`, then `backupTransfer` (line 227) would succeed immediately since `unlockTime = 1 + 259200` is already past. However: the attacker must already be the owner, in which case they already have full control and this adds no privilege — **not a value escalation vector**.

### Privacy at risk — 2 (moderate)
- Publicly readable ledger state leaks meaningful metadata: `totalVaults` (user count), `emailCount` (activity per vault), `inboxManifestCid` (IPFS pointer — encrypted content per ADR-008, but the pointer exists), `backupWallets` (count + registration timestamps per vault).
- Commitments (`owner`, `mailRelay`, backup-wallet keys) use `persistentCommit` with domain separators. Blinded — pre-image recovery requires witness compromise, not ZK fault.
- Witness keys (`local_secret_key`, `local_backup_key`, `local_relay_key`) live in TypeScript private state. Standard ZK-DApp exposure surface.
- Traffic analysis: `updateVault` and `notifyNewMail` call timing is public. Outside rubric scope but worth operational awareness.

### State-space at risk — 2 (moderate)
- `registrations: Set<Bytes<32>>` (line 93) grows unboundedly with each `registerVault` call. One global Set across all users.
- Gating: `registerVault` writes owner commitment from `ownerCommitment(local_secret_key())` (line 156) — caller must have a key. Dust cost per tx is the economic throttle.
- Per-instance growth: `backupWallets` map, `emailCount` counter — bounded by owner-only gating (backups) or relay-only gating (emails).
- **Risk:** if the dust cost model allows cheap transactions early-network, a single attacker with many keys can inflate the global `registrations` Set. Each insert is ~32 bytes; 100M fresh registrations ≈ 3.2 GB of permanent ledger growth.
- **Mitigation path:** the rubric targets this class of attack specifically. Before mainnet, (a) document the expected growth rate from legitimate usage, (b) verify dust cost scales appropriately, (c) consider per-key rate limiting at app layer.

## AliasRegistry — 1 / 2 / **3** (BLOCKER on state-space)

### Value at risk — 1 (low)
- No NIGHT/dust/tokens held. Aliases are human-readable pointers.
- Alias squatting is limited because `claimAlias` operates on `aliasHash` (SHA-256 of the alias string), so squatting requires pre-image knowledge. The human-readable alias itself is the scarce resource; attackers can precompute hashes for common strings but cannot enumerate all users' preferred aliases.
- `releaseAlias` (line 83) requires owner proof.

### Privacy at risk — 2 (moderate)
- `aliasOwners: Map<Bytes<32>, Bytes<32>>` (line 40) maps alias hash → owner commitment; `aliasContracts` (line 43) maps alias hash → VaultRegistry contract address. Both PUBLIC by design (SMTP bridge queries them to route email). Knowing the alias hash reveals the user's contract address.
- For low-entropy aliases (e.g. `alice@aliasvault`), hash is predictable → link graph from alias string to contract address. Metadata leak, not secret leak.
- ZK fault would expose `ownerCommitment` pre-image; commitments are blinded via `persistentCommit`, so fault containment is reasonable.

### State-space at risk — **3 (BLOCKER)**
- **`claimAlias` (line 60) has NO caller authentication.** Any dust-holding party can write to `aliasOwners.insert` and `aliasContracts.insert` for any `aliasHash` that isn't already taken.
- Each claim writes ~64 bytes (alias hash + owner commitment) + variable-length `Opaque<'string'>` contract address. 100M fresh hashes ≈ 6.4 GB+ of permanent ledger growth.
- **The rubric names this attack explicitly:** "an open network on day one is vulnerable to a cheap irreversible state inflation attack." Open unauthenticated `claimAlias` is precisely this pattern — ledger grows without any barrier other than dust cost, and `aliasOwners.member` enforcement makes each hash a one-shot waste (can't be reclaimed cheaply by the legitimate user later).
- **Mitigation options** (not exhaustive; pick based on product constraints):
  - **Stake-on-claim**: require a dust deposit that's returned on `releaseAlias`. Requires dust-wallet pattern in Compact; may not be feasible pre-mainnet.
  - **Expiry**: add `claimedAt: Uint<64>` and auto-release unclaimed aliases after N days of inactivity. Requires witness for activity signals, reasonable to implement.
  - **Per-caller rate limit** via authenticated claim: introduce `ownerCommitment(local_secret_key())` gating so only existing VaultRegistry owners can claim. Limits blast radius to one-claim-per-registered-user.
  - **Two-step claim**: first-come-first-served for hash reservation, second step requires proof of existing VaultRegistry. Reduces anonymous spam path.
- **Recommendation before mainnet:** add authenticated claim (option 3 — require `local_secret_key()` witness and bind to `ownerCommitment`). This still leaves per-user spam of N aliases, but eliminates the fresh-key Sybil vector and aligns with VaultRegistry's authentication model.

## GuardianRecovery — **2–3** / 2 / 1 (BLOCKER conditional on time-lock verification)

### Value at risk — **2–3 (conditional)**
- Contract's purpose is to *recover* a vault. A bypass hands the attacker the vault's entire content.
- Defenses:
  - 72-hour time-lock via `assert(blockTimeGte(unlockTime), ...)` (line 189)
  - 2-of-3 guardian threshold via `assert(approvedGuardians.size() >= 2, ...)` (line 191)
  - Owner-only `claimRecovery` — but `claimRecovery` is only called AFTER an `initiateRecovery` the attacker triggers (line 157 requires owner — **this is a problem too**: if the "owner" is compromised they can initiate; if the attacker ISN'T the owner, they can't start recovery at all, so real-world threat is a compromised owner using recovery to reset state — which is the intended path).
  - Actually, re-reading: `initiateRecovery` requires `ownerCommitment(local_secret_key())` (line 160). So only the owner initiates. The **threat model** for recovery is: owner lost their key → new-owner uses the recovery-key-hash + guardians to claim. The local_secret_key() for the NEW owner is a different key derived from the recovery key. So "caller" of `initiateRecovery` is the new-owner candidate presenting `recoveryKeyHash` pre-image — and the contract doesn't actually check that pre-image directly; it checks `ownerCommitment(local_secret_key())` against the stored `owner`.
  - Wait, re-reading: `claimRecovery` only asserts `owner == ownerCommitment(sk)` (line 184). If `sk` is the ORIGINAL owner's key, any time is fine. If it's a recovery claimant's key, this check fails. So `claimRecovery` only works for the original owner, which means *the contract never actually rotates ownership on recovery*. The recovery mechanism sets `recoveryComplete = true` but doesn't update `owner`. ⚠️ **This may be an intended design (recovery means "approved to decrypt vault", not "new owner") or may be a bug.** Needs product clarification. **Flag for review.**
- **`blockTimeGte` simulator issue:** per memory (`project_provider_gap_findDeployedContract.md` and Rule 11 context), `blockTimeGte` returns `true` unconditionally in the simulator. Real-node behavior is untested. If real node also doesn't enforce, the 72-hour time-lock is a no-op and recovery can complete instantly — defeating the core defense.
- **Verdict:** 2 if we trust real-node `blockTimeGte` enforces correctly; **3 until verified on local DevNet (Epic 7 P0 #4 — extension E2E tests must include a "recovery time-lock holds" case)**. Treat as 3 until real-node proof exists.

### Privacy at risk — 2 (moderate)
- Guardian commitments (`guardians: Set`) and `approvedGuardians` are public per vault. Enumerable per-vault but blinded (`persistentCommit`).
- `recoveryInitiatedAt` reveals that recovery is in progress + when it started — social signal that the vault owner may be compromised or under attack.
- `sharesCidHash` — hash only; IPFS shares are encrypted off-chain.

### State-space at risk — 1 (low)
- All state is per-contract (one instance per vault). Owner must pay for a new deploy to create an instance.
- `guardians.insert` gated by `guardianCount.lessThan(3)` (line 127) — hard cap at 3.
- `approvedGuardians` bounded by guardians (≤ 3).
- No global unbounded collection. Deploy cost itself is the rate limiter.

## Blocking items before mainnet

1. **AliasRegistry `claimAlias` authentication** — add `local_secret_key()` witness + require `ownerCommitment(sk)` non-default check. Prevents fresh-key Sybil state inflation.
2. **GuardianRecovery `blockTimeGte` real-node verification** — Epic 7 local DevNet E2E must include a test that asserts `claimRecovery` FAILS within 72 hours of `initiateRecovery`. If it passes, the time-lock is broken and we cannot ship.
3. **GuardianRecovery ownership-on-recovery design review** — confirm whether `recoveryComplete = true` without `owner` rotation is intentional (i.e., recovery = read-decrypt capability, not transfer) or a missing `owner = newOwnerCommitment` statement. Product + architecture call.

## Non-blocking but worth tracking

4. **VaultRegistry `registrations` Set growth** — document expected rate, watch during Epic 7 load testing.
5. **VaultRegistry past-timestamp in `addBackupWallet`** — not a privilege escalation (owner → owner), but adding `assert(time <= blockTimeNow)` *and* a reasonable lower bound (e.g. `time >= 1609459200` for year 2021) would rule out misuse by a compromised owner forcing early backup maturity.

## Re-score trigger events

Re-run this assessment if any of:
- `.compact` source changes
- Compact compiler version bumps (may change `blockTimeGte` semantics)
- Rubric categories redefined by Midnight Foundation
- Real-node E2E surfaces behavior divergence from simulator

## Tool used

Manual scoring, not `mcp__midnight__midnight-review-contract` (unavailable from Claude Code — requires Claude Desktop MCP sampling per 2026-04-18 verification). The MCP tool's description lists "security vulnerabilities, privacy concerns, logic errors, best practice, performance" — overlaps with this rubric on **privacy** but does not explicitly score **value at risk** or **state-space at risk**. Even if it were available, its output would need manual mapping to the 3-category rubric.
