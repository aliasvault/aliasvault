# Sprint Change Proposal — Epic 5 Story Updates

**Date:** 2026-03-05
**Project:** aliasvault
**Author:** Bob (Scrum Master)
**Trigger:** Implementation Readiness Review (2026-03-04/05)
**Scope:** Moderate — Backlog reorganization

---

## Section 1: Issue Summary

Epic 5 (Alias Email System) stories were written before Epics 1-4 revealed Midnight SDK constraints. An Implementation Readiness Review identified 6 issues (3 Critical, 3 Major) making stories unimplementable as written. All issues resolved via ADR-008 (X25519 encryption), ADR-009 (on-chain notification), and Midnight MCP research. Stories need updating to reflect these decisions.

### Issues Addressed

| # | Issue | Resolution | Stories Affected |
|---|-------|-----------|-----------------|
| C1 | No public key infrastructure (RSA-OAEP assumed) | ADR-008: X25519 hybrid encryption | 5.5, 5.6, 5.7 + new 5.0 |
| C2 | Event model undefined (no Solidity events in Compact) | ADR-009: Ledger mutation + contractStateObservable | 5.1, 5.3, 5.6 |
| C3 | Sponsored transactions unvalidated | Bridge pays own gas via DUST from NIGHT balance | 5.6 |
| M1 | SQLite references (Rule 23 violation) | VaultJson/localStorage/IndexedDB | 5.2, 5.8 |
| M2 | getPublicKey() no implementation path | Superseded by ADR-008 (emailPublicKey: Bytes<32>) | 5.5 → 5.0 |
| M3 | Compact String type + NIGHT fee assumptions | Opaque<'string'>, NIGHT fee deferred to post-MVP | 5.1 |

---

## Section 2: Impact Analysis

**Epic impact:** Scope unchanged. User outcome identical. 8 stories modified + 1 new story (5.0) added.
**PRD impact:** None. FR20-FR24 unchanged.
**Architecture impact:** Section 5 encryption strategy superseded by ADR-008/009. ADRs are source of truth.
**No rollback needed.** Epic 5 has no implementation code yet.

---

## Section 3: Recommended Approach

**Direct Adjustment.** Modify story text in epics.md. Add Story 5.0. Update dependency graph and implementation order. No scope reduction, no rollback.

---

## Section 4: Detailed Change Proposals

### NEW — Story 5.0: Email Keypair & Relay Authorization

**Rationale:** ADR-008 requires X25519 keypair per user. ADR-009 requires relay authorization. Foundation for email encryption and notification.

```markdown
#### Story 5.0: Email Keypair & Relay Authorization

**As a** user
**I want** an encryption keypair generated for my vault and the email relay authorized
**So that** the SMTP bridge can encrypt emails only I can read, and deliver notifications to my vault

**Acceptance Criteria:**
- [ ] X25519 keypair generated client-side during vault creation (or lazily on first alias claim)
- [ ] Public key (32 bytes) stored on-chain via `VaultRegistry.setEmailPublicKey(pubKey: Bytes<32>)`
- [ ] Private key stored in vault blob (VaultJson `emailKeyPair.privateKey`)
- [ ] `setMailRelay(relayCommitment: Bytes<32>)` circuit added to VaultRegistry (owner-only)
- [ ] `notifyNewMail(manifestCid: Opaque<'string'>)` circuit added to VaultRegistry (relay-only)
- [ ] `emailPublicKey: Bytes<32>`, `emailCount: Counter`, `inboxManifestCid: Opaque<'string'>`, `mailRelay: Bytes<32>` ledger variables added
- [ ] Relay commitment pattern uses domain separator `"vault:relay:"` (consistent with owner/backup patterns)
- [ ] Unit tests: setEmailPublicKey (owner-only), setMailRelay (owner-only), notifyNewMail (relay-only, unauthorized rejected)
- [ ] Existing VaultRegistry tests still pass

**Technical Notes:**
- Use `tweetnacl` (`nacl.box.keyPair()`) for X25519 key generation
- Relay commitment: `persistentCommit<Bytes<32>>(pad(32, "vault:relay:"), rk)` — same pattern as ownerCommitment/backupCommitment
- Bridge publishes its relay commitment publicly; extension calls `setMailRelay()` during alias setup
- See ADR-008 and ADR-009 for full design

**Dependencies:** Epic 2 (VaultRegistry must exist)
```

