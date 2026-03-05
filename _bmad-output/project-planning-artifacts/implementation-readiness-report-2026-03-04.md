# Implementation Readiness Assessment Report

**Date:** 2026-03-04
**Project:** aliasvault

---
stepsCompleted: [step-01-document-discovery, step-02-prd-analysis, step-03-epic-coverage, step-04-ux-alignment, step-05-epic-quality-review, step-06-final-assessment]
---

## Document Inventory

| Document | Path | Status |
|----------|------|--------|
| PRD | `_bmad-output/prd.md` | Found (whole) |
| Architecture | `_bmad-output/architecture.md` | Found (whole) |
| Epics & Stories | `_bmad-output/project-planning-artifacts/epics.md` | Found (whole) |
| UX Design | — | Not found |

**Notes:** No duplicates. No UX doc — acceptable for Epic 5 (backend-heavy email system).

## PRD Analysis

### Functional Requirements (Epic 5 Scope)

| FR | Text | Epic 5 Story |
|----|------|-------------|
| FR20 | Users can generate anonymous email aliases (`@alias.id`) | 5.1, 5.2 |
| FR21 | Users can customize alias names (e.g., `alex-trade-42@alias.id`) | 5.2 |
| FR22 | System can route incoming emails from aliases through the SMTP bridge | 5.3, 5.4 |
| FR23 | Users can view encrypted incoming emails in their vault | 5.7 |
| FR24 | Users can manage (create, view, delete) multiple aliases per vault | 5.8 |

### Functional Requirements (Already Implemented — Epics 1-4)

| FR | Status | Epic |
|----|--------|------|
| FR1-FR4 | Done | Epic 1 (Wallet Auth) |
| FR5-FR8 | Done | Epic 2 (Vault Storage & Sync) |
| FR9 | Done | Epic 4 (Credential Management) |
| FR10-FR15 | Done | Epic 3 (Guardian Recovery) |
| FR18-FR19 | Done | Epic 3 (Ownership Transfer) |

### Functional Requirements (Deferred — Post-MVP)

| FR | Text | Status |
|----|------|--------|
| FR16 | Multi-device install | Partially done (extension + guardian portal) |
| FR17 | Push notifications for security events | Post-MVP |
| FR25-FR29 | Protocol Ops Monitoring | Post-MVP |

### Non-Functional Requirements (Epic 5 Relevant)

| NFR | Text | Relevance |
|-----|------|-----------|
| NFR4 | AES-256-GCM encryption before IPFS | Applies to email encryption (Story 5.5) |
| NFR9 | IPFS > 99.9% availability | Applies to encrypted email blobs |
| NFR12 | Zero personal data on-chain/IPFS | Critical: email content must be encrypted |
| NFR14 | E2E encrypted notification channels | Applies to email notification (Story 5.6) |

### Additional Requirements (Architecture — Epic 5 Relevant)

| AR | Text | Story |
|----|------|-------|
| AR7 | AliasRegistry contract for email alias management | 5.1 |
| AR19 | Initialize Express TypeScript service for SMTP bridge | 5.3 |
| AR20 | Integrate Mox SMTP + Midnight RPC for alias ownership verification | 5.3, 5.4 |

### PRD Completeness Assessment

