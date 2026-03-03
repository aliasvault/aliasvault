# Sprint Change Proposal: Vault Format Migration (SQLite → JSON)

**Date:** 2026-03-02
**Triggered by:** Epic 4 pre-implementation architectural review
**Scope classification:** Moderate (backlog reorganization)
**Status:** APPROVED

---

## 1. Issue Summary

Architectural review of Epic 4 (Credential Management) discovered that the epic's merge stories were designed against the architecture's JSON vault model (`Map<CredentialID, Credential>` — Architecture Section 3, lines 335-388), but the actual vault implementation uses a legacy SQLite binary blob shipped to IPFS.

During Epic 2 implementation, the team reused `SqliteClient.exportToBase64()` as the fastest path to a working save/load flow. This carried forward the .NET/EF Core 8-table normalized schema (Aliases, Services, Credentials, Passwords, Attachments, TotpCodes, Passkeys, EncryptionKeys) — all with 1:1 relationships per credential that add complexity with zero benefit.

The architecture's `resolveVaultConflict()` pseudocode is directly incompatible with the SQLite blob format. Additionally, the `Credential` TypeScript type is missing `createdAt`/`updatedAt` fields that the merge logic depends on.

**Key evidence:**
- Architecture line 330: "Vault structure is a list/map of credentials, each with independent lifecycle"
- Gap analysis (`docs/gap-analysis.md` line 42): SQLite designated as "Offline Cache", not primary format
- `SqliteClient.createCredential()`: creates NEW Service and Alias per credential (1:1, not shared)
- No existing users — product is in development (Big Bang migration strategy)

---

## 2. Impact Analysis

### Epic Impact

| Epic | Impact | Details |
|------|--------|---------|
| **Epic 4** (Credential Management) | **Direct** | Add Story 4.0, simplify Stories 4.1-4.3 |
| **Epic 2** (Vault Sync) | **Internal** | VaultSyncService API unchanged; save/load internals switch from SQLite base64 to JSON |
| **Epic 3** (Guardian Recovery) | **None** | Already completed, no rollback needed |
| **Epic 5** (Alias Email) | **Beneficial** | JSON vault makes alias storage cleaner |

### Artifact Impact

| Artifact | Impact | Action |
|----------|--------|--------|
| `epics.md` | **Modified** | Epic 4 restructured with Story 4.0 added |
| `architecture.md` | **Needs update** | Save/load flow description, file tree, format decision |
| `project-context.md` | **Needs update** | New rule for JSON vault format |
| `sprint-status.yaml` | **Regenerate** | After epic update |
| PRD | **No change** | Format-agnostic requirements |
| UI/UX | **No change** | No UX spec; UI components access vault through React context |

### Technical Impact

| Component | Change |
|-----------|--------|
| `SqliteClient.ts` (1,611 lines) | **Replaced** by `VaultStore` (~300 lines) |
| `shared/vault-sql/` package (62.5KB) | **Removed** entirely |
| `sql.js` WASM (~500KB bundle) | **Removed** |
| `DbContext.tsx` | Type swap + init flow change |
| `VaultMessageHandler.ts` | 14 handler call sites updated |
| `useVaultMutate.ts` | `exportToBase64()` → `toJson()` |
| ~16 UI files | Mechanical rename `sqliteClient` → `vaultStore` |

---

## 3. Recommended Approach

**Selected: Direct Adjustment** — Modify Epic 4 within existing structure.

### Options Evaluated

| Option | Viable? | Notes |
|--------|---------|-------|
| **Option 1: Direct Adjustment** | **YES (selected)** | Add Story 4.0, simplify 4.1-4.3. Medium effort, low risk. |
| Option 2: Rollback | No | Unnecessary — VaultSyncService API stays the same |
| Option 3: MVP Review | No | Not a scope issue — technical format change only |

### Rationale
- No existing users = zero migration risk
- Architecture already designed for JSON = aligning implementation with intent
- Net code reduction: ~1,600 lines removed, ~300 lines added
- Bundle size reduction: ~500KB (sql.js WASM eliminated)
- 1:1 relationships per credential make denormalization trivial
- Merge logic becomes directly implementable per architecture pseudocode
- Future epics (5+) benefit from simpler vault format

---

## 4. Detailed Change Proposals

### Epic 4 in `epics.md` — DONE

**ADD Story 4.0: Vault Format Migration (SQLite → JSON)**
- `VaultJson`/`CredentialTree` types in `shared/vault-types/`
- `VaultStore` class with identical SqliteClient method signatures
- Updated save/load pipelines
- Remove sql.js WASM + shared/vault-sql
- Mechanical renames across UI files

**MODIFY Story 4.1: Credential Add/Edit Flow**
- OLD: Build new UI form, generate hash-based credential IDs, call `SqliteClient.execute()`
- NEW: Validate existing CRUD flows work with VaultStore, use UUID-based IDs

**MODIFY Story 4.2: Credential-Level Merge**
- OLD: `resolveVaultConflict(localVault, remoteVault)` (implied SQLite serialization)
- NEW: `resolveVaultConflict(localVault: VaultJson, remoteVault: VaultJson)` — direct JSON operation. Added Settings/EncryptionKeys merge. Added merge summary return type.

**MODIFY Story 4.3: Conflict Detection & UX**
- OLD: Fetch CID from `VaultRegistry.getVaultCID()` witness function
- NEW: Compare CID hash via loadProvider (existing pattern). Added `saveWithConflictCheck()` method. Documented race condition as known MVP limitation.

### Architecture document — PENDING (Architect handoff)

Sections to update:
- Save/load flow description (replace `exportToBase64()` references)
- File tree (remove `shared/vault-sql/`, add `shared/vault-types/`)
- Explicit decision record: "Vault format is JSON, not SQLite"

### project-context.md — PENDING (Architect handoff)

New rule: JSON vault format — vault blob on IPFS is a `VaultJson` JSON object, not a SQLite binary. `VaultStore` replaces `SqliteClient` for all local vault operations.

---

## 5. Implementation Handoff

### Scope: Moderate

| Role | Responsibility | Status |
|------|---------------|--------|
| **SM (Bob)** | Update epics.md, write change proposal | ✅ DONE |
| **Architect (Winston)** | Update architecture.md + project-context.md with format decision | ✅ DONE |
| **SM (Bob)** | Regenerate sprint-status.yaml | ✅ DONE |
| **Dev** | Implement stories via create-story workflow (4.0 → 4.1 → 4.2 → 4.3) | Story 4.0 ready-for-dev |

### Success Criteria
- [ ] Epics file updated with revised Epic 4 — ✅
- [ ] Sprint Change Proposal documented — ✅
- [x] Architecture document updated with JSON format decision — ✅
- [x] project-context.md updated with new rule (Rule 23) — ✅
- [x] sprint-status.yaml regenerated — ✅
- [x] Story 4.0 created and dev-ready — ✅
