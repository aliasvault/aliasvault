---
stepsCompleted: [1]
inputDocuments:
  - c:\Users\ozi3o\Documents\projects\blockchain\aliasvault\_bmad-output\prd.md
  - c:\Users\ozi3o\Documents\projects\blockchain\aliasvault\_bmad-output\architecture.md
project_name: 'aliasvault'
user_name: 'Ozi3o'
date: '2026-01-11'
---

# aliasvault - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for aliasvault, decomposing the requirements from the PRD and Architecture into implementable stories for the decentralized password manager with Midnight blockchain integration.

## Requirements Inventory

### Functional Requirements

**Wallet-Based Authentication:**
- FR1: Users can connect their Cardano wallet (Lace/Nami) to create a vault identity
- FR2: Users can sign cryptographic challenges with their wallet to unlock their vault
- FR3: System can create an on-chain vault registration on Midnight blockchain upon first connection
- FR4: Users can verify their vault ownership via the Midnight block explorer

**Vault Operations:**
- FR5: Users can encrypt their credentials locally using a Master Password
- FR6: Users can store encrypted vault data on IPFS
- FR7: Users can update vault metadata on Midnight when vault state changes
- FR8: Users can decrypt and view their stored credentials in under 2 seconds
- FR9: Users can manually add new credentials (service name, username, password, notes)

**Guardian Recovery Protocol:**
- FR10: Users can configure a Guardian wallet during initial setup
- FR11: Users can initiate a password recovery request via their wallet signature
- FR12: System can enforce a 72-hour time-lock on recovery requests
- FR13: Users can claim an encrypted vault backup key from the Guardian contract after time-lock expires
- FR14: Users can use the claimed backup key to decrypt their vault and set a new Master Password
- FR15: Users can cancel an active recovery request with their wallet signature

**Multi-Device Security & Notifications:**
- FR16: Users can install AliasVault on multiple devices (work laptop, tablet, etc.)
- FR17: System can send push notifications to all user devices when security events occur
- FR18: Users can transfer vault ownership to a new wallet address
- FR19: System can invalidate previous recovery requests when ownership is transferred

**Alias Generation & Management:**
- FR20: Users can generate anonymous email aliases (`@alias.id`)
- FR21: Users can customize alias names (e.g., `alex-trade-42@alias.id`)
- FR22: System can route incoming emails from aliases through the SMTP bridge
- FR23: Users can view encrypted incoming emails in their vault
- FR24: Users can manage (create, view, delete) multiple aliases per vault

**Protocol Infrastructure Monitoring (Admin/Ops):**
- FR25: Ops team can monitor IPFS pinning health across distributed nodes
- FR26: Ops team can view Guardian contract activity (recovery requests, completions, cancellations)
- FR27: Ops team can track vault registry statistics (mints, updates)
- FR28: Ops team can trigger re-pinning jobs for degraded nodes
- FR29: Ops team can detect suspicious on-chain patterns (e.g., rapid ownership transfers)

### Non-Functional Requirements

**Performance:**
- NFR1: Vault decryption must complete in < 2 seconds after Master Password entry
- NFR2: Onboarding flow (connect wallet → mint vault) must complete in < 30 seconds
- NFR3: Guardian Recovery claim transaction must confirm in < 30 seconds

**Security:**
- NFR4: All vault data must be encrypted using AES-256-GCM before IPFS upload
- NFR5: Master Password derivation must use Argon2id (resistant to GPU attacks)
- NFR6: Smart contracts must pass external audit with 0 Critical vulnerabilities
- NFR7: ZK-proof circuits must be formally verified before mainnet deployment
- NFR8: Recovery requests must enforce a minimum 72-hour time-lock

**Reliability & Availability:**
- NFR9: IPFS pinning strategy must achieve > 99.9% availability
- NFR10: System must support multi-region IPFS pinning (minimum 3 redundant nodes)
- NFR11: Midnight blockchain connectivity must gracefully handle node failures

**Data Privacy & Compliance:**
- NFR12: Zero personal data stored on-chain or in IPFS metadata
- NFR13: GDPR "right to be forgotten" supported via IPFS unpin + key deletion
- NFR14: Multi-device notifications must use end-to-end encrypted channels

**Browser Extension Compatibility:**
- NFR15: Extension must support Chrome v100+ and Brave v1.40+
- NFR16: Extension package size must be < 5MB

### Additional Requirements (from Architecture)

**Starter Template & Project Structure:**
- AR1: Use hybrid architecture - existing WXT browser extension + MeshJS Midnight starter template
- AR2: Clone MeshJS/midnight-starter-template into `packages/blockchain` folder
- AR3: Use Compact language (v0.27+) for all Midnight contracts
- AR4: Integrate contract build artifacts into browser extension

**Smart Contract Architecture:**
- AR5: VaultRegistry contract with private state for CID storage (never disclosed on public ledger)
- AR6: GuardianRecovery contract with 2-of-3 threshold and dual-layer encryption
- AR7: AliasRegistry contract for email alias management
- AR8: Witness functions for private state access by wallet owner

**IPFS Integration:**
- AR9: Use Pinata managed pinning service for MVP
- AR10: Configure multi-region redundancy (US East, EU West, Asia Pacific)
- AR11: Maintain local IndexedDB cache as offline fallback

**Conflict Resolution:**
- AR12: Implement credential-level merge with last-write-wins for same credential updates
- AR13: Client-side conflict detection before saving

**Guardian Recovery (Enhanced):**
- AR14: Backup wallet time-lock (72-hour delay) for catastrophic loss recovery
- AR15: Guardian rotation without password change
- AR16: Multi-backup wallet support (up to 3)
- AR17: Recovery key rotation (recommended every 12 months)
- AR18: Guardian notification protocol via IPFS portal

**SMTP Bridge:**
- AR19: Initialize Express TypeScript service for SMTP bridge
- AR20: Integrate Mox SMTP server with Midnight RPC client for alias ownership verification

