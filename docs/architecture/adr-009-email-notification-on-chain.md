# ADR-009: On-Chain Email Notification via Ledger State Mutation

**Status:** Accepted
**Date:** 2026-03-05
**Decision Makers:** Architect (Winston), Ozi3o
**Supersedes:** Epic 5 Story 5.6 original ACs (Solidity-style events + `sponsored: true`)

---

## Context

Epic 5 (Alias Email System) requires a mechanism for the SMTP bridge to notify a user's browser extension when a new email arrives. Story 5.6 originally specified:
- "Emits public event: `{ event: 'NewMail', owner: hash(wallet), timestamp }`"
- "Contract-sponsored transaction (protocol pays gas)"
- "Extension polls for new mail events (every 60 seconds when active)"

**Problems discovered during Implementation Readiness Review (2026-03-04):**

1. **Compact has no `emit event` mechanism.** There is no Solidity-style event emission in the Compact language. The original AC is unimplementable.
2. **"Sponsored transactions" are unvalidated.** The `sponsored: true` flag in architecture pseudocode has no confirmed Midnight SDK equivalent.
3. **Who calls `notifyNewMail`?** The bridge is a server, not the vault owner. It needs its own wallet and authorization to write to a user's VaultRegistry.

### Midnight SDK Research (via MCP)

Midnight provides three mechanisms for detecting contract state changes:

| Mechanism | API | Pattern |
|-----------|-----|---------|
| **Contract State Observable** | `publicDataProvider.contractStateObservable(address, config)` | RxJS Observable — emits on every public ledger state change |
| **Contract Actions Subscription** | GraphQL `subscription { contractActions(address, offset) }` | WebSocket push — streams every contract call with new state |
| **Watch for Contract State** | `publicDataProvider.watchForContractState(address)` | One-shot Promise — resolves when state appears/changes |

All three watch for **ledger state mutations**, not events. The established pattern across reference contracts (counter, bboard, naval-battle, proofshare) is: mutate a public ledger variable, and observers watching the contract detect the change.

---

## Decision

**On-chain notification via ledger state mutation with IPFS inbox manifest (Option A2).**

### Architecture Overview

```
Email arrives at Mox → Bridge encrypts with X25519 (ADR-008)
  → Bridge uploads encrypted email to IPFS → emailCID
  → Bridge updates inbox manifest on IPFS (append emailCID + timestamp)
  → Bridge calls notifyNewMail() on user's VaultRegistry
    → Updates emailCount (Counter) + inboxManifestCid (Opaque<'string'>)
  → Extension detects emailCount change via contractStateObservable
    → Reads inboxManifestCid from public ledger
    → Fetches manifest from IPFS → discovers new email CIDs
    → Downloads + decrypts individual emails
```

### Contract Changes

```compact
// New ledger variables (added to VaultRegistry)
export ledger emailCount: Counter;
export ledger inboxManifestCid: Opaque<'string'>;
export ledger mailRelay: Bytes<32>;

// Witness: bridge's relay secret key
witness local_relay_key(): Bytes<32>;

// Derive relay commitment (same pattern as owner/backup)
circuit relayCommitment(rk: Bytes<32>): Bytes<32> {
  return persistentCommit<Bytes<32>>(pad(32, "vault:relay:"), rk);
}

// Owner authorizes a mail relay
export circuit setMailRelay(relayCommit: Bytes<32>): [] {
  const relay = disclose(relayCommit);
  const sk = local_secret_key();
  assert(owner == ownerCommitment(sk), "Not the vault owner");
  mailRelay = relay;
}

// Only authorized relay can notify
export circuit notifyNewMail(manifestCid: Opaque<'string'>): [] {
  const cid = disclose(manifestCid);
  const rk = local_relay_key();
  assert(mailRelay == relayCommitment(rk), "Not authorized relay");
  emailCount.increment(1);
  inboxManifestCid = cid;
}
```

### Relay Authorization Pattern

Follows the same commitment-based identity pattern used for owner and backup wallets:

| Role | Secret | Witness | Commitment | Ledger Variable |
|------|--------|---------|------------|-----------------|
| Owner | 32B in extension | `local_secret_key()` | `ownerCommitment(sk)` | `owner` |
| Backup wallet | 32B on backup device | `local_backup_key()` | `backupCommitment(bk)` | `backupWallets` map |
| Mail relay | 32B on bridge server | `local_relay_key()` | `relayCommitment(rk)` | `mailRelay` |

**Setup flow:** Bridge generates a 32-byte relay secret key, derives and publishes the commitment. When a user claims an alias, the extension calls `setMailRelay(bridgeRelayCommitment)` — authorizing that specific bridge to write email notifications.

### Inbox Manifest Format

Plaintext JSON on IPFS. Contains only CIDs and timestamps — **no sender metadata** (sensitive per user requirement).

```json
{
  "version": 1,
  "emails": [
    { "cid": "bafyrei...", "ts": 1709553600 },
    { "cid": "bafyrei...", "ts": 1709554200 }
  ]
}
```