---

### Story 5.1: AliasRegistry Smart Contract

**Issues addressed:** M3 (Opaque<'string'>, NIGHT fee deferred), C2/ADR-009 (store contract address)

**OLD ACs:**
- [ ] `claimAlias(localPart: String, domain: String)` registers alias to caller's wallet
- [ ] `getOwner(localPart: String, domain: String)` returns owner wallet (public) or null
- [ ] `releaseAlias(localPart: String, domain: String)` removes ownership (owner only)
- [ ] Anti-squatting: claim requires 1 NIGHT fee (transferred to protocol wallet)

**NEW ACs:**
- [ ] `claimAlias(aliasHash: Bytes<32>, contractAddr: Opaque<'string'>)` registers alias to caller's wallet with VaultRegistry contract address
- [ ] `getOwner(aliasHash: Bytes<32>)` returns owner commitment or default (public)
- [ ] `getContractAddress(aliasHash: Bytes<32>)` returns owner's VaultRegistry contract address
- [ ] `releaseAlias(aliasHash: Bytes<32>)` removes ownership (owner only, verified via commitment)
- [ ] Anti-squatting: deferred to post-MVP (DUST transaction cost provides baseline protection). See ZSwap `receiveShielded()` for future NIGHT fee implementation.

**OLD Technical Notes:**
- Use private state for alias-to-owner mapping (privacy)
- Witness function for ownership queries