### FR Coverage Map

| FR | Epic | Description |
|----|------|-------------|
| FR1-FR4 | Epic 1 | Wallet Authentication |
| FR5-FR8 | Epic 2 | Vault Storage & Sync |
| FR9 | Epic 4 | Credential Management |
| FR10-FR15 | Epic 3 | Guardian Recovery |
| FR17 | Post-MVP | Push Notifications |
| FR18-FR19 | Epic 3 | Ownership Transfer |
| FR20-FR24 | Epic 5 | Alias Email (TBD) |
| FR25-FR29 | Post-MVP | Protocol Ops Monitoring |

---

## Epic List

### Epic 1: Project Foundation & Wallet Authentication ✅ APPROVED

**User Outcome:** Developers have a working monorepo with Midnight contracts scaffolded, and users can authenticate with their Cardano wallet instead of username/password.

#### What's NEW (must build)

| Item | Evidence | Scope |
|------|----------|-------|
| MeshJS Midnight Starter integration | AR1-AR4 | Clone template, setup `packages/blockchain/` |
| Lace/Nami wallet connection | FR1 | New `WalletService.ts` (replace SRP) |
| Wallet signature challenge | FR2 | New flow - sign message to prove ownership |
| On-chain vault registration | FR3 | VaultRegistry.compact contract (stub) |
| Block explorer verification link | FR4 | UI component linking to Midnight explorer |

#### What EXISTS (reuse)

| Item | Evidence | Status |
|------|----------|--------|
| `EncryptionUtility.ts` | 359 lines, Argon2id + AES-GCM | ✅ Keep unchanged |
| `SqliteClient.ts` | 1612 lines, local vault cache | ✅ Keep unchanged |
| UI components | `browser-extension/src/entrypoints/` | ✅ Keep unchanged |

#### What TRANSFORMS (modify)

| Item | Current | Target |
|------|---------|--------|
| `WebApiService.ts` | SRP auth to .NET server | Wallet auth (remove SRP flow) |

**FRs Covered:** FR1, FR2, FR3, FR4
**ARs Covered:** AR1, AR2, AR3, AR4

---

#### Story 1.1: MeshJS Midnight Starter Integration

**As a** developer  
**I want** a working Midnight contract development environment in the monorepo  
**So that** I can build and test the blockchain components

**Acceptance Criteria:**
- [x] MeshJS template cloned to `packages/blockchain/` *(DEVIATION: Used official midnightntwrk/example-counter v2.0.2)*
- [x] Compact compiler (v0.27+) configured *(Compact CLI 0.4.0, language >= 0.20)*
- [x] `pnpm build` succeeds for blockchain package
- [x] Sample contract compiles without errors

---

#### Story 1.2: Wallet Connection (Lace only)

**As a** user  
**I want** to connect my Cardano wallet (Lace/Nami)  
**So that** I can authenticate without a username/password