The manifest is NOT encrypted because:
- The bridge must read it to append new entries
- It contains only opaque CID hashes + timestamps
- Actual email content is X25519-encrypted (ADR-008)
- CIDs alone reveal nothing about email content

### Extension Subscription

```typescript
// Watch for email count changes on user's VaultRegistry
providers.publicDataProvider
  .contractStateObservable(contractAddress, { type: 'latest' })
  .pipe(
    map(state => ledger(state.data)),
    distinctUntilChanged((prev, curr) =>
      prev.emailCount === curr.emailCount
    ),
  )
  .subscribe(state => {
    const manifestCid = state.inboxManifestCid;
    // Fetch manifest from IPFS, compare with local cache, download new emails
  });
```

### Gas / DUST Model

- Bridge wallet holds NIGHT token balance
- NIGHT balance passively generates DUST (Midnight's gas token)
- Each `notifyNewMail` transaction costs DUST — effectively free as long as the bridge wallet has sufficient NIGHT
- No "sponsored transaction" mechanism needed — bridge pays its own gas from generated DUST

---

## Alternatives Considered

### Option A1: Counter + Latest CID Only (REJECTED)

Store only `emailCount` + `latestEmailCid` on-chain. No manifest.

**Rejected because:** If multiple emails arrive between extension polls, only the latest CID is visible. Older emails are lost.

### Option B: IPFS-Based Polling — No On-Chain Component (REJECTED)

Bridge maintains inbox manifest on IPFS. Extension polls Pinata API for latest manifest.

**Rejected because:**
- Requires extension to have Pinata API credentials (secret management concern)
- No stable pointer to latest manifest without IPNS (slow, unreliable) or on-chain reference
- Not future-proof for bridge decentralization

### Option C: Bridge WebSocket/SSE Push (REJECTED)

Bridge pushes notifications to extension via WebSocket.

**Rejected because:**
- Requires persistent connection — breaks when extension is closed
- Still needs persistent storage for catch-up (back to needing a manifest)
- Not decentralization-ready — tied to centralized bridge

### Option E: Bridge Database + REST API (REJECTED)

Bridge stores inbox in its own database. Extension polls REST endpoint.

**Rejected because:**
- Least decentralized — bridge DB is single point of trust
- Bridge decentralization would require database migration
- Doesn't leverage existing blockchain infrastructure

---

## Consequences

### Positive

- Reactive notifications via RxJS Observable (no polling)
- Decentralization-ready — any authorized relay can call `notifyNewMail`
- On-chain audit trail of email delivery
- Reuses established commitment-based authorization pattern
- Gas effectively free via DUST generation from NIGHT balance
- Spam-proof — only owner-authorized relay can write

### Negative

- Bridge becomes a full Midnight client (wallet, proof server, private state)
- One on-chain transaction per notification batch (mitigated by batching)
- Manifest CID visible on public ledger (acceptable — just a pointer to encrypted data)
- Relay key rotation requires all users to re-authorize (acceptable for MVP)

### Design Decisions Requiring Story Updates

| # | Decision | Story Impact |
|---|----------|-------------|
| 1 | Bridge is full Midnight client | Story 5.3 scope increase — needs provider setup, wallet management |
| 2 | Manifest CID as `Opaque<'string'>` on public ledger | Story 5.6 contract design — not hash, actual CID |
| 3 | No sender metadata in manifest | Story 5.6 manifest schema — CID + timestamp only |
| 4 | Bridge batches notifications per user | Story 5.6 AC — configurable batch window |
| 5 | AliasRegistry stores VaultRegistry contract address | Story 5.1 AC — `claimAlias` takes contract address |
| 6 | Relay authorization via `setMailRelay()` | New AC in Story 5.0 or 5.2 — authorize bridge during alias setup |

### Scalability Considerations

- **Per-email cost:** One manifest update (IPFS re-pin) + one on-chain tx per batch
- **Batching:** Bridge collects emails per user for configurable window (default 30-60s), then one tx
- **100 emails/day per user:** ~100 IPFS operations + ~100 txs (no batching) or fewer with batching
- **10,000 users:** Monitor DUST generation rate vs. tx volume; increase NIGHT balance if needed

### Race Condition Handling

Bridge serializes email processing per user with a queue. One `notifyNewMail` tx at a time per VaultRegistry contract. Failed txs (state contention) are retried with updated manifest.

---

## Related Documents

- [ADR-008](adr-008-email-encryption-x25519.md) — X25519 hybrid encryption for email content
- [ADR-001](adr-001-smtp-infrastructure.md) — SMTP Infrastructure (Mox + Express)
- [Implementation Readiness Report](_bmad-output/project-planning-artifacts/implementation-readiness-report-2026-03-04.md) — C2 finding
- [Midnight SDK: PublicDataProvider](https://docs.midnight.network) — `contractStateObservable()` API
- [VaultRegistry Contract](packages/blockchain/contract/src/vault-registry.compact) — existing commitment patterns