**NEW Technical Notes:**
- Compact uses `Opaque<'string'>` not `String`. Alias names hashed to `Bytes<32>` client-side (bridge and extension both hash `localPart@domain` → SHA-256)
- Alias-to-owner mapping uses `Map<Bytes<32>, Bytes<32>>` (aliasHash → ownerCommitment)
- Alias-to-contract mapping uses `Map<Bytes<32>, Opaque<'string'>>` (aliasHash → VaultRegistry contract address)
- Owner identity verified via commitment pattern (same as VaultRegistry)
- See ADR-009 for why contract address is needed (bridge must find user's VaultRegistry)

**OLD Dependencies:** Epic 2 (VaultRegistry must exist for public key lookup)
**NEW Dependencies:** Story 5.0 (VaultRegistry email extensions must exist)

---

### Story 5.2: Alias Generation UI

**Issues addressed:** M1 (SQLite → VaultJson), M3 (NIGHT fee deferred), ADR-009 (setMailRelay)

**OLD ACs (changed lines only):**
- [ ] Display NIGHT fee before confirmation

**NEW ACs:**
- [ ] ~~Display NIGHT fee before confirmation~~ (Removed — NIGHT fee deferred to post-MVP)
- [ ] On first alias claim: call `setMailRelay(bridgeRelayCommitment)` on user's VaultRegistry to authorize the bridge

**OLD Technical Notes:**
- Call `AliasRegistry.claimAlias()` via Midnight SDK
- Store alias locally in SQLite for quick lookup

**NEW Technical Notes:**
- Call `AliasRegistry.claimAlias()` via Midnight SDK
- Store alias locally in VaultJson (as credential entry with `type: 'alias'` metadata) or IndexedDB alias index
- Bridge's relay commitment is a well-known public value (published by bridge operator)
- Extension checks if `mailRelay` is set on user's VaultRegistry; if not, calls `setMailRelay()` before claiming alias

---

### Story 5.3: SMTP Bridge Service

**Issues addressed:** C2/ADR-009 (full Midnight client, relay key, batching)

**OLD ACs:**
- [ ] Express TypeScript service at `smtp-bridge/`
- [ ] `POST /receive-email` webhook endpoint
- [ ] Extract alias from `to` header
- [ ] Query `AliasRegistry.getOwner()` via Midnight SDK
- [ ] Return 404 if alias not registered
- [ ] Return 200 with encrypted email CID on success
- [ ] Rate limiting: max 100 emails/minute per alias
- [ ] Email size limit: 5MB max
- [ ] Health check endpoint: `GET /health`
- [ ] Prometheus metrics: emails received, errors, latency

**NEW ACs:**
- [ ] Express TypeScript service at `services/smtp-bridge/`
- [ ] Full Midnight client setup: wallet provider, proof server, private state (LevelDB), ZK config from compiled VaultRegistry contract
- [ ] Bridge wallet holds NIGHT balance for DUST generation (gas)
- [ ] Bridge relay secret key stored in private state; relay commitment derived and published
- [ ] `POST /receive-email` webhook endpoint
- [ ] Extract alias from `to` header, hash to `Bytes<32>`
- [ ] Query `AliasRegistry.getOwner()` to verify alias is registered
- [ ] Query `AliasRegistry.getContractAddress()` to find owner's VaultRegistry
- [ ] Read `emailPublicKey` from owner's VaultRegistry public ledger
- [ ] Encrypt email with X25519 hybrid encryption (ADR-008), upload to IPFS
- [ ] Update inbox manifest on IPFS (append CID + timestamp, no sender metadata)
- [ ] Call `notifyNewMail(manifestCid)` on owner's VaultRegistry (authorized via relay key)
- [ ] Per-user serialization queue: one `notifyNewMail` tx at a time per VaultRegistry
- [ ] Configurable batch window (default 30s): collect emails per user, then single manifest update + tx
- [ ] Return 404 if alias not registered
- [ ] Return 200 with encrypted email CID on success
- [ ] Rate limiting: max 100 emails/minute per alias
- [ ] Email size limit: 5MB max
- [ ] Health check endpoint: `GET /health`
- [ ] Prometheus metrics: emails received, encryption errors, tx errors, latency

**OLD Technical Notes:**
- Use `@midnight-ntwrk/client-sdk` for RPC calls
- Cache public keys (TTL: 5 minutes) to reduce RPC calls
- See architecture section 5 for implementation reference

**NEW Technical Notes:**
- Use Midnight JS providers pattern (same as browser extension): publicDataProvider, privateStateProvider, proofProvider, walletProvider
- Cache alias→contractAddress and emailPublicKey (TTL: 5 minutes) to reduce RPC calls
- Bridge needs VaultRegistry ZK config (proving keys) to submit `notifyNewMail` transactions
- See ADR-008 for encryption flow, ADR-009 for notification flow
- Manifest format: `{ "version": 1, "emails": [{ "cid": "...", "ts": 1234567890 }] }` — no sender metadata

---

### Story 5.4: Mox SMTP Server Deployment

**No changes.** This story is unaffected by any of the 6 issues.

---

### Story 5.5: Email Encryption & IPFS Storage

**Issues addressed:** C1/ADR-008 (X25519 replaces RSA-OAEP), M2 (emailPublicKey from public ledger)

**OLD ACs:**
- [ ] Fetch owner's public key from `VaultRegistry.getPublicKey()`
- [ ] Encrypt email JSON with AES-256-GCM (random symmetric key)
- [ ] Encrypt symmetric key with owner's public key (RSA-OAEP)
- [ ] Package: `[encryptedKey][iv][authTag][encryptedBody]`
- [ ] Upload encrypted blob to Pinata IPFS
- [ ] Return CIDv1 (validate with `assertCIDv1()`)
- [ ] Handle attachments: include in JSON, encrypt together
- [ ] Max email size after encryption: 10MB

**NEW ACs:**
- [ ] Read owner's X25519 public key from VaultRegistry public ledger (`emailPublicKey: Bytes<32>`)
- [ ] Generate ephemeral X25519 keypair per email (forward secrecy)
- [ ] Derive shared secret via ECDH: `nacl.box.before(recipientPublicKey, ephemeralSecretKey)`
- [ ] Encrypt email JSON with NaCl `crypto_box` (X25519 + XSalsa20-Poly1305) or AES-256-GCM with derived key
- [ ] Package: `[ephemeralPublicKey (32B) | nonce (24B) | ciphertext]`
- [ ] Discard ephemeral secret key after encryption (forward secrecy)
- [ ] Upload encrypted blob to Pinata IPFS
- [ ] Return CIDv1 (validate with `assertCIDv1()`)
- [ ] Handle attachments: include in email JSON, encrypt together
- [ ] Max email size after encryption: 10MB

**OLD Technical Notes:**
- Reuse encryption patterns from `shared/logic/`
- See architecture section 5 "Encryption Strategy"

**NEW Technical Notes:**
- Use `tweetnacl` for X25519 ECDH + encryption (same library as Story 5.0)
- See ADR-008 for full encryption/decryption flow and code examples
- Forward secrecy: each email uses a unique ephemeral keypair; compromising user's private key does not expose past emails
- Email JSON schema: `{ from, to, subject, body, attachments: [{ name, contentType, base64 }], receivedAt }`

---

### Story 5.6: Email Notification via Contract

**Issues addressed:** C2/ADR-009 (ledger mutation), C3 (DUST gas model)

**OLD ACs:**
- [ ] `VaultRegistry.notifyNewMail(owner, emailCID)` function added
- [ ] Emits public event: `{ event: 'NewMail', owner: hash(wallet), timestamp }`
- [ ] CID stored in private state (owner can retrieve via witness)
- [ ] Contract-sponsored transaction (protocol pays gas)
- [ ] Extension polls for new mail events (every 60 seconds when active)
- [ ] Badge notification on extension icon when new mail

**NEW ACs:**
- [ ] `VaultRegistry.notifyNewMail(manifestCid: Opaque<'string'>)` circuit updates public ledger (relay-only, verified via `relayCommitment`)
- [ ] `emailCount: Counter` incremented on each notification (extension detects changes)
- [ ] `inboxManifestCid: Opaque<'string'>` updated with latest IPFS manifest CID (public ledger — user reads directly)
- [ ] Bridge pays transaction gas from DUST (generated by bridge wallet's NIGHT balance)
- [ ] Bridge batches notifications per user (configurable window, default 30s)
- [ ] Extension subscribes to `contractStateObservable()` on user's VaultRegistry — reactive push, not polling
- [ ] Extension detects `emailCount` change → reads `inboxManifestCid` → fetches manifest from IPFS → downloads new email CIDs
- [ ] Badge notification on extension icon when new mail detected
- [ ] Manifest format: `{ "version": 1, "emails": [{ "cid": "...", "ts": ... }] }` — no sender metadata

**OLD Technical Notes:**
- Bridge calls this after IPFS upload succeeds
- Use `sponsored: true` in transaction submission

**NEW Technical Notes:**
- No Solidity-style events in Compact — notification works via public ledger state mutation detected by `contractStateObservable()` (RxJS Observable from Midnight JS SDK)
- Bridge is authorized via relay commitment (ADR-009). Unauthorized callers rejected by circuit.
- See ADR-009 for full notification architecture, contract pseudocode, and extension subscription pattern

---

### Story 5.7: Email Viewing in Vault

**Issues addressed:** C1/ADR-008 (X25519 decryption), C2/ADR-009 (manifest from public ledger)

**OLD ACs:**
- [ ] "Inbox" tab in vault UI
- [ ] List view: shows from, subject, date (decrypted)
- [ ] Fetch email CIDs from `VaultRegistry` (witness function)
- [ ] Download encrypted blob from IPFS
- [ ] Decrypt using vault's private key
- [ ] Display email body (HTML sanitized, text fallback)
- [ ] Display attachments with download option
- [ ] Mark as read (local state)
- [ ] Delete email (unpin from IPFS, remove CID from contract)

**NEW ACs:**
- [ ] "Inbox" tab in vault UI
- [ ] List view: shows from, subject, date (decrypted from email content)
- [ ] Read `inboxManifestCid` from VaultRegistry public ledger
- [ ] Fetch inbox manifest from IPFS (plaintext JSON with CID + timestamp entries)
- [ ] Compare manifest against locally cached email CIDs to identify new emails
- [ ] Download encrypted email blobs from IPFS
- [ ] Decrypt using X25519: extract ephemeral public key (first 32B), derive shared secret with user's private key from VaultJson, decrypt with NaCl `crypto_box_open`
- [ ] Display email body (HTML sanitized, text fallback)
- [ ] Display attachments with download option
- [ ] Mark as read (local state in IndexedDB/localStorage)
- [ ] Delete email (unpin from IPFS — manifest update on next bridge write, or dedicated cleanup)

**OLD Technical Notes:**
- Decryption happens client-side only
- Use existing `EncryptionUtility` patterns

**NEW Technical Notes:**
- Decryption happens client-side only using `tweetnacl`
- User's X25519 private key is in VaultJson (`emailKeyPair.privateKey`)
- See ADR-008 for decryption flow
- Consider lightweight UX wireframe for Inbox tab — novel UI surface for this extension

---

### Story 5.8: Alias Management UI

**Issues addressed:** M1 (SQLite → VaultJson)

**OLD Technical Notes:**
- Call `AliasRegistry.releaseAlias()` for deletion
- Local SQLite cache for fast listing

**NEW Technical Notes:**
- Call `AliasRegistry.releaseAlias()` for deletion
- Alias list from VaultJson credential entries (type: 'alias') or IndexedDB alias index — no SQLite

---

### Updated Dependency Graph

```
Story 5.0 (Email Keypair & Relay Auth) ─── foundational
    └── Story 5.1 (AliasRegistry Contract)
            ├── Story 5.2 (Generation UI + setMailRelay)
            │       └── Story 5.8 (Management UI)
            └── Story 5.3 (SMTP Bridge — full Midnight client)
                    ├── Story 5.4 (Mox Deployment)
                    └── Story 5.5 (X25519 Encryption + IPFS)
                            └── Story 5.6 (On-Chain Notification)
                                    └── Story 5.7 (Email Viewing + X25519 Decrypt)
```

### Updated Implementation Order

1. **Story 5.0** — Email keypair + VaultRegistry contract extensions
2. **Story 5.1** — AliasRegistry contract
3. **Story 5.2** — Alias generation UI + relay authorization
4. **Story 5.3** — Bridge service (full Midnight client)
5. **Story 5.5** — X25519 encryption logic (can parallelize with 5.4)
6. **Story 5.4** — Mox deployment
7. **Story 5.6** — On-chain notification + manifest
8. **Story 5.7** — Email viewing UI
9. **Story 5.8** — Alias management UI

---

## Section 5: Implementation Handoff

**Change scope:** Moderate

**Handoff plan:**

| Role | Responsibility |
|------|---------------|
| **SM (Bob)** | Apply story edits to `epics.md`, add Story 5.0, update dependency graph + implementation order, run sprint planning to update `sprint-status.yaml` |
| **Dev (Amelia)** | Implement stories using ADR-008, ADR-009, readiness report, and updated story ACs |
| **Architect (Winston)** | Available for consultation on ADR-008/009 details if questions arise during implementation |

**Success criteria:**
- All 9 stories (5.0-5.8) in epics.md reflect ADR-008/009 decisions
- sprint-status.yaml updated with Story 5.0 and correct implementation order
- No references to RSA-OAEP, Solidity events, `sponsored: true`, SQLite, or `String` type remain in Epic 5

---

## Reference Documents

- [ADR-008: X25519 Hybrid Encryption](docs/architecture/adr-008-email-encryption-x25519.md)
- [ADR-009: On-Chain Email Notification](docs/architecture/adr-009-email-notification-on-chain.md)
- [Implementation Readiness Report](project-planning-artifacts/implementation-readiness-report-2026-03-04.md)
- [ADR-001: SMTP Infrastructure](docs/architecture/adr-001-smtp-infrastructure.md)