The PRD is complete for Epic 5 scope. FR20-FR24 fully cover the alias email system user stories. Architecture Section 5 provides detailed pseudocode for the SMTP bridge, encryption strategy, Mox integration, and Docker deployment. ADR-001 documents the SMTP infrastructure decision (Mox over existing C# SmtpServer).

**No gaps identified between PRD requirements and Epic 5 story coverage.**

## Epic Coverage Validation

### Full FR Coverage Matrix

| FR | PRD Requirement | Epic Coverage | Status |
|----|----------------|---------------|--------|
| FR1 | Wallet connect to create vault identity | Epic 1 (Story 1.2) | Done |
| FR2 | Sign challenges to unlock vault | Epic 1 (Story 1.3) | Done |
| FR3 | On-chain vault registration | Epic 1 (Story 1.4) | Done |
| FR4 | Verify vault via block explorer | Epic 1 (Story 1.5) | Done |
| FR5 | Encrypt credentials with Master Password | Epic 2 (Story 2.3) | Done |
| FR6 | Store encrypted vault on IPFS | Epic 2 (Story 2.2, 2.3) | Done |
| FR7 | Update vault metadata on Midnight | Epic 2 (Story 2.3) | Done |
| FR8 | Decrypt and view credentials < 2s | Epic 2 (Story 2.4) | Done |
| FR9 | Manually add new credentials | Epic 4 (Story 4.1) | Done |
| FR10 | Configure Guardian wallet | Epic 3 (Story 3.1) | Done |
| FR11 | Initiate recovery via wallet signature | Epic 3 (Story 3.4) | Done |
| FR12 | 72-hour time-lock on recovery | Epic 3 (Story 3.1) | Done |
| FR13 | Claim backup key after time-lock | Epic 3 (Story 3.4) | Done |
| FR14 | Decrypt vault with claimed key + new password | Epic 3 (Story 3.4) | Done |
| FR15 | Cancel active recovery | Epic 3 (Story 3.1) | Done |
| FR16 | Multi-device install | Partial (extension + portal) | Partial |
| FR17 | Push notifications for security events | Post-MVP | Deferred |
| FR18 | Transfer vault ownership | Epic 3 (Story 3.6) | Done |
| FR19 | Invalidate recovery on ownership transfer | Epic 3 (Story 3.6) | Done |
| FR20 | Generate anonymous email aliases | **Epic 5 (Story 5.1, 5.2)** | Planned |
| FR21 | Customize alias names | **Epic 5 (Story 5.2)** | Planned |
| FR22 | Route emails through SMTP bridge | **Epic 5 (Story 5.3, 5.4)** | Planned |
| FR23 | View encrypted emails in vault | **Epic 5 (Story 5.7)** | Planned |
| FR24 | Manage aliases (create, view, delete) | **Epic 5 (Story 5.8)** | Planned |
| FR25-FR29 | Protocol Ops Monitoring | Post-MVP | Deferred |

### AR Coverage (Epic 5 Relevant)

| AR | Text | Story | Status |
|----|------|-------|--------|
| AR7 | AliasRegistry contract | Story 5.1 | Planned |
| AR19 | Express TypeScript SMTP bridge | Story 5.3 | Planned |
| AR20 | Mox + Midnight RPC for alias verification | Story 5.3, 5.4 | Planned |

### Missing Requirements

**No FRs missing from epics.** All 29 FRs are either:
- Implemented (FR1-FR15, FR18-FR19): 17 FRs — Done
- Planned for Epic 5 (FR20-FR24): 5 FRs — Ready
- Deferred post-MVP (FR16 partial, FR17, FR25-FR29): 7 FRs — Documented

### Coverage Statistics

- Total PRD FRs: 29
- FRs implemented (Epics 1-4): 17 (59%)
- FRs planned (Epic 5): 5 (17%)
- FRs deferred (Post-MVP): 7 (24%)
- **Epic 5 coverage: 100% of FR20-FR24 mapped to stories**

## UX Alignment Assessment

### UX Document Status

**Not Found.** No UX design document exists for this project.

### Alignment Issues

None — UX has been addressed organically through existing browser extension patterns (Epics 1-4 reused the existing AliasVault 1.0 UI framework).

### Warnings

**WARNING: Epic 5 has 3 UI-facing stories without UX spec:**
- **Story 5.2** (Alias Generation UI) — "Generate Alias" button, custom name input, fee display, validation feedback
- **Story 5.7** (Email Viewing in Vault) — "Inbox" tab, list view, email body display, attachment download
- **Story 5.8** (Alias Management UI) — "Aliases" tab, list/search/filter, release confirmation dialog

These stories reference UI elements in their acceptance criteria but there's no wireframe or UX flow document to guide implementation. The existing extension UI patterns (credential list, settings tabs) provide a reasonable foundation, but the **email inbox** (Story 5.7) is a novel UI paradigm for this application — it may benefit from lightweight wireframing before implementation.

**Recommendation:** Consider creating a brief UX sketch for Story 5.7 (Inbox tab) before implementation, as it's the most complex new UI surface. Stories 5.2 and 5.8 can likely follow existing patterns (form + list).

## Epic Quality Review

### Epic 5 Best Practices Checklist

- [x] Epic delivers user value ("generate anonymous email aliases, receive emails, manage aliases")
- [x] Epic can function independently (builds on completed Epics 1-4)
- [ ] Stories appropriately sized — **ISSUES FOUND**
- [x] No forward dependencies to future epics
- [ ] Database/storage references current — **STALE REFERENCES**
- [ ] Clear acceptance criteria — **ARCHITECTURAL GAPS**
- [x] Traceability to FRs maintained (FR20-FR24)

---

### CRITICAL VIOLATIONS

#### C1: Encryption Model Mismatch — No Public Key Infrastructure (Stories 5.5, 5.6, 5.7)

**RESOLVED — See [ADR-008](docs/architecture/adr-008-email-encryption-x25519.md)**

**Problem:** Architecture assumed RSA-OAEP keypairs that don't exist. Actual system is symmetric-only (Argon2id + AES-256-GCM).

**Decision:** X25519 (Curve25519 ECDH) + AES-256-GCM hybrid encryption. 32-byte public key stored on-chain as `Bytes<32>`. Forward secrecy via ephemeral keys per email. Private key stored in vault blob (VaultJson).

**Action:** New Story 5.0 required for keypair generation + `setEmailPublicKey()` contract circuit. Stories 5.5-5.7 updated to use X25519 instead of RSA-OAEP.

#### C2: `notifyNewMail` Event Model Undefined (Story 5.6)

**RESOLVED — See [ADR-009](docs/architecture/adr-009-email-notification-on-chain.md)**

**Problem:** Compact has no Solidity-style `emit event`. Story 5.6 AC referenced undefined event mechanism.

**Decision:** On-chain notification via ledger state mutation (Option A2). Bridge maintains an IPFS inbox manifest (CID + timestamp per email, no sender metadata). Manifest CID stored on public ledger as `Opaque<'string'>` + `emailCount: Counter`. Extension watches state changes via `contractStateObservable()` RxJS Observable. Bridge authorized via relay commitment pattern (same as owner/backup wallet commitments).

**Key design decisions:**
1. Bridge is a full Midnight client (wallet + proof server + private state)
2. Manifest CID stored as `Opaque<'string'>` on public ledger (not hash — user needs actual CID)
3. Manifest is plaintext JSON (CID + timestamp only — no sender metadata). Email content is X25519-encrypted.
4. Bridge serializes + batches notifications per user (concurrency + scalability)
5. AliasRegistry must store VaultRegistry contract address per alias (lookup chain)
6. Relay key rotation: acceptable for MVP — users re-authorize on next extension open

**Actions:** Story 5.1 AC updated (store contract address). Story 5.3 scope increased (full Midnight client). Story 5.6 ACs rewritten (ledger mutation + observable, not events).

#### C3: Contract-Sponsored Transactions Unvalidated (Story 5.6)

**RESOLVED — Superseded by ADR-009 gas model.**

**Problem:** Story 5.6 assumed `sponsored: true` flag for contract-sponsored transactions. No such mechanism confirmed in Midnight SDK.

**Decision:** No sponsorship needed. The bridge holds its own NIGHT token balance, which passively generates DUST (Midnight's gas token). The bridge pays its own transaction fees from generated DUST. This is the standard Midnight fee model — no special sponsorship mechanism required.

**Action:** Remove `sponsored: true` references from Story 5.6 ACs. Bridge wallet NIGHT balance management added to Story 5.3 operational scope.

---

### MAJOR ISSUES

#### M1: SQLite References — Rule 23 Violation (Stories 5.2, 5.8)

**Action required — story update needed.**

Story 5.2 technical notes: "Store alias locally in **SQLite** for quick lookup"
Story 5.8 technical notes: "Local **SQLite** cache for fast listing"

**Rule 23** (from project-context.md): "Never use SQLite, binary blobs, or any non-JSON format for the vault stored on IPFS. VaultStore replaces SqliteClient."

**Fix:** Update stories to use VaultJson credentials (aliases stored as credential entries with type metadata) or a separate alias index in localStorage/IndexedDB.

#### M2: `VaultRegistry.getPublicKey()` Has No Implementation Path (Story 5.5)

**RESOLVED — Superseded by ADR-008.**

The original `getPublicKey()` witness is replaced by a public ledger variable `emailPublicKey: Bytes<32>` set via `setEmailPublicKey()` circuit (X25519 public key). Implementation path is in new Story 5.0 (keypair generation + contract circuit).

#### M3: `AliasRegistry` Contract Assumptions Need Midnight SDK Validation (Story 5.1)

**RESOLVED — Midnight MCP research completed.**

Findings:
- **`String` type:** Compact uses `Opaque<'string'>`, not `String`. `Map<Opaque<'string'>, Bytes<32>>` is valid for alias→owner mapping. Update Story 5.1 ACs to use `Opaque<'string'>`.
- **Token transfers:** Compact supports `receiveShielded()` / `sendShielded()` via ZSwap standard library. A "1 NIGHT fee" is technically feasible but adds significant ZSwap coin handling complexity.
- **Anti-squatting recommendation:** For MVP, defer the NIGHT fee mechanism. The DUST cost of the transaction itself provides lightweight anti-squatting. Add NIGHT fee as a post-MVP enhancement once ZSwap patterns are better understood.

**Fix:** Update Story 5.1 ACs to use `Opaque<'string'>`, defer NIGHT fee to post-MVP, note ZSwap feasibility for future.

---

### MINOR CONCERNS

#### L1: Story 5.3 SDK Import Pattern Stale

Technical notes reference `@midnight-ntwrk/client-sdk` directly. Per Rule 19, TSX components cannot import contract packages directly. The SMTP bridge is a Node.js service (not TSX), so Rule 19 doesn't apply directly, but the SDK import pattern should be validated against current Midnight SDK documentation.

#### L2: Epic 5 Dependency Graph Has a Long Critical Path

```
5.1 → 5.3 → 5.5 → 5.6 → 5.7
```

This is a 5-story serial chain. Stories 5.2 and 5.8 are on a parallel branch, but the email pipeline is deeply sequential. Consider if any stories can be parallelized or stubbed.

#### L3: No Error Handling Stories

None of the 8 stories mention error recovery scenarios:
- What happens if IPFS is down when an email arrives?
- What if the Midnight RPC is unreachable during alias claim?
- What if email encryption fails?

These should be captured in ACs or a cross-cutting concern story.

---

## Summary and Recommendations

### Overall Readiness Status

**READY (with story updates)** — All 3 critical architectural gaps have been resolved via ADR-008, ADR-009, and Midnight MCP research. Epic 5 stories need updating to reflect the new architecture before implementation begins.

### Critical Issues — ALL RESOLVED

| # | Issue | Resolution | ADR |
|---|-------|-----------|-----|
| C1 | No public key infrastructure | X25519 + AES-256-GCM hybrid encryption | [ADR-008](docs/architecture/adr-008-email-encryption-x25519.md) |
| C2 | Event model undefined | On-chain ledger state mutation + `contractStateObservable` | [ADR-009](docs/architecture/adr-009-email-notification-on-chain.md) |
| C3 | Sponsored transactions unvalidated | Bridge pays own gas via DUST (generated from NIGHT balance) | Covered in ADR-009 |

### Major Issues — Status

| # | Issue | Status | Action |
|---|-------|--------|--------|
| M1 | SQLite references (Stories 5.2, 5.8) | **Open** | Update to VaultJson/localStorage when rewriting stories |
| M2 | `getPublicKey()` no implementation path | **Resolved** | Superseded by ADR-008 (`emailPublicKey: Bytes<32>`) |
| M3 | Compact `String` type + token transfers | **Resolved** | Use `Opaque<'string'>`, defer NIGHT fee to post-MVP |

### Remaining Actions Before Implementation

1. **Rewrite Epic 5 stories** to incorporate ADR-008 (X25519), ADR-009 (on-chain notification + relay authorization), and fix stale references (SQLite → VaultJson, `String` → `Opaque<'string'>`, remove `sponsored: true`)
2. **Add Story 5.0** — "Email Keypair Generation & On-Chain Public Key" (X25519 keypair + `setEmailPublicKey()` circuit + `setMailRelay()` circuit)
3. **Update Story 5.1** — AliasRegistry must store VaultRegistry contract address per alias; use `Opaque<'string'>` for alias names; defer NIGHT fee to post-MVP
4. **Update Story 5.3** — Bridge is a full Midnight client (wallet + proof server + private state); includes relay key management
5. **Update Story 5.6** — Replace Solidity-style events with ledger mutation + `contractStateObservable`; add batching; manifest format (CID + timestamp, no sender metadata)
6. **Consider lightweight UX wireframe** for Story 5.7 (Inbox tab) — most novel UI surface in this epic

### What's Solid

- FR20-FR24 coverage is complete — all 5 email FRs map to stories
- Story dependency graph is logical (5.0 → 5.1 → 5.2/5.3 → 5.4/5.5 → 5.6 → 5.7/5.8)
- SMTP bridge architecture (Section 5) well-documented with pseudocode
- ADR-001 (Mox over C# SmtpServer) is sound
- Epics 1-4 provide a solid foundation — wallet auth, IPFS, conflict resolution all working
- All architectural gaps resolved with Midnight MCP-validated decisions

### Final Note

This assessment identified **9 issues** across **3 severity categories** (3 Critical, 3 Major, 3 Minor). All critical and 2 of 3 major issues have been resolved through architectural decisions documented in ADR-008 and ADR-009. The remaining work is **story-level updates** — no further architectural decisions are needed. Epic 5 is ready for story rewriting and implementation.

**Assessor:** Winston (Architect Agent)
**Date:** 2026-03-05