**Acceptance Criteria:**
- [x] ~~Wallet selection modal shows available wallets~~ *(DESCOPED: Single Lace button — Nami doesn't support Midnight)*
- [x] User can connect Lace wallet
- [x] ~~User can connect Nami wallet~~ *(DESCOPED: Nami has no Midnight support)*
- [x] Wallet address is displayed after connection
- [x] Connection persists across browser sessions

> **Shared Component:** This wallet connection logic is reused by Story 3.3 (Guardian Portal) and Story 5.2 (Alias Generation UI).

---

#### Story 1.3: Wallet Signature Challenge

**As a** user  
**I want** to sign a challenge with my wallet  
**So that** I can prove ownership of my Identity and unlock my vault

**Acceptance Criteria:**
- [x] System generates unique challenge message
- [x] Wallet prompts user to sign message *(signData with connection-proof fallback)*
- [x] ~~Signature is verified client-side~~ *(DEFERRED: Lace signData API not fully stable; authMethod field tracks verification level)*
- [x] Failed signature shows error message
- [x] Successful signature proceeds to unlock flow *(sets isVerified=true; full vault unlock in Epic 2)*

---

#### Story 1.4: VaultRegistry Contract Stub

**As a** developer  
**I want** to deploy a basic VaultRegistry contract  
**So that** I can start registering vault owners on-chain

**Acceptance Criteria:**
- [x] VaultRegistry.compact contract scaffolded
- [x] `registerVault(walletAddress)` function implemented
- [x] Contract deploys to Midnight testnet *(deployed to local network)*
- [x] Registration transaction succeeds

---

#### Story 1.5: Block Explorer Link

**As a** user  
**I want** to see my vault registration on the block explorer  
**So that** I can verify my data is truly decentralized

**Acceptance Criteria:**
- [x] Dev check: Verify Midnight block explorer URL availability
- [x] UI component checks for explorer URL config
- [x] If available: Show "Verify on Explorer" link
- [x] If unavailable: Hide link gracefully
- [x] Link opens correct address on explorer

---

#### Story 1.6: Remove SRP Auth Flow

**As a** developer  
**I want** to remove the legacy SRP authentication  
**So that** the codebase relies purely on wallet authentication

**Acceptance Criteria:**
- [x] **DELETE:** All SRP-related code in `WebApiService.ts`
- [x] **DELETE:** SRP encryption helpers in `EncryptionUtility.ts` *(SrpUtility.ts deleted — 151 lines)*
- [x] **DELETE:** SRP data models
- [x] New `WalletService.ts` created to handle auth state

---

### Epic 2: Midnight Smart Contracts & Vault Storage ✅ APPROVED

**User Outcome:** Users' encrypted vaults are stored on IPFS with the CID managed in Midnight private state. Vault saves and retrievals work through the blockchain instead of the .NET server.

#### What's NEW (must build)

| Item | Evidence | Scope |
|------|----------|-------|
| **VaultRegistry.compact** | AR5, Architecture section 4 | Contract with private state for CID, public state for owner/timestamp |
| **Witness function `getVaultCID()`** | AR8 | Wallet-signed retrieval of private CID |
| **IPFS upload to Pinata** | AR9-AR10, FR6 | New `IpfsService.ts` with multi-region pinning |
| **CIDv1 type guard** | `project-context.md` Rule 2 | `assertCIDv1()` enforcement before contract storage |
| **Contract deployment CLI** | AR3 (MeshJS template) | Scripts in `packages/blockchain/cli/` |

#### What EXISTS (reuse)

| Item | Evidence | Status |
|------|----------|--------|
| `EncryptionUtility.symmetricEncrypt()` | Already uses AES-256-GCM | ✅ Vault encryption unchanged |
| `SqliteClient.exportToBase64()` | Line 119 | ✅ Export vault blob for IPFS upload |
| `shared/config/contracts.ts` | `project-context.md` Rule 4 | ✅ Pattern exists for address management |

#### What TRANSFORMS (modify)

| Item | Current | Target |
|------|---------|--------|
| Vault save flow | `WebApiService.ts` → POST to .NET | New `VaultSyncService.ts` → IPFS + Midnight |
| Vault load flow | GET from .NET → `SqliteClient.initializeFromBase64()` | Midnight witness → IPFS fetch → SQLite |

**FRs Covered:** FR5, FR6, FR7, FR8
**ARs Covered:** AR5, AR8, AR9, AR10, AR11

---

#### Story 2.1: VaultRegistry Smart Contract

**As a** user  
**I want** a smart contract that securely stores my vault's IPFS CID in private state  
**So that** only I can access my data location

**Acceptance Criteria:**
- [x] Contract tracks `owner` (public) and `vaultCidHash` (public) — **Deviation:** CID hash (SHA-256, Bytes<32>) stored on public ledger, not full CID in private state. Full CID stored at application layer (too large for Bytes<32>). ADR-006.
- [x] `updateVault(newCidHash)` function (only owner can call) — **Deviation:** Takes CID hash (Bytes<32>), not raw CID string. Owner auth via `persistentCommit` pattern.
- [x] CID retrieval via app-layer `getVaultCID()` API — **Deviation:** NOT a witness function. Full CID stored in TypeScript Map, not Midnight private state. Private state holds only `secretKey` for owner auth.
- [x] `assertCIDv1` logic enforces CIDv1 format — canonical location: `contract/src/cid-utils.ts`
- [x] Unit tests for ownership access control — 16/16 tests including non-owner rejection via circuitContext injection

---

#### Story 2.2: IPFS Service (Pinata)

**As a** developer  
**I want** an IPFS service that uploads encrypted blobs to Pinata  
**So that** vault data is reliably stored and retrieval strings are generated

**Acceptance Criteria:**
- [x] `IpfsService.ts` created with Pinata SDK (`pinata` v1.10.1, unified SDK)
- [x] Feature: Upload `Uint8Array` → returns CIDv1 string
- [x] Feature: Download CID → returns `Uint8Array`
- [x] Error handling for network failures — `withRetry()` exponential backoff (3 retries, 1s base)
- [x] Validation: Returned CID must be CIDv1 — `assertCIDv1` from `@aliasvault/contract`
- [x] Provider abstraction: `IpfsProvider` interface enables swapping Pinata for any pinning service

---

#### Story 2.3: Vault Sync Logic (Save Flow)

**As a** user  
**I want** my vault encrypted and uploaded when I save  
**So that** my credentials are backed up on the blockchain network

**Acceptance Criteria:**
- [x] `SqliteClient.exportToBase64()` (existing) used to get blob
- [x] `EncryptionUtility.symmetricEncrypt()` (existing) used to encrypt blob
- [x] Upload encrypted blob to IPFS — via `PinataBrowserProvider` (browser-compatible REST API) + shared `VaultSyncService` (ADR-003)
- [x] Call `VaultRegistry.updateVault(cidHash)` on-chain — **Deviation:** sends SHA-256 hash of CID (Bytes<32>), not raw CID string
- [x] UI shows "Encrypting vault..." → "Syncing to blockchain..." → "Synced" status progression

---

#### Story 2.4: Vault Sync Logic (Load Flow)

**As a** user  
**I want** to fetch my latest vault when I open the app  
**So that** I see my up-to-date credentials across devices

**Acceptance Criteria:**
- [ ] Call `VaultRegistry.getVaultCID()` (Story 2.1)
- [ ] Download blob from IPFS (Story 2.2)
- [ ] Decrypt blob with local key
- [ ] Import into SQLite via `SqliteClient.initializeFromBase64()` (existing)
- [ ] Handle "No vault found" case (new user)

---

#### Story 2.5: Contract Deployment Scripts

**As a** dev  
**I want** scripts to deploy contracts to Testnet  
**So that** CI/CD can automate updates

**Acceptance Criteria:**
- [ ] `deploy.ts` script in `packages/blockchain/cli`
- [ ] Script outputs contract address to `shared/config/contracts.ts`
- [ ] Instructions in README for running deployment

---

#### Story 2.6: VaultRegistry Contract Full Specification

**As a** developer  
**I want** a consolidated specification for all VaultRegistry functions  
**So that** implementations across epics are consistent

**VaultRegistry.compact Functions:**
- `registerVault(walletAddress)` - Epic 1.4
- `updateVault(cid)` - Epic 2.1
- `getVaultCID()` witness - Epic 2.1
- `storeRecoveryKeyHash(keyHash)` - Epic 3.2 _(ADR-007: stores SHA-256(shamirSecret) for verification; actual key is ephemeral)_
- ~~`getRecoveryKey()` witness~~ _(ADR-007: removed — recovery key derived from Shamir shares during recovery)_
- `transferOwnership(newOwnerCommitment)` - Epic 2.6 _(contract done; UI descoped from MVP — Story 3.5 descoped)_
- `addBackupWallet(walletCommitment, currentTime)` - Epic 3.6 _(modified: Map-based with registration timestamp)_
- `backupTransfer(newOwnerCommitment)` - Epic 3.6 _(replaces initiateBackupTransfer + executeBackupTransfer; maturity-based fast path)_
- `removeBackupWallet(walletCommitment)` - Epic 3.6
- `getPublicKey(wallet)` witness - Epic 5.5
- `notifyNewMail(owner, emailCID)` - Epic 5.6

**Acceptance Criteria:**
- [x] All functions documented in contract header — 80-line spec header + VAULT-REGISTRY-SPEC.md canonical doc
- [x] Access control matrix defined (owner-only vs public vs witness) — in contract header + SPEC.md
- [x] State variables: owner (public), vaultCID (private), recoveryKey (private), backupWallets (private), emailCIDs (private)
  - **Deviation (Story 2.6):** `recoveryKeyHash` and `backupWallets` are on the **public ledger**, not private state. Compact has no `private state {}` block — all private state is TypeScript-only (ADR-006). Only the *hash* of the recovery key is stored on-chain; the actual key is ephemeral — derived from Shamir shares during recovery (ADR-007, Pattern 6 v2). `emailCIDs` deferred to Epic 5.
- [x] Unit tests for each function — 33 VR tests (1 skipped due to simulator block-time limitation)

> **Note:** This story consolidates contract work from Epics 1-5. Implement incrementally per epic.

### Epic 3: Recovery & Breach Defense ✅ APPROVED

**User Outcome:** Users can recover from password loss via trusted guardians, AND defend against wallet compromise by transferring ownership to a backup wallet. Both are MVP-critical security features.

#### Part A: Guardian Recovery (Lost Password)

##### What's NEW (must build)

| Item | Evidence | Scope |
|------|----------|-------|
| **GuardianRecovery.compact** | AR6, FR10-FR15 | Smart contract with 2-of-3 threshold |
| **72-hour time-lock** | FR12, NFR8 | Contract enforces wait before share claim |
| **Shamir Secret Sharing** | AR6 | Add `secrets.js-34r7h` to dependencies |
| **Dual-layer encryption** | Architecture 4.4, `project-context.md` Rule 1 | Recovery key encrypts password, then Shamir splits |
| **Guardian portal** | AR18 | Static web app for guardians to approve requests |
| **Guardian configuration UI** | FR10 | Extension UI to add 3 guardian wallet addresses |
| **Recovery initiation** | FR11 | Wallet-signed request starts time-lock |
| **Share claiming** | FR13, FR14 | After 72h, claim shares and reconstruct password |
| **Recovery cancellation** | FR15 | Owner can cancel malicious recovery attempts |

##### What EXISTS (reuse)

| Item | Evidence | Status |
|------|----------|--------|
| `EncryptionUtility.encryptWithPublicKey()` | Line 182-207 | ✅ RSA-OAEP for encrypting shares |
| `EncryptionUtility.decryptWithPrivateKey()` | Line 209-239 | ✅ Decrypt guardian's share |
| `EncryptionUtility.symmetricEncrypt()` | Line 49-87 | ✅ AES-GCM for recovery key encryption |

#### Part B: Backup Wallet Transfer (Lost/Compromised Wallet)

##### What's NEW (must build)

| Item | Evidence | Scope |
|------|----------|-------|
| **Maturity-based backup transfer** | FR18, AR14 | Backup wallets registered 72h+ can transfer immediately |
| **Backup wallet registration UI** | AR14-AR16 | UI to configure backup wallet commitments |
| **Contract modification** | AR14 | `backupWallets` Set→Map (add registration timestamps), new `backupTransfer` circuit |

##### What EXISTS (reuse)

| Item | Evidence | Status |
|------|----------|--------|
| VaultRegistry backup circuits | Epic 2.6 | ✅ Modify: Set→Map, add maturity check, remove initiate/cancel flow |
| `transferOwnership` circuit | Epic 2.6 | ✅ Stays in contract (no UI — Story 3.5 descoped) |

**FRs Covered:** FR10, FR11, FR12, FR13, FR14, FR15, FR18, FR19
**ARs Covered:** AR6, AR14, AR15, AR16, AR17, AR18

---

#### Story 3.1: Guardian Smart Contract

**As a** user  
**I want** a contract to manage my recovery guardians with a 72-hour time-lock  
**So that** I can safely recover my account if I lose my password

**Acceptance Criteria:**
- [ ] `GuardianRecovery.compact` contract scaffolded
- [ ] `addGuardians(wallets[])` stores guardian wallet hashes
- [ ] `initiateRecovery()` starts 72h timer, emits event
- [ ] `claimShares()` fails before 72h, succeeds after
- [ ] `cancelRecovery()` for owner to cancel malicious attempts
- [ ] Unit tests for timer logic and access control

---

#### Story 3.2: Shamir Secret Splitting (Pattern 6 v2)

**As a** user setting up guardians
**I want** to encrypt my Master Password with an ephemeral key derived from a Shamir secret, then split that secret into shares
**So that** no single guardian can access my password and recovery works cross-device

**Acceptance Criteria (ADR-007 — Pattern 6 v2):**
- [x] Generate ephemeral Shamir secret (32 bytes, random) — never stored
- [x] Derive encryption key via `SHA-256("aliasvault:rk:" + hex(shamirSecret))`
- [x] Encrypt `MasterPassword` with derived key (AES-256-GCM) → `EncryptedPassword`
- [x] Shamir-split the secret (not encrypted password) into 3 shares (2-of-3 threshold) using `secrets.js-34r7h`
- [x] Encrypt each share with respective Guardian's RSA public key (RSA-OAEP-SHA256)
- [x] Bundle `EncryptedPassword` + encrypted shares into single IPFS package (v2 format)
- [x] Store `SHA-256(CID)` on-chain via `GuardianRecovery.storeSharesCidHash()`
- [x] Store `SHA-256(hex(shamirSecret))` on-chain via `VaultRegistry.storeRecoveryKeyHash()` for verification

---

#### Story 3.3: Guardian Portal

**As a** guardian  
**I want** a web interface to approve recovery requests  
**So that** I can help my friend regain access

**Acceptance Criteria:**
- [ ] Standalone Vite app at `services/guardian-portal/`
- [ ] Connect Wallet button (check if wallet is a guardian)
- [ ] Display "Pending Requests" list
- [ ] "Approve" action: signs approval transaction
- [ ] 72h countdown timer displayed

---

#### Story 3.4: Recovery Claim Flow (Pattern 6 v2)

**As a** user recovering my account
**I want** to reconstruct the Shamir secret from guardian shares, then derive the key and decrypt my password
**So that** I can recover my Master Password on any device

**Acceptance Criteria (ADR-007 — Pattern 6 v2):**
- [ ] UI monitors `GuardianRecovery` for approval events
- [ ] Once 2+ shares approved and 72h time-lock expired: Fetch IPFS package (contains encrypted password + encrypted shares)
- [ ] Decrypt 2+ shares with guardian private keys
- [ ] Recombine shares using Shamir combine → Get `shamirSecret`
- [ ] Verify `SHA-256(hex(shamirSecret))` matches on-chain `recoveryKeyHash` (integrity check)
- [ ] Derive encryption key: `SHA-256("aliasvault:rk:" + hex(shamirSecret))`
- [ ] Decrypt `encryptedPassword` from IPFS package with derived key → Get `MasterPassword`
- [ ] Display recovered password (user copies or resets)

---

#### ~~Story 3.5: Ownership Transfer~~ — DESCOPED

> **Descoped:** Direct ownership transfer (`transferOwnership`) remains in the contract (Story 2.6) but
> no UI will be built. Story 3.6's maturity-based backup transfer provides a fast path that
> eliminates the need for a separate direct-transfer UI. CLI access remains available if needed.

---

#### Story 3.6: Backup Wallet Configuration & Transfer

**As a** user
**I want** to pre-register backup wallets that can transfer ownership after a maturation period
**So that** I can recover my vault if I lose my primary wallet — instantly if the backup was set up in advance

**Contract changes required:** Story 2.6 implemented the original initiate-wait-execute flow. This story
modifies the contract to use a simpler maturity-based model (see below).

**Design — maturity-based time-lock:**
- `backupWallets` changes from `Set<Bytes<32>>` to `Map<Bytes<32>, Uint<64>>` (commitment → registration timestamp)
- `addBackupWallet(walletCommitment, currentTime)` records when each backup wallet was registered
- A backup wallet registered for **72h+** can call `backupTransfer(newOwnerCommitment)` **immediately** — no initiation step
- A backup wallet registered for **< 72h** cannot transfer (must wait for maturation)
- Owner can `removeBackupWallet(commitment)` at any time to revoke a backup wallet before it matures
- `initiateBackupTransfer`, `cancelBackupTransfer`, `transferInitiatedAt`, `transferInitiator` are **removed** — the maturation period replaces the initiation flow

**Security rationale:** The 72h maturation window gives the owner time to notice and remove any
rogue backup wallet added by an attacker. Once a wallet has been registered for 72h+ without the
owner revoking it, it is considered trusted and can transfer immediately.

**Acceptance Criteria:**
- [x] Contract: `backupWallets` changed from `Set<Bytes<32>>` to `Map<Bytes<32>, Uint<64>>`
- [x] Contract: `addBackupWallet(walletCommitment, currentTime)` records registration time (validated via `blockTimeGte`)
- [x] Contract: `backupTransfer(newOwnerCommitment)` checks `registeredAt + 72h <= blockTime`, transfers ownership, clears backup wallets
- [x] Contract: Remove `initiateBackupTransfer`, `cancelBackupTransfer`, `transferInitiatedAt`, `transferInitiator`
- [x] Contract: Update `transferOwnership` to remove references to deleted state variables
- [x] Tests: Update all backup wallet tests for new Map-based design + maturity check
- [x] UI: Browser extension page to add/remove backup wallet commitments
- [x] UI: Display backup wallet list with maturation status (time remaining or "ready")
- [x] UI: Backup wallet holder can execute transfer if wallet is mature

---

#### Story 3.7: Guardian Portal Production Build & Provider Wiring

**As a** developer deploying the guardian portal
**I want** `vite build` to produce a working production bundle with full Midnight provider wiring
**So that** the portal can be pinned to IPFS and guardians can execute `approveRecovery()` end-to-end

**Acceptance Criteria:**
- [ ] `vite build` succeeds — handles `ledger-v7` + `onchain-runtime-v2` ESM WASM imports via `vite-plugin-wasm`
- [ ] Production bundle loads correctly in browser (smoke test)
- [ ] `fs`/`path` externalization from `midnight-js-contracts` resolved or documented
- [ ] Verification checklist updated to include `vite build` for services
- [ ] `walletService.ts` enhanced to retain full Lace `ConnectedAPI` (not just address)
- [ ] All 4 stubbed providers in `midnightService.ts` replaced: `zkConfigProvider` (FetchZkConfigProvider), `privateStateProvider` (inMemory), `walletProvider` (Lace balanceUnsealedTransaction), `midnightProvider` (Lace submitTransaction)
- [ ] ZK circuit keys copied to public/ for FetchZkConfigProvider
- [ ] `approveRecovery()` circuit callable end-to-end through browser

**Technical Notes:**
- See full story file: `_bmad-output/implementation-artifacts/3-7-guardian-portal-production-build.md`
- Provider patterns researched across 8+ reference projects (Rule 18)
- Recommended order: last in Epic 3 (after 3.5, 3.6)

---

### Epic 4: Credential Management ✅ APPROVED (Revised 2026-03-02)

> [!NOTE]
> **Sprint Change Proposal (2026-03-02)**
>
> Architectural review discovered that Epic 4's merge stories were designed against the architecture's
> JSON vault model (`Map<CredentialID, Credential>`), but Epic 2 implemented the vault as a SQLite
> binary blob (legacy EF Core pattern). The 8-table normalized schema has 1:1 relationships per
> credential — the normalization adds complexity with zero benefit. With no existing users, the fix
> is to align the implementation with the architecture's original intent before starting merge work.
>
> **Decision:** Replace SQLite vault format with JSON (Architecture Option A). Add Story 4.0 as
> prerequisite. Net result: ~1,600 lines removed, ~300 lines added, 500KB bundle reduction.
>
> **Full proposal:** `_bmad-output/implementation-artifacts/sprint-change-proposal-2026-03-02.md`

**User Outcome:** Users can manually add/edit credentials with proper conflict resolution when syncing across devices.

#### What's NEW (must build)

| Item | Evidence | Scope |
|------|----------|-------|
| **Vault format migration (SQLite → JSON)** | Architecture Section 3 | Replace `SqliteClient` with `VaultStore`, define `VaultJson` types |
| **Credential add/edit validation** | FR9 | Verify existing CRUD works with new JSON store |
| **Credential-level merge** | AR12 | `resolveVaultConflict()` on `VaultJson` — direct, no serialize/deserialize |
| **Last-write-wins for same credential** | AR12 | `updatedAt` comparison on `CredentialTree` objects |
| **Client-side conflict detection** | AR13 | Pre-save CID check + auto-merge via `VaultSyncService` |

#### What EXISTS (reuse)

| Item | Evidence | Status |
|------|----------|--------|
| `EncryptionUtility.symmetricEncrypt()` | Line 49 | ✅ Vault encryption unchanged |
| `VaultSyncService` save/load pipeline | Story 2.3/2.4 | ✅ API unchanged, internals updated |
| `IpfsService.upload()` / `download()` | Story 2.2 | ✅ Unchanged |
| UI credential forms | Existing popup pages | ✅ Method signatures preserved |

#### What TRANSFORMS (modify)

| Item | Current | Target |
|------|---------|--------|
| Vault storage format | SQLite binary blob (8 relational tables) | JSON object (`VaultJson` with `CredentialTree` map) |
| Local vault store | `SqliteClient` (1,611 lines, sql.js WASM) | `VaultStore` (~300 lines, pure JS) |
| Save pipeline | `exportToBase64()` → encrypt → IPFS | `VaultStore.toJson()` → encrypt → IPFS |
| Load pipeline | decrypt → `initializeFromBase64()` | decrypt → `JSON.parse()` → `VaultStore.fromJson()` |
| Extension bundle | Includes sql.js WASM (~500KB) | WASM removed |

#### What's REMOVED (deleted)

| Item | Size | Reason |
|------|------|--------|
| `SqliteClient.ts` | 1,611 lines | Replaced by VaultStore |
| `shared/vault-sql/` package | 62.5KB SQL + migrations | No SQLite schema to manage |
| `sql.js` WASM binary | ~500KB in bundle | No SQLite runtime needed |
| EF Core migration system | ~200 lines date normalization SQL | No migrations needed |

**Removed from scope (post-MVP):**
- ~~FR17: Push notifications~~

**FRs Covered:** FR9
**ARs Covered:** AR12, AR13

---

#### Story 4.0: Vault Format Migration (SQLite → JSON)

**As a** developer
**I want** the vault stored as a JSON object instead of a SQLite binary
**So that** credential-level merge and conflict resolution can work as the architecture designed

**Acceptance Criteria:**
- [ ] `VaultJson` and `CredentialTree` types defined in new `shared/vault-types/` package
- [ ] `VaultStore` class implements all public methods from SqliteClient with identical signatures
- [ ] `DbContext.tsx` uses VaultStore (property renamed from `sqliteClient` to `vaultStore`)
- [ ] `VaultMessageHandler.ts` uses VaultStore for all handler functions
- [ ] Save flow: `VaultStore.toJson()` → `JSON.stringify()` → encrypt → IPFS → contract update
- [ ] Load flow: decrypt → `JSON.parse()` → `VaultStore.fromJson()` → working vault
- [ ] `useVaultMutate` calls `toJson()` instead of `exportToBase64()`
- [ ] Mechanical rename `sqliteClient` → `vaultStore` across ~16 UI files
- [ ] `sql.js` and `shared/vault-sql` dependencies removed from project
- [ ] Extension bundle size reduced (~500KB WASM eliminated)
- [ ] All existing credential CRUD operations pass (unit tests rewritten for VaultStore)
- [ ] Settings preserved in `vault.settings` (including `midnightSecretKey` per Rule 12)
- [ ] EncryptionKeys preserved in `vault.encryptionKeys`
- [ ] Passkey CRUD (by RpId, by CredentialId) works on JSON store
- [ ] `imgSrcFromBytes()` moved to standalone utility

**Technical Notes:**
- Alias and Service are 1:1 per Credential (never shared) — denormalization into `CredentialTree` is trivial
- Soft-delete (`isDeleted`) becomes a boolean field on `CredentialTree` — no `IsDeleted` column migration
- Credential IDs remain UUIDs (existing pattern preserved)
- No existing users — zero migration risk

**Source:** Architecture Section 3 (JSON vault design), Sprint Change Proposal 2026-03-02

**Dependencies:** None (enables all other Epic 4 stories)

---

#### Story 4.1: Credential Add/Edit Flow

**As a** user
**I want** to add or edit credentials in my vault
**So that** my login information is securely stored

**Acceptance Criteria:**
- [ ] Credential add form (service name, username, password, alias email, notes) works with VaultStore
- [ ] Credential edit form updates existing credential via VaultStore
- [ ] Credential delete sets `isDeleted: true` on CredentialTree
- [ ] `createdAt` and `updatedAt` timestamps set correctly on all CRUD operations
- [ ] On save: VaultStore mutation → vault sync → IPFS upload → contract update
- [ ] Success/error feedback in UI unchanged
- [ ] Credential IDs use UUIDs (existing `crypto.randomUUID()` pattern)

**Source:** FR9, Architecture Section 3

**Dependencies:** Story 4.0 (VaultStore must exist)

---

#### Story 4.2: Credential-Level Merge

**As a** user syncing from multiple devices
**I want** credential-level merge
**So that** I don't lose changes from other devices

**Acceptance Criteria:**
- [ ] Implement `resolveVaultConflict(localVault: VaultJson, remoteVault: VaultJson): MergeResult`
- [ ] New credentials on remote: add to merged vault
- [ ] Same credential modified on both sides: last-write-wins via `updatedAt` comparison
- [ ] Deletion conflicts: if local `isDeleted=true` but remote modified → remote wins (user can delete again)
- [ ] Simultaneous new credential with same service+username: both kept (different UUIDs)
- [ ] Settings merge: last-write-wins per key
- [ ] EncryptionKeys merge: union of all unique keys
- [ ] Return merge summary: `{ added: number, updated: number, conflicts: number }`
- [ ] Unit tests for all merge scenarios (add, update, delete conflict, simultaneous create)

**Source:** Architecture Section 3, lines 351-388, 395-401

**Dependencies:** Story 4.0 (VaultJson types must exist)

---

#### Story 4.3: Conflict Detection & UX

**As a** user saving my vault
**I want** to detect if the CID changed since I last loaded
**So that** I don't overwrite changes from another device

**Acceptance Criteria:**
- [ ] Before save: fetch current CID hash from VaultRegistry (via loadProvider)
- [ ] Compare with local `lastKnownCidHash`
- [ ] If same: save normally (no conflict)
- [ ] If different: download remote vault → decrypt → parse JSON → merge using Story 4.2 logic
- [ ] Show notification: "Changes merged: Added X credentials, updated Y credentials" (Architecture line 391)
- [ ] User reviews merged vault before final upload
- [ ] Option to force overwrite (advanced)
- [ ] `VaultSyncService` extended with `saveWithConflictCheck()` method

**Source:** Architecture Section 3, lines 389-401

**Dependencies:** Story 4.2 (merge logic), Story 2.3 (existing save flow)

**Known limitation (documented):** No atomic compare-and-swap on VaultRegistry. Race condition possible between CID check and save completion. Acceptable for MVP; CRDT-based merge deferred to V2.

---

#### Epic 4 Story Dependency Graph

```
Story 4.0 (Vault Format Migration)
    ├── Story 4.1 (Credential Add/Edit validation)
    └── Story 4.2 (Credential-Level Merge)
            └── Story 4.3 (Conflict Detection & UX)
```

---

#### Implementation Order (Recommended)

1. **Story 4.0** — Foundation: vault format migration (largest, enables everything)
2. **Story 4.1** — Validate existing credential flows with new store (small, fast)
3. **Story 4.2** — Core merge logic, pure functions (medium)
4. **Story 4.3** — Wire merge into save flow + UX (medium)

### Epic 5: Alias Email System ✅ APPROVED

**User Outcome:** Users can generate anonymous email aliases (@alias.id), receive emails via SMTP, and manage their alias identities.

---

> [!NOTE]
> **Conflict Resolved (2026-01-11)**
> 
> **Decision:** Proceed with **Mox SMTP + Express TypeScript bridge** as originally proposed.
> 
> **Rationale:** Midnight SDK is TypeScript-only. The existing C# SmtpServer cannot integrate with Midnight contracts without significant workarounds.
> 
> **Full Decision Record:** [ADR-001: SMTP Infrastructure](file:///docs/architecture/adr-001-smtp-infrastructure.md)

---

**FRs Covered:** FR20, FR21, FR22, FR23, FR24
**ARs Covered:** AR7, AR19, AR20

---

#### Story 5.1: AliasRegistry Smart Contract

**As a** user  
**I want** my alias ownership recorded on-chain  
**So that** only I can receive emails to my aliases

**Acceptance Criteria:**
- [ ] `AliasRegistry.compact` contract deployed to Midnight testnet
- [ ] `claimAlias(localPart: String, domain: String)` registers alias to caller's wallet
- [ ] `getOwner(localPart: String, domain: String)` returns owner wallet (public) or null
- [ ] `releaseAlias(localPart: String, domain: String)` removes ownership (owner only)
- [ ] Anti-squatting: claim requires 1 NIGHT fee (transferred to protocol wallet)
- [ ] Alias names validated: 3-64 chars, alphanumeric + hyphen, no leading/trailing hyphen
- [ ] Unit tests for all contract functions
- [ ] Integration test: claim → getOwner → release flow

**Technical Notes:**
- Use private state for alias-to-owner mapping (privacy)
- Witness function for ownership queries

**Dependencies:** Epic 2 (VaultRegistry must exist for public key lookup)

---

#### Story 5.2: Alias Generation UI

**As a** user  
**I want** to generate a new email alias from my browser extension  
**So that** I can sign up for services without revealing my real email

**Acceptance Criteria:**
- [ ] "Generate Alias" button visible on extension popup
- [ ] Custom alias name input with real-time validation
- [ ] Auto-generate random alias option (e.g., `zk-tiger-7842@alias.id`)
- [ ] Display NIGHT fee before confirmation
- [ ] Wallet signature required to claim alias on-chain
- [ ] Success: show new alias, copy-to-clipboard button
- [ ] Error: display if alias already claimed

**Technical Notes:**
- Call `AliasRegistry.claimAlias()` via Midnight SDK
- Store alias locally in SQLite for quick lookup

**Dependencies:** Story 5.1 (AliasRegistry contract)

---

#### Story 5.3: SMTP Bridge Service

**As a** system  
**I want** to receive email webhooks and verify alias ownership  
**So that** only legitimate emails reach vault owners

**Acceptance Criteria:**
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

**Technical Notes:**
- Use `@midnight-ntwrk/client-sdk` for RPC calls
- Cache public keys (TTL: 5 minutes) to reduce RPC calls
- See architecture section 5 for implementation reference

**Dependencies:** Story 5.1 (AliasRegistry contract)

---

#### Story 5.4: Mox SMTP Server Deployment

**As a** DevOps engineer  
**I want** Mox configured to forward emails to the bridge  
**So that** `@alias.id` emails are processed by our system

**Acceptance Criteria:**
- [ ] Mox Docker container deployed
- [ ] `domains.conf` configured with IncomingWebhook to bridge
- [ ] SMTP ports 25 and 587 exposed
- [ ] TLS certificate configured (Let's Encrypt via ACME)
- [ ] SPF/DKIM/DMARC records documented
- [ ] MX record for `alias.id` domain points to Mox server
- [ ] Test: send email to `test@alias.id`, verify webhook received

**Technical Notes:**
```yaml
Accounts:
  aliasvault:
    IncomingWebhook:
      URL: http://smtp-bridge:3000/receive-email
      Authorization: Bearer ${BRIDGE_SECRET}
```

**Dependencies:** Story 5.3 (Bridge must exist to receive webhooks)

---

#### Story 5.5: Email Encryption & IPFS Storage

**As a** system  
**I want** to encrypt emails before storing them  
**So that** only the alias owner can read their mail

**Acceptance Criteria:**
- [ ] Fetch owner's public key from `VaultRegistry.getPublicKey()`
- [ ] Encrypt email JSON with AES-256-GCM (random symmetric key)
- [ ] Encrypt symmetric key with owner's public key (RSA-OAEP)
- [ ] Package: `[encryptedKey][iv][authTag][encryptedBody]`
- [ ] Upload encrypted blob to Pinata IPFS
- [ ] Return CIDv1 (validate with `assertCIDv1()`)
- [ ] Handle attachments: include in JSON, encrypt together
- [ ] Max email size after encryption: 10MB

**Technical Notes:**
- Reuse encryption patterns from `shared/logic/`
- See architecture section 5 "Encryption Strategy"

**Dependencies:** Story 5.3 (Bridge calls this after ownership verification)

---

#### Story 5.6: Email Notification via Contract

**As a** user  
**I want** to be notified when I receive email  
**So that** I know to check my vault

**Acceptance Criteria:**
- [ ] `VaultRegistry.notifyNewMail(owner, emailCID)` function added
- [ ] Emits public event: `{ event: 'NewMail', owner: hash(wallet), timestamp }`
- [ ] CID stored in private state (owner can retrieve via witness)
- [ ] Contract-sponsored transaction (protocol pays gas)
- [ ] Extension polls for new mail events (every 60 seconds when active)
- [ ] Badge notification on extension icon when new mail

**Technical Notes:**
- Bridge calls this after IPFS upload succeeds
- Use `sponsored: true` in transaction submission

**Dependencies:** Story 5.5 (Email must be on IPFS first)

---

#### Story 5.7: Email Viewing in Vault

**As a** user  
**I want** to read my encrypted emails in the vault  
**So that** I can see messages sent to my aliases

**Acceptance Criteria:**
- [ ] "Inbox" tab in vault UI
- [ ] List view: shows from, subject, date (decrypted)
- [ ] Fetch email CIDs from `VaultRegistry` (witness function)
- [ ] Download encrypted blob from IPFS
- [ ] Decrypt using vault's private key
- [ ] Display email body (HTML sanitized, text fallback)
- [ ] Display attachments with download option
- [ ] Mark as read (local state)
- [ ] Delete email (unpin from IPFS, remove CID from contract)

**Technical Notes:**
- Decryption happens client-side only
- Use existing `EncryptionUtility` patterns

**Dependencies:** Story 5.6 (Emails must be stored and notified)

---

#### Story 5.8: Alias Management UI

**As a** user  
**I want** to manage my aliases  
**So that** I can view, organize, and delete them

**Acceptance Criteria:**
- [ ] "Aliases" tab in vault settings
- [ ] List all owned aliases with creation date
- [ ] Show which credential/service uses each alias
- [ ] "Release Alias" button (returns alias to available pool)
- [ ] Confirmation dialog before release ("This cannot be undone")
- [ ] Released alias: emails sent to it will bounce
- [ ] Copy alias to clipboard
- [ ] Search/filter aliases

**Technical Notes:**
- Call `AliasRegistry.releaseAlias()` for deletion
- Local SQLite cache for fast listing

**Dependencies:** Story 5.2 (Aliases must be claimable first)

---

#### Epic 5 Story Dependency Graph

```
Story 5.1 (AliasRegistry Contract)
    ├── Story 5.2 (Generation UI)
    │       └── Story 5.8 (Management UI)
    └── Story 5.3 (SMTP Bridge)
            ├── Story 5.4 (Mox Deployment)
            └── Story 5.5 (Encryption + IPFS)
                    └── Story 5.6 (Notification)
                            └── Story 5.7 (Email Viewing)
```

---

#### Implementation Order (Recommended)

1. **Story 5.1** - Contract foundation
2. **Story 5.2** - Users can claim aliases
3. **Story 5.3** - Bridge service skeleton
4. **Story 5.5** - Encryption logic (can parallelize with 5.4)
5. **Story 5.4** - Mox deployment
6. **Story 5.6** - Notification mechanism
7. **Story 5.7** - Email viewing UI
8. **Story 5.8** - Alias management UI


