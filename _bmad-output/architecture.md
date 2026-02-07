---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - C:\Users\ozi3o\Documents\projects\blockchain\aliasvault\_bmad-output\prd.md
  - C:\Users\ozi3o\Documents\projects\blockchain\aliasvault\_bmad-output\project-planning-artifacts\product-brief-aliasvault-2025-12-26.md
  - C:\Users\ozi3o\Documents\projects\blockchain\aliasvault\PROPOSAL_DECENTRALIZED_VAULT.md
  - C:\Users\ozi3o\Documents\projects\blockchain\aliasvault\docs\project-knowledge-index.md
  - C:\Users\ozi3o\Documents\projects\blockchain\aliasvault\docs\data-models-server.md
  - C:\Users\ozi3o\Documents\projects\blockchain\aliasvault\docs\api-contracts-server.md
  - C:\Users\ozi3o\.gemini\antigravity\brain\72a5c30f-d3cf-413d-909c-af3b41483773\decentralization-transformation-map.md
  - C:\Users\ozi3o\.gemini\antigravity\brain\72a5c30f-d3cf-413d-909c-af3b41483773\architecture-clarifications.md
workflowType: 'architecture'
project_name: 'aliasvault'
user_name: 'Ozi3o'
date: '2025-12-26'
hasProjectContext: false
architectureDiscoveryComplete: true
migrationStrategy: 'big-bang'
status: 'complete'
completedAt: '2026-01-10'
lastStep: 8
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**

AliasVault requires 29 functional capabilities organized into six core domains:

1. **Wallet-Based Authentication (FR1-FR4):** Cardano wallet integration (Lace/Nami via Mesh SDK) for identity, cryptographic challenge signing for vault access, on-chain vault registration via Midnight smart contracts, and block explorer-based ownership verification.

2. **Vault Operations (FR5-FR9):** Client-side AES-256-GCM encryption with Master Password (unchanged from current architecture), IPFS storage for encrypted blobs with CID stored in Midnight private state, Midnight contract updates for access control, <2s decryption performance target, and manual credential management UI.

3. **Guardian Recovery Protocol (FR10-FR15):** Guardian wallet configuration with Shamir Secret Sharing for master password recovery, wallet-signed recovery requests, 72-hour time-lock enforcement via smart contract, encrypted backup key claims after time-lock expiry, Master Password reconstruction from guardian shares, and recovery cancellation capability.

4. **Multi-Device Security (FR16-FR19):** Cross-device vault synchronization via IPFS CID distribution through Midnight private state, push notifications for security events (recovery initiation, ownership transfer), ownership transfer to new wallet addresses for breach defense, and automatic recovery invalidation on ownership change.

5. **Alias Generation & Management (FR20-FR24):** Anonymous email alias creation via Alias Registry smart contract, customizable alias names with anti-squatting mechanisms (pricing + expiration), SMTP bridge routing with blockchain ownership verification, encrypted email storage on IPFS, and full alias lifecycle management through contract interactions.

6. **Protocol Infrastructure Monitoring (FR25-FR29):** IPFS pinning health dashboards for multi-region redundancy, Guardian contract activity tracking (recovery requests, completions, cancellations), vault registry analytics (mints, updates via on-chain events), degraded node re-pinning automation, and attack pattern detection via on-chain transaction analysis.

**Non-Functional Requirements:**

Critical NFRs that will drive architectural decisions:

- **Performance (NFR1-3):** <2s vault decryption (achieved via local caching + Midnight witness function CID retrieval), <30s onboarding (wallet connection → vault mint), <30s Guardian recovery claims (Midnight transaction finality)
- **Security (NFR4-8):** AES-256-GCM encryption (client-side, unchanged), Argon2id KDF (GPU-resistant, unchanged), smart contract audits (0 critical vulnerabilities requirement), formally verified ZK circuits before mainnet, immutable 72-hour time-locks (testnet configurable for development)
- **Reliability (NFR9-11):** >99.9% IPFS availability via Pinata/Web3.Storage multi-region pinning (minimum 3 geographies), graceful Midnight RPC failover to secondary endpoints
- **Privacy & Compliance (NFR12-14):** Zero PII on-chain/IPFS (CID stored in private state, never disclosed), GDPR "right to be forgotten" via IPFS unpin + cryptographic key deletion, E2E encrypted push notifications for security events
- **Platform (NFR15-16):** Chrome v100+ / Brave v1.40+ browser extensions, <5MB extension package size (thick client with Mesh SDK + IPFS client + proof generation)

**Scale & Complexity:**

- **Primary domain:** Full-stack blockchain application (Thick browser extension + Midnight Compact smart contracts + IPFS decentralized storage + SMTP bridge service)
- **Complexity level:** High
  - Cryptographic requirements: Dual-layer auth (wallet + master password), ZK-proof generation, Shamir Secret Sharing, time-locked recovery
  - Blockchain integration: Midnight private state management, contract-sponsored transactions (NIGHT/DUST quota), witness functions for CID access
  - Decentralized infrastructure: IPFS pinning strategy, multi-device CID distribution, RPC failover
  - Migration complexity: Brownfield-to-greenfield transformation (Big Bang - new product, no in-place upgrade)
- **Estimated architectural components:** 10 major components spanning client (thick), blockchain (contracts), storage (IPFS), and infrastructure (bridge) layers

### Technical Constraints & Dependencies

**Migration Strategy: Big Bang (Clean Break)**

AliasVault 2.0 launches as a new decentralized product. Existing centralized infrastructure (.NET server, PostgreSQL) remains operational during transition but is not integrated with new blockchain architecture. Users must export data from v1 and import into v2 wallet-based system.

**Current Architecture Being Replaced:**

- **Authentication:** SRP (Secure Remote Password) protocol → Wallet signing
- **Storage:** PostgreSQL (Vault table with revision-based optimistic locking) → IPFS (encrypted blobs) + Midnight (private state CID)
- **Identity:** Username/password accounts → Wallet addresses
- **Sync:** Server-enforced revision numbers → Client-side conflict detection (online-only saves)
- **Alias Registry:** SQL table (UNIQUE constraint) → Midnight smart contract (first-come-first-served + pricing)

**What Carries Forward:**

- **Encryption Logic:** 100% preserved - Argon2id + AES-256-GCM implementation remains identical (client-side)
- **UI/UX:** Vault views, item management, icons unchanged
- **Local Caching:** IndexedDB/SQLite offline cache (read-only, aggressive caching strategy)

**Technology Dependencies:**

- **Midnight Blockchain:** Mainnet Q4 2025 target; requires NIGHT token for protocol-sponsored transactions (DUST auto-generation from NIGHT)
- **Wallet Integration:** Lace wallet (Mesh SDK) as primary for MVP; supports Midnight natively
- **IPFS Pinning:** Pinata or Web3.Storage for multi-region redundancy; 750ms-4s latency requires aggressive client caching
- **SMTP Bridge:** Mox SMTP server + Node.js/Go service with Midnight RPC client library for alias ownership verification
- **ZK-Proof Generation:** Local proof server (Midnight SDK) runs on user's machine; proof size 5-6 KB regardless of vault data size

**Architectural Constraints:**

- **No Offline Saves:** Every vault update requires IPFS upload + Midnight transaction (internet + DUST/quota). Mitigation: local-first caching for reads, background sync for writes.
- **CID Stored in Private State:** IPFS CID never appears on public ledger - stored in Midnight private state (witness function access). Each device queries witness function to retrieve CID (still private to wallet owner).
- **Contract-Sponsored Transactions:** Protocol maintains NIGHT balance in Vault Registry contract; users receive 100 free transaction quota/year. After quota exhaustion, users must purchase NIGHT or pay protocol for sponsored transactions.
- **72-Hour Time-Lock Testing:** Separate testnet contract deployment with configurable time-lock parameter (5 minutes for testing, 72 hours for production).

### Cross-Cutting Concerns Identified

**1. State Synchronization & Conflict Resolution:** Midnight transactions are atomic (last-write-wins). Solution for MVP: client-side conflict detection before saving. Future (V2): CRDT for automatic merge.

**2. Offline Capability Degradation:** New architecture requires internet for all saves (IPFS upload + Midnight transaction). Mitigation: aggressive local caching for reads, online-only saves with error messaging.

**3. Guardian Recovery Mechanism:** Shamir Secret Sharing for master password recovery. 5 shares (threshold: 3 of 5), each guardian receives encrypted share in Midnight private state. 72-hour time-lock on recovery requests.

**4. Gas Economics & User Experience:** Contract-sponsored transactions via protocol-owned NIGHT balance. Users receive 100 free transaction quota/year. After quota: purchase NIGHT or pay protocol.

**5. IPFS + Midnight Hybrid Storage:** Encrypted vault blobs on IPFS (multi-device sync). IPFS CID in Midnight private state (never disclosed on public ledger). Provides metadata privacy + decentralized storage.

**6. SMTP Bridge Centralization:** MVP uses centralized Mox SMTP server + blockchain verification bridge. Post-MVP: tiered decentralization approach.

**7. Multi-Device CID Distribution:** Midnight private state accessible to wallet owner via witness functions across all devices. Each device queries contract with wallet signature to retrieve private CID.

**8. Alias Ownership & Anti-Squatting:** First-come-first-served + 1 NIGHT fee per alias claim. Future: expiration for unused aliases, tiered pricing for short names.

**9. ZK-Proof Generation Overhead:** Proofs are succinct (5-6 KB size regardless of vault data). Local proof server on user's machine. Benchmark during development to ensure <2s total vault save time.

**10. Auditability vs. Privacy:** Public on-chain events (timestamps, event types). Private via Midnight's selective disclosure. Wallet addresses hashed, CIDs never disclosed.

## Starter Template Evaluation

### Primary Technology Domain

**Browser Extension (Thick Client) + Blockchain Smart Contracts**

Based on project requirements analysis, the core development work spans three technology domains:
1. **Browser Extension:** Thick client with WXT + React + TypeScript (existing codebase at `apps/browser-extension`)
2. **Midnight Smart Contracts:** Compact language (TypeScript-like DSL) for VaultRegistry, GuardianRecovery, and AliasRegistry contracts
3. **SMTP Bridge Service:** Node.js/Go microservice for Mox integration with Midnight RPC client

### Starter Options Considered

### Starter Options Considered

**Option A: Build on Existing Extension Structure (Selected for Frontend)**

Leverage existing WXT + React browser extension codebase (`apps/browser-extension`). Given Big Bang migration strategy (new product, clean break from centralized v1) and requirement that UI/UX + encryption logic remain unchanged, modifying existing structure provides:
- Proven UI component library
- Established extension architecture (background service worker, content scripts, popup)
- Preserved encryption utilities (Argon2id + AES-256-GCM already implemented)
- Faster development via component reuse

**Option B: MeshJS Midnight Starter Template (Selected for Contracts)**

Evaluated `MeshJS/midnight-starter-template` (recommended by new Developer Guide).
- **Structure:** Monorepo with `contract/`, `cli/`, and `react/` directories.
- **Benefits:** Provides pre-configured Compact compiler setup, deployment scripts, and local network Docker configuration (`standalone-start`).
- **Fit:** Perfect for the Smart Contract and CLI layers, even if we assume we'll use our own frontend.

**Option C: Fresh WXT Starter**

Evaluated `pnpm create wxt@latest` for clean slate approach. Rejected for Frontend because it discards existing UI assets.

**Option D: SMTP Bridge Starter**

Selected simple Express TypeScript starter for minimal overhead for the Bridge service.

### Selected Approach: Hybrid Architecture

**Rationale for Selection:**

We will combine the best of both worlds:
1.  **Frontend**: Keep the existing `apps/browser-extension` (WXT) to preserve UI/UX and encryption logic.
2.  **Contracts & Deployments**: Adopt the `MeshJS/midnight-starter-template` structure for the `contracts/` and `cli/` folders. This gives us a production-ready Web3 scaffold without rewriting our client extension.

**Initialization Strategy:**

1.  **Project Restructuring**:
    -   Clone `MeshJS/midnight-starter-template` into the root or a `packages/blockchain` folder.
    -   Use its `contract/` folder for all Midnight Compact work.
    -   Use its `cli/` folder for deployment scripts.
    -   Discard its `react/` folder (we use `apps/browser-extension`).

2.  **Browser Extension Integration**:
    -   Refactor `apps/browser-extension`.
    -   Add dependencies: `@meshsdk/core`, `@meshsdk/react`, `ipfs-http-client`, `@midnight-ntwrk/compact-sdk`, `secrets.js-34r7h`.
    -   Integration: link build artifacts from `contracts/` into the extension.

3.  **SMTP Bridge**:
    -   Initialize independent service: `npx create-express-api smtp-bridge --typescript`.

**Architectural Decisions Provided by Starter (MeshJS):**
- **Contract Language**: Compact (v0.27+ as noted in guide).
- **Testing**: Local Docker stack (Node, Proof Server, Indexer) configured via `npm run standalone-start`.
- **Deployment**: CLI scripts for deploying to Local and Testnet (Preview).
- **Network Interaction**: Abstracts proof server interaction (Lace Wallet or public endpoint).

**Architectural Decisions NOT Provided by Starter:**
-   Wait for `Step 4` decisions (Private State, IPFS, etc.) - the starter provides the *tooling*, not the *app logic*.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
1. Midnight contract state model (private vs public CID storage)
2. IPFS pinning service selection and strategy
3. Guardian recovery configuration (threshold and share distribution)
4. SMTP bridge service architecture

**Important Decisions (Shape Architecture):**
1. Conflict resolution strategy for multi-device vault updates
2. Client-side caching and offline capability approach
3. ZK-proof generation integration within browser extension

**Deferred Decisions (Post-MVP):**
1. CRDT implementation for automatic conflict merge (V2)
2. Decentralized SMTP options (tiered approach post-MVP)
3. Mobile application architecture (React Native vs native)

### 1. Midnight Smart Contract State Model

**Decision:** Use **private state** for vault CID storage with public state only for timestamp/ownership metadata.

**Rationale:**
- Maximizes metadata privacy - IPFS CID never appears on public ledger
- Prevents analysis of vault update patterns (which could leak information about user activity)
- Midnight's witness functions enable private state access by wallet owner across multiple devices
- Aligns with zero-knowledge philosophy: prove vault ownership without revealing vault location

**Implementation:**

```typescript
// VaultRegistry.compact
contract VaultRegistry {
  private state {
    vaultCID: String        // IPFS content identifier - NEVER disclosed
    encryptionPublicKey: Bytes  // For email encryption
  }
  
  public state {
    owner: WalletAddress    // Wallet that owns this vault
    lastUpdated: Timestamp  // Only timestamp is public
  }
  
  @circuit
  function updateVault(newCID: String) {
    // Witness function accesses private state
    require(this.sender == this.public.owner, "Not owner")
    
    // Update private state (local to user)
    this.private.vaultCID = newCID
    
    // Update public state (on-chain metadata)
    this.public.lastUpdated = currentTimestamp()
    
    // Only timestamp disclosed on-chain
    disclose(currentTimestamp())
  }
  
  @witness
  function getVaultCID(): String {
    // Witness function for authorized wallet to retrieve private CID
    return this.private.vaultCID
  }
}
```

**Multi-Device Flow:**
1. User saves vault on Device A → Uploads to IPFS (CID: QmABC...), updates contract private state
2. User opens vault on Device B → Connects wallet, queries contract witness function, retrieves QmABC... (still private to wallet owner)
3. Device B fetches encrypted vault from IPFS using private CID
4. Decrypts locally with Master Password

**Affects:** Vault storage, multi-device synchronization, privacy guarantees

### 2. IPFS Pinning Strategy

**Decision:** Use **Pinata** managed pinning service for MVP with multi-region redundancy configuration.

**Rationale:**
- Production-ready managed service (handles pinning infrastructure complexity)
- Multi-region support (3+ geographic zones for 99.9% availability requirement)
- Predictable pricing vs self-hosted node operational overhead
- REST API integration well-documented and stable
- Allows focus on core vault functionality vs infrastructure management

**Configuration:**

```typescript
// Extension IPFS client configuration
import { create } from 'ipfs-http-client'

const ipfsClient = create({
  host: 'api.pinata.cloud',
  port: 443,
  protocol: 'https',
  headers: {
    authorization: `Bearer ${PINATA_JWT_TOKEN}`
  }
})

// Upload with explicit pinning
async function uploadVaultToIPFS(encryptedVault: Uint8Array): Promise<string> {
  const result = await ipfsClient.add(encryptedVault, {
    pin: true, // Ensure pinned
    cidVersion: 1 // Use CIDv1 for better compatibility
  })
  
  // Pinata automatically replicates to multiple regions
  return result.cid.toString()
}
```

**Backup Strategy:**
- Configure Pinata with 3 geographic regions (US East, EU West, Asia Pacific)
- Extension maintains local cache of vault (IndexedDB) as offline fallback
- Monthly verification job checks pin status for all active vaults

**Post-MVP Options:**
- V2: Hybrid approach with user-selected pinning service (Pinata, Web3.Storage, or self-hosted)
- V3: Filecoin integration for long-term archival storage

**Affects:** Vault reliability, operational costs, decentralization degree

### 3. Conflict Resolution Strategy

**Decision:** **Credential-level merge** with last-write-wins for same credential updates.

**Clarification from existing architecture:**
- Current AliasVault generates **one unique alias per credential** (e.g., `github-user@alias.id`, `aws-user@alias.id`)
- Vault structure is a **list/map of credentials**, each with independent lifecycle
- Conflict scenarios are therefore **addition conflicts** (Device A adds credential X, Device B adds credential Y) vs **edit conflicts** (both edit the same credential)

**Implementation Strategy:**

```typescript
// Vault data structure
interface Vault {
  version: string
  credentials: Map<CredentialID, Credential>
  lastModified: Timestamp
}

interface Credential {
  id: CredentialID // Unique identifier (hash of service + username + timestamp)
  service: string
  username: string
  password: string  // Encrypted
  aliasEmail: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

// Conflict resolver (client-side)
async function resolveVaultConflict(
  localVault: Vault, 
  remoteVault: Vault
): Promise<Vault> {
  const merged = new Map<CredentialID, Credential>()
  
  // Add all local credentials
  for (const [id, cred] of localVault.credentials) {
    merged.set(id, cred)
  }
  
  // Merge remote credentials
  for (const [id, remoteCred] of remoteVault.credentials) {
    const localCred = merged.get(id)
    
    if (!localCred) {
      // New credential from remote - add it
      merged.set(id, remoteCred)
    } else {
      // Same credential modified on both devices
      // Last-write-wins based on updatedAt timestamp
      if (remoteCred.updatedAt > localCred.updatedAt) {
        merged.set(id, remoteCred)
        console.warn(`Conflict: ${id} resolved to remote (newer)`)
      }
      // else keep local (it's newer or same)
    }
  }
  
  return {
    ...localVault,
    credentials: merged,
    lastModified: Date.now()
  }
}
```

**User Experience:**
- Before saving, extension checks Midnight for current vault CID
- If CID differs from cached CID: fetch both vaults, auto-merge, show notification
- Notification: "Changes from another device merged: Added 2 credentials, updated 1 credential"
- User reviews merged vault before final upload

**Edge Case Handling:**
- **Credential deletion conflicts:** If Device A deletes credential X while Device B modifies it → Remote modification wins (user can delete again if intended)
- **Simultaneous new credential with same service+username:** Credential ID includes timestamp, so creates two entries (user can manually deduplicate)

**Deferred to V2:** CRDT-based automatic merge (using Automerge or Yjs) to eliminate all conflicts automatically

**Affects:** Multi-device user experience, data consistency, vault save flow

### 4. Guardian Recovery Configuration

**Decision:** **3 guardians with 2-of-3 threshold** using **dual-layer encryption** with wallet-independent recovery key for true zero-knowledge protection.

**Rationale:**
- 2-of-3 threshold balances security vs practicality (easier to coordinate 2 guardians than 3-of-5)
- **Dual-layer encryption:** Master password encrypted with wallet-independent key (stored in private state)
- **True zero-knowledge:** Guardians CANNOT reconstruct master password even if ALL collude
- **Supports catastrophic loss:** Backup wallet can transfer ownership and access recovery key
- **Supports ownership transfer:** New wallet owner can access same recovery key via witness function

**Architecture Overview:**

```
Master Password
    ↓ (encrypt with recovery key)
Encrypted Password
    ↓ (Shamir split 3 shares, 2 threshold)
Shares [S1, S2, S3]
    ↓ (encrypt each with guardian's public key)
Encrypted Shares → Midnight Private State

Recovery Key (wallet-independent) → Midnight Private State
```

**Implementation:**

```typescript
// During vault setup
import * as secrets from 'secrets.js-34r7h'
import { randomBytes } from 'crypto'

async function setupGuardianRecovery(
  masterPassword: string,
  guardianWallets: [WalletAddress, WalletAddress, WalletAddress],
  backupWallet?: WalletAddress  // Optional: for catastrophic loss recovery
): Promise<void> {
  // 1. Generate wallet-independent recovery key
  const recoveryKey = randomBytes(32) // AES-256 key
  
  // 2. Store recovery key in VaultRegistry private state
  await vaultRegistry.storeRecoveryKey({
    owner: userWalletAddress,
    recoveryKey: recoveryKey
  })
  
  // 3. Encrypt master password with recovery key
  const encryptedPassword = await aesEncrypt(masterPassword, recoveryKey)
  
  // 4. Split ENCRYPTED password into 3 shares (threshold: 2)
  const passwordHex = Buffer.from(encryptedPassword).toString('hex')
  const shares = secrets.share(passwordHex, 3, 2)
  
  // 5. Encrypt each share with guardian's public key
  for (let i = 0; i < 3; i++) {
    const guardianPublicKey = await fetchGuardianPublicKey(guardianWallets[i])
    const encryptedShare = await rsaEncrypt(shares[i], guardianPublicKey)
    
    // 6. Store encrypted share in GuardianRecovery contract private state
    await guardianRecoveryContract.storeShare({
      vaultOwner: userWalletAddress,
      guardianWallet: guardianWallets[i],
      encryptedShare: encryptedShare,
      shareIndex: i
    })
  }
  
  // 7. If backup wallet provided, grant it transfer permission
  if (backupWallet) {
    await vaultRegistry.setBackupWallet(backupWallet)
  }
}

// During recovery (normal flow - wallet intact)
async function recoverMasterPassword(
  guardianApprovals: [GuardianSignature, GuardianSignature]
): Promise<string> {
  // 1. After 72-hour time-lock, guardians approve recovery
  const shares: string[] = []
  
  for (const approval of guardianApprovals) {
    // 2. Each guardian's signature permits share release
    const encryptedShare = await guardianRecoveryContract.claimShare(approval)
    
    // 3. User decrypts share with their wallet
    const decryptedShare = await rsaDecrypt(encryptedShare, userWalletPrivateKey)
    shares.push(decryptedShare)
  }
  
  // 4. Combine 2 shares to reconstruct ENCRYPTED password
  const encryptedPasswordHex = secrets.combine(shares)
  const encryptedPassword = Buffer.from(encryptedPasswordHex, 'hex')
  
  // 5. Fetch recovery key from contract (owner-only via witness function)
  const recoveryKey = await vaultRegistry.getRecoveryKey()
  
  // 6. Decrypt password with recovery key
  const masterPassword = await aesDecrypt(encryptedPassword, recoveryKey)
  
  return masterPassword
}

// Catastrophic loss recovery (lost primary wallet + password)
async function recoverWithBackupWallet(
  backupWallet: Wallet,
  guardianApprovals: [GuardianSignature, GuardianSignature]
): Promise<string> {
  // 1. Backup wallet transfers ownership to itself
  await vaultRegistry.transferOwnershipFromBackup(backupWallet.address)
  
  // 2. Now backup wallet is owner, can access recovery key
  const recoveryKey = await vaultRegistry.getRecoveryKey()
  
  // 3. Get guardian shares and combine
  const shares: string[] = []
  for (const approval of guardianApprovals) {
    const encryptedShare = await guardianRecoveryContract.claimShare(approval)
    const decryptedShare = await rsaDecrypt(encryptedShare, backupWallet.privateKey)
    shares.push(decryptedShare)
  }
  
  const encryptedPasswordHex = secrets.combine(shares)
  const encryptedPassword = Buffer.from(encryptedPasswordHex, 'hex')
  
  // 4. Decrypt password with recovery key (KEY is wallet-independent!)
  const masterPassword = await aesDecrypt(encryptedPassword, recoveryKey)
  
  return masterPassword
}
```

**Guardian Selection UX:**
- User enters 3 wallet addresses during setup
- **NEW:** User MUST configure backup wallet (for catastrophic loss scenario)
- Extension validates each address (correct format, on-chain verification)
- Recommended: family members, trusted friends with Cardano wallets
- Warning: "Your guardians can help you recover, but they CANNOT see your master password. Configure a backup wallet for maximum protection."

**Security Properties:**
- **1 guardian alone:** Cannot recover (needs 2)
- **2 guardians collude:** ✅ CANNOT reconstruct password (only get encrypted version, no recovery key)
- **All 3 guardians collude:** ✅ CANNOT reconstruct password (true zero-knowledge achieved)
- **Backup wallet alone:** ✅ CANNOT access vault (needs guardians for password recovery)
- **User loses primary wallet + password:** ✅ Backup wallet + 2 guardians = full recovery
- **Ownership transfer:** ✅ New owner can access recovery key, re-encrypt shares if needed

**Advanced Mechanisms:**

**1. Backup Wallet Time-Lock (72-hour delay)**
```typescript
// VaultRegistry.compact
contract VaultRegistry {
  private state {
    backupWallets: Map<WalletAddress, BackupConfig>
  }
  
  struct BackupConfig {
    wallet: WalletAddress
    addedAt: Timestamp
    transferInitiatedAt?: Timestamp
  }
  
  function initiateBackupTransfer(backupWallet: WalletAddress) {
    require(this.private.backupWallets.has(backupWallet), "Not a backup wallet")
    
    const config = this.private.backupWallets.get(backupWallet)
    config.transferInitiatedAt = currentTimestamp()
    
    // 72-hour time-lock begins (same as guardian recovery)
    disclose({ event: 'BackupTransferInitiated', backupWallet })
  }
  
  function executeBackupTransfer(backupWallet: WalletAddress) {
    const config = this.private.backupWallets.get(backupWallet)
    require(config.transferInitiatedAt, "No transfer initiated")
    require(
      currentTimestamp() - config.transferInitiatedAt >= 72 hours,
      "Time-lock active"
    )
    
    // Transfer ownership after 72-hour delay
    this.public.owner = backupWallet
  }
  
  function cancelBackupTransfer(backupWallet: WalletAddress) {
    // Current owner can cancel malicious backup transfer
    require(this.sender == this.public.owner, "Not owner")
    
    const config = this.private.backupWallets.get(backupWallet)
    config.transferInitiatedAt = null
  }
}
```

**2. Guardian Rotation (Replace Guardian Without Password Change)**
```typescript
async function rotateGuardian(
  oldGuardianWallet: WalletAddress,
  newGuardianWallet: WalletAddress,
  userPassword: string  // User must authenticate
): Promise<void> {
  // 1. Verify user knows password
  const isValid = await verifyMasterPassword(userPassword)
  require(isValid, "Invalid password")
  
  // 2. Get encrypted shares for all guardians
  const shares = await guardianContract.getAllShares(userWalletAddress)
  
  // 3. Decrypt the old guardian's share
  const oldShare = shares.find(s => s.guardianWallet === oldGuardianWallet)
  const decryptedShare = await rsaDecrypt(oldShare.encryptedShare, oldGuardianWallet.publicKey)
  
  // 4. Re-encrypt with new guardian's public key
  const newGuardianPublicKey = await fetchPublicKeyFromWallet(newGuardianWallet)
  const newEncryptedShare = await rsaEncrypt(decryptedShare, newGuardianPublicKey)
  
  // 5. Update contract
  await guardianContract.rotateGuardian({
    vaultOwner: userWalletAddress,
    oldGuardian: oldGuardianWallet,
    newGuardian: newGuardianWallet,
    newEncryptedShare
  })
}
```

**3. Multi-Backup Wallet Support**
```typescript
interface BackupWalletConfig {
  primary: WalletAddress      // Hardware wallet (Ledger)
  secondary?: WalletAddress   // Paper wallet
  tertiary?: WalletAddress    // Family member's wallet
}

async function configureBackupWallets(
  config: BackupWalletConfig
): Promise<void> {
  // Store up to 3 backup wallets
  await vaultRegistry.setBackupWallets({
    owner: userWalletAddress,
    backups: [config.primary, config.secondary, config.tertiary].filter(Boolean)
  })
  
  // ANY backup wallet can initiate transfer (with time-lock)
  // Priority: First to initiate gets to complete
}

// VaultRegistry.compact
contract VaultRegistry {
  private state {
    backupWallets: WalletAddress[]  // Up to 3 backup wallets
  }
  
  function initiateBackupTransfer() {
    // Check if sender is ANY of the backup wallets
    require(this.private.backupWallets.includes(this.sender), "Not a backup")
    // ... time-lock logic
  }
}
```

**4. Recovery Key Rotation**
```typescript
async function rotateRecoveryKey(
  masterPassword: string,  // User must know password
  rotateGuardians?: boolean  // Optional: also rotate guardians
): Promise<void> {
  // 1. Verify user knows password
  const isValid = await verifyMasterPassword(masterPassword)
  require(isValid, "Invalid password")
  
  // 2. Generate new recovery key
  const newRecoveryKey = randomBytes(32)
  
  // 3. Re-encrypt master password with new key
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', newRecoveryKey, iv)
  const newEncryptedPassword = Buffer.concat([
    iv,
    cipher.update(masterPassword, 'utf8'),
    cipher.final(),
    cipher.getAuthTag()
  ])
  
  // 4. Re-split into Shamir shares
  const encryptedHex = newEncryptedPassword.toString('hex')
  const newShares = secrets.share(encryptedHex, 3, 2)
  
  // 5. Re-encrypt shares with guardian public keys
  const guardians = await guardianContract.getGuardians(userWalletAddress)
  for (let i = 0; i < 3; i++) {
    const guardianPublicKey = await fetchPublicKeyFromWallet(guardians[i])
    const encryptedShare = await rsaEncrypt(newShares[i], guardianPublicKey)
    
    await guardianContract.updateShare({
      vaultOwner: userWalletAddress,
      guardianWallet: guardians[i],
      encryptedShare,
      shareIndex: i
    })
  }
  
  // 6. Update contract with new recovery key
  await vaultRegistry.updateRecoveryKey(newRecoveryKey)
}

// Recommended: Rotate recovery key every 12 months
```

**5. Guardian Notification Protocol (IPFS Portal)**
```typescript
/**
 * Guardian Portal Architecture:
 * 
 * 1. User initiates recovery on-chain
 * 2. Contract emits public event with recovery CID
 * 3. Recovery metadata (non-sensitive) uploaded to IPFS
 * 4. Guardians visit portal: https://guardians.aliasvault.id
 * 5. Guardian connects wallet, portal queries contract
 * 6. Portal shows pending approvals for that guardian
 * 7. Guardian approves via wallet signature
 */

// Recovery metadata structure (public, non-sensitive)
interface RecoveryMetadata {
  recoveryId: string
  vaultOwner: WalletAddress  // Hashed for privacy
  guardianWallets: WalletAddress[]  // Hashed
  requestedAt: Timestamp
  timeRemaining: number  // Hours until claim available
  status: 'pending' | 'approved' | 'claimed' | 'cancelled'
}

// Upload to IPFS when recovery initiated
async function initiateRecoveryWithNotification(
  guardianWallets: [WalletAddress, WalletAddress, WalletAddress]
): Promise<string> {
  // 1. Create recovery request on-chain
  await guardianContract.initiateRecovery(guardianWallets)
  
  // 2. Create public metadata (user's responsibility to notify guardians)
  const metadata: RecoveryMetadata = {
    recoveryId: generateRecoveryId(),
    vaultOwner: hash(userWalletAddress),
    guardianWallets: guardianWallets.map(hash),
    requestedAt: Date.now(),
    timeRemaining: 72,
    status: 'pending'
  }
  
  // 3. Upload metadata to IPFS
  const metadataCID = await ipfsClient.add(JSON.stringify(metadata), {
    cidVersion: 1,
    pin: true
  })
  
  // 4. Emit on-chain event with CID
  await guardianContract.emitRecoveryNotification(metadataCID.toString())
  
  // 5. Return portal URL for user to share with guardians
  return `https://guardians.aliasvault.id/approve/${metadataCID.toString()}`
}

// Guardian Portal (static IPFS-hosted React app)
// Guardians: 
// 1. Visit portal URL
// 2. Connect wallet (Lace/Nami)
// 3. Portal fetches metadata from IPFS CID
// 4. Portal queries contract: "Does this wallet have pending approvals?"
// 5. If yes, show approve button
// 6. Guardian signs approval with wallet
// 7. Portal submits approval to contract
```

**6. Cross-Device Recovery Coordination (Contract-Based)**
```typescript
// GuardianRecovery.compact
contract GuardianRecovery {
  public state {
    recoveryRequests: Map<WalletAddress, RecoveryRequest>
  }
  
  struct RecoveryRequest {
    vaultOwner: WalletAddress
    requestedAt: Timestamp
    approvals: GuardianApproval[]  // All approvals stored on-chain
    claimedBy?: WalletAddress  // Which device claimed shares
    status: 'pending' | 'approved' | 'claimed' | 'cancelled'
  }
  
  struct GuardianApproval {
    guardianWallet: WalletAddress
    approvedAt: Timestamp
    signature: Bytes
    deviceId?: String  // Optional: track which device guardian used
  }
  
  // User initiates recovery on Device A
  function initiateRecovery(guardians: WalletAddress[]) {
    this.public.recoveryRequests.set(this.sender, {
      vaultOwner: this.sender,
      requestedAt: currentTimestamp(),
      approvals: [],
      status: 'pending'
    })
  }
  
  // Guardians approve from their own devices
  function approveRecovery(vaultOwner: WalletAddress) {
    const request = this.public.recoveryRequests.get(vaultOwner)
    require(request.status == 'pending', "Invalid request")
    require(isGuardian(this.sender, vaultOwner), "Not a guardian")
    
    // Add approval to on-chain list
    request.approvals.push({
      guardianWallet: this.sender,
      approvedAt: currentTimestamp(),
      signature: signatureFromSender()
    })
    
    // Mark as approved when threshold met
    if (request.approvals.length >= 2) {
      request.status = 'approved'
    }
  }
  
  // User claims shares on Device B (after 72 hours)
  @witness
  function claimShares(vaultOwner: WalletAddress): GuardianShare[] {
    const request = this.public.recoveryRequests.get(vaultOwner)
    require(request.status == 'approved', "Not approved")
    require(currentTimestamp() - request.requestedAt >= 72 hours, "Time-lock active")
    require(this.sender == vaultOwner, "Not owner")
    
    // Mark as claimed (prevents double-claim)
    request.status = 'claimed'
    request.claimedBy = this.sender
    
    // Return encrypted shares for approved guardians
    const shares: GuardianShare[] = []
    for (const approval of request.approvals) {
      const share = this.private.guardianShares.get(
        guardianKey(approval.guardianWallet, vaultOwner)
      )
      shares.push(share)
    }
    
    return shares
  }
}
```

**Byzantine Failure Resolution:**

Guardian recovery ALWAYS takes precedence over backup wallet transfer to prevent race conditions:

```typescript
// GuardianRecovery.compact
function completeGuardianRecovery(vaultOwner: WalletAddress) {
  const request = this.public.recoveryRequests.get(vaultOwner)
  require(request.status == 'approved', "Not approved")
  require(currentTimestamp() - request.requestedAt >= 72 hours, "Time-lock active")
  
  // Mark recovery as complete
  request.status = 'claimed'
  
  // CRITICAL: Cancel any pending backup transfers
  // Guardian recovery has priority over backup wallet transfers
  await vaultRegistry.cancelAllBackupTransfers(vaultOwner)
}

// VaultRegistry.compact
function cancelAllBackupTransfers(owner: WalletAddress) {
  // Called automatically when guardian recovery completes
  for (const backupConfig of this.private.backupWallets.values()) {
    if (backupConfig.vaultOwner == owner) {
      backupConfig.transferInitiatedAt = null
    }
  }
}
```

**User Experience Flow:**
1. **Setup:** User configures 3 guardians + 1-3 backup wallets
2. **Recovery Initiation:** User (on any device) calls `initiateRecovery()` → Gets portal URL
3. **User Notification:** User contacts guardians (email/SMS/Signal) with portal URL
4. **Guardian Approval:** Guardians visit portal, connect wallet, approve (72-hour timer starts)
5. **Cross-Device Claim:** User can claim shares on ANY device (laptop, phone, tablet) after 72 hours
6. **Backup Transfer:** If primary wallet lost, backup wallet initiates transfer (72-hour delay)
7. **Rotation:** User periodically rotates recovery key and/or guardians for security


**Smart Contract:**

```typescript
// GuardianRecovery.compact
contract GuardianRecovery {
  public state {
    recoveryRequests: Map<WalletAddress, RecoveryRequest>
  }
  
  private state {
    guardianShares: Map<GuardianKey, EncryptedShare>
  }
  
  struct RecoveryRequest {
    vaultOwner: WalletAddress
    requestedAt: Timestamp
    approvals: GuardianSignature[]
    status: 'pending' | 'approved' | 'cancelled'
  }
  
  function initiateRecovery(guardians: WalletAddress[]) {
    require(guardians.length == 3, "Must have 3 guardians")
    this.public.recoveryRequests.set(this.sender, {
      vaultOwner: this.sender,
      requestedAt: currentTimestamp(),
      approvals: [],
      status: 'pending'
    })
    
    // 72-hour time-lock begins
  }
  
  function approveRecovery(vaultOwner: WalletAddress) {
    const request = this.public.recoveryRequests.get(vaultOwner)
    require(request.status == 'pending', "Invalid request")
    require(isGuardian(this.sender, vaultOwner), "Not a guardian")
    
    request.approvals.push(signatureFromSender())
    
    if (request.approvals.length >= 2) {
      request.status = 'approved'
    }
  }
  
  @witness
  function claimShare(vaultOwner: WalletAddress): EncryptedShare {
    const request = this.public.recoveryRequests.get(vaultOwner)
    require(request.status == 'approved', "Not approved")
    require(currentTimestamp() - request.requestedAt >= 72 hours, "Time-lock active")
    
    // Release guardian's share from private state
    return this.private.guardianShares.get(guardianKey(this.sender, vaultOwner))
  }
}
```

**Affects:** Account recovery flow, guardian setup UX, smart contract design

### 5. SMTP Bridge Service Architecture

**Decision:** **Simple Express TypeScript microservice** with Midnight RPC client and Mox SMTP integration.

**Rationale:**
- Lightweight and easy to deploy (single Docker container for MVP)
- Event-driven architecture matches email workflow (receive → verify → encrypt → store → notify)
- Express ecosystem well-suited for HTTP/RPC integration
- Horizontal scaling capability (stateless service) for future growth

**Service Components:**

```typescript
// smtp-bridge/src/index.ts
import express from 'express'
import { MidnightRPC } from '@midnight-ntwrk/client-sdk'
import { create as createIPFSClient } from 'ipfs-http-client'
import nodemailer from 'nodemailer'

const app = express()
const midnightRPC = new MidnightRPC(process.env.MIDNIGHT_RPC_URL)
const ipfsClient = createIPFSClient(/* Pinata config */)

// 1. Mox forwards emails to this webhook
app.post('/receive-email', async (req, res) => {
  const { to, from, subject, body } = req.body
  
  // 2. Extract alias from 'to' address
  const alias = extractAlias(to) // e.g., "user@alias.id"
  
  // 3. Query Midnight Alias Registry: "Who owns this alias?"
  const ownerWallet = await midnightRPC.call({
    contract: 'AliasRegistry',
    method: 'getOwner',
    args: [alias]
  })
  
  if (!ownerWallet) {
    return res.status(404).json({ error: 'Alias not registered' })
  }
  
  // 4. Fetch owner's public encryption key from Vault Registry
  const publicKey = await midnightRPC.call({
    contract: 'VaultRegistry',
    method: 'getPublicKey',
    args: [ownerWallet]
  })
  
  // 5. Encrypt email with owner's public key
  const encryptedEmail = await encryptEmail({ from, subject, body }, publicKey)
  
  // 6. Upload encrypted email to IPFS
  const emailCID = await ipfsClient.add(encryptedEmail)
  
  // 7. Post notification event to Midnight (contract-sponsored transaction)
  await midnightRPC.submitTransaction({
    contract: 'VaultRegistry',
    method: 'notifyNewMail',
    args: [ownerWallet, emailCID.toString()],
    sponsored: true // Protocol pays gas
  })
  
  res.status(200).json({ success: true, cid: emailCID.toString() })
})

app.listen(3000, () => console.log('SMTP Bridge running on port 3000'))
```

**Mox Integration:**

> [!NOTE]
> **Decision Record:** See [ADR-001: SMTP Infrastructure](file:///docs/architecture/adr-001-smtp-infrastructure.md) for full context on why Mox was chosen over the existing SmtpServer NuGet implementation.

Configure Mox to forward all `@alias.id` emails to bridge webhook:

```yaml
# domains.conf (sconf format - uses tabs for indentation)
Accounts:
  aliasvault:
    IncomingWebhook:
      URL: http://smtp-bridge:3000/receive-email
      Authorization: Bearer ${BRIDGE_SECRET}
    Destinations:
      catch-all:
        Mailbox: Inbox
```

**Encryption Strategy:**

```typescript
import { createCipheriv, randomBytes } from 'crypto'

async function encryptEmail(email: Email, publicKey: string): Promise<Uint8Array> {
  // 1. Serialize email to JSON
  const emailJSON = JSON.stringify(email)
  
  // 2. Generate random symmetric key (AES-256)
  const symmetricKey = randomBytes(32)
  const iv = randomBytes(16)
  
  // 3. Encrypt email with symmetric key
  const cipher = createCipheriv('aes-256-gcm', symmetricKey, iv)
  const encryptedBody = Buffer.concat([
    cipher.update(emailJSON, 'utf8'),
    cipher.final()
  ])
  const authTag = cipher.getAuthTag()
  
  // 4. Encrypt symmetric key with recipient's public key (RSA-OAEP)
  const encryptedKey = await encryptWithPublicKey(symmetricKey, publicKey)
  
  // 5. Package: [encryptedKey][iv][authTag][encryptedBody]
  return Buffer.concat([encryptedKey, iv, authTag, encryptedBody])
}
```

**Deployment:**

```dockerfile
# Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build
CMD ["node", "dist/index.js"]
```

```yaml
# docker-compose.yml
services:
  mox:
    image: mox/mox:latest
    volumes:
      - ./mox.conf:/etc/mox/mox.conf
    ports:
      - "25:25"   # SMTP
      - "587:587" # Submission
  
  smtp-bridge:
    build: ./smtp-bridge
    environment:
      - MIDNIGHT_RPC_URL=https://rpc.midnight.network
      - PINATA_JWT=xxx
    depends_on:
      - mox
```

**Monitoring:**

```typescript
// Prometheus metrics
import promClient from 'prom-client'

const emailsReceived = new promClient.Counter({
  name: 'emails_received_total',
  help: 'Total emails processed'
})

const encryptionErrors = new promClient.Counter({
  name: 'encryption_errors_total',
  help: 'Total encryption failures'
})

const midnightLatency = new promClient.Histogram({
  name: 'midnight_rpc_duration_seconds',
  help: 'Midnight RPC call duration'
})
```

**Security Considerations:**

- Rate limiting (max 100 emails/minute per alias to prevent spam)
- Email size limits (max 5MB per email)
- Public key caching (reduce Midnight RPC calls)
- TLS for Mox → Bridge communication

**Affects:** Email alias functionality, SMTP infrastructure, notification system

### Decision Impact Analysis

**Implementation Sequence:**

1. **First:** Midnight smart contracts (VaultRegistry, GuardianRecovery, AliasRegistry) - foundation for all other components
2. **Second:** Browser extension refactoring (add Mesh SDK, IPFS client, remove API client)
3. **Third:** Guardian setup UI and Shamir share distribution
4. **Fourth:** Vault save/load flow with Pinata + Midnight private state integration
5. **Fifth:** Conflict resolution UI and merge logic
6. **Sixth:** SMTP bridge service deployment and Mox integration

**Cross-Component Dependencies:**

- **VaultRegistry contract** → Enables vault save/load in extension
- **Pinata IPFS** → Required by both extension (vault upload) and bridge (email storage)
- **GuardianRecovery contract** → Depends on Shamir share encryption (requires VaultRegistry public keys)
- **AliasRegistry contract** → Required by SMTP bridge for ownership verification
- **SMTP Bridge** → Depends on all contracts (VaultRegistry for public keys, AliasRegistry for aliases, contract-sponsored transactions)

**Technology Version Verification:**

- Midnight SDK: Awaiting mainnet Q4 2025, will verify latest SDK version at implementation
- Pinata: Current API v1, REST endpoints stable
- Mesh SDK: Latest v1.5.x for Cardano wallet integration
- secrets.js: v2.x for Shamir Secret Sharing
- Express: v4.18+ for TypeScript microservice

### Architectural Decisions NOT Yet Made

The following decisions are deferred to implementation phase or post-MVP:

1. **Mobile App Architecture:** React Native vs native Swift/Kotlin (deferred to V2)
2. **CRDT Library Selection:** Automerge vs Yjs for conflict-free merge (V2)
3. **Self-hosted IPFS Nodes:** Configuration for users wanting full decentralization (V3)
4. **Multi-sig Guardian Contracts:** For enterprise/family shared vaults (V3)
5. **ZK-Proof Circuit Optimization:** Formal verification and optimization strategy (post-audit)

These architectural foundations provide clear implementation guidance while maintaining flexibility for future enhancements.

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical Conflict Points Identified:** 15 areas where AI agents could make different implementation choices that would cause integration failures. This section establishes mandatory patterns to ensure code compatibility across multiple AI agents working on different components.

### Pattern 1: Monorepo Structure & Organization

**Decision:** Root-level integration of MeshJS template components.

**Directory Structure:**
```
aliasvault/
├── apps/
│   └── browser-extension/        # Existing WXT extension (preserve)
│       ├── src/
│       │   ├── components/        # React UI components
│       │   ├── services/          # Business logic layer
│       │   │   ├── midnightClient.ts
│       │   │   ├── ipfsClient.ts
│       │   │   └── vaultService.ts
│       │   ├── lib/               # Utility libraries
│       │   │   ├── conflictResolver.ts
│       │   │   ├── shamirSharing.ts
│       │   │   └── encryption.ts  # Existing Argon2id + AES logic
│       │   └── background/        # Extension background script
│       └── package.json
├── contracts/                     # From MeshJS template
│   ├── VaultRegistry.compact
│   ├── GuardianRecovery.compact
│   ├── AliasRegistry.compact
│   └── __tests__/
│       ├── VaultRegistry.test.ts
│       └── GuardianRecovery.test.ts
├── cli/                           # From MeshJS template
│   ├── deploy.ts
│   ├── interact.ts
│   └── .env.example
├── smtp-bridge/                   # Express microservice
│   ├── src/
│   │   ├── index.ts
│   │   ├── services/
│   │   └── config/
│   └── package.json
├── docs/                          # Documentation
├── docker-compose.yml             # Midnight local network stack
└── package.json                   # Root workspace config
```

**Rationale:** Contracts are a top-level concern (not nested under `packages/`), making them easily discoverable and simplifying deployment scripts from the MeshJS template.

**Enforcement:**
- All contract files MUST live in `contracts/` directory
- Browser extension changes MUST stay within `apps/browser-extension/`
- SMTP bridge MUST remain independent service in `smtp-bridge/`

### Pattern 2: Naming Conventions

**Compact Contract Naming:**

```typescript
// Contract names: PascalCase
contract VaultRegistry { }
contract GuardianRecovery { }
contract AliasRegistry { }

// State fields: camelCase
private state {
  vaultCID: String
  encryptionPublicKey: Bytes
}

public state {
  owner: WalletAddress
  lastUpdated: Timestamp
}

// Function names: camelCase
function updateVault(newCID: String) { }
function getVaultCID(): String { }
```

**TypeScript/JavaScript Naming:**

```typescript
// Files: camelCase
vaultService.ts
midnightClient.ts
conflictResolver.ts

// React Components: PascalCase files & exports
WalletConnect.tsx
VaultList.tsx
CredentialCard.tsx

// Functions: camelCase
async function uploadToIPFS(data: Uint8Array): Promise<string>
async function resolveConflict(local: Vault, remote: Vault): Promise<Vault>
function encryptWithMasterPassword(plaintext: string, password: string): string

// Variables & Constants: camelCase for vars, SCREAMING_SNAKE_CASE for constants
const vaultCID = await getVaultCID()
const encryptedVault = encrypt(vault, masterPassword)
const MAX_RETRY_ATTEMPTS = 3
const IPFS_TIMEOUT_MS = 5000

// Interfaces & Types: PascalCase
interface Vault { }
interface Credential { }
type CredentialID = string
type EncryptedShare = Uint8Array
```

**Database/Storage Naming (IndexedDB):**

```typescript
// Store names: camelCase
const stores = {
  vaultCache: 'vaultCache',
  conflictLog: 'conflictLog',
  guardianShares: 'guardianShares'
}

// Object keys: camelCase
interface CachedVault {
  vaultCID: string
  encryptedData: Uint8Array
  cachedAt: number
  syncStatus: 'synced' | 'pending' | 'conflict'
}
```

**Enforcement:**
- All contract names MUST be PascalCase
- All TypeScript/JS files MUST be camelCase (except components)
- React component files MUST be PascalCase matching export name
- Database fields MUST be camelCase (never snake_case)

### Pattern 3: IPFS CID Handling

**CID Version Standard:**
```typescript
// ALWAYS use CIDv1 for consistency
import { create } from 'ipfs-http-client'

const ipfsClient = create({
  host: 'api.pinata.cloud',
  port: 443,
  protocol: 'https',
  headers: { authorization: `Bearer ${PINATA_JWT}` }
})

// Upload with explicit CIDv1
async function uploadToIPFS(data: Uint8Array): Promise<string> {
  const result = await ipfsClient.add(data, {
    pin: true,
    cidVersion: 1  // MANDATORY: Always CIDv1
  })
  
  return result.cid.toString() // Returns CIDv1 string: "bafybeig..."
}
```

**CID Field Naming:**
```typescript
// ALWAYS use "vaultCID" (not "cid", "vault_cid", "ipfsCID")

// Compact contract
private state {
  vaultCID: String  // Correct
}

// TypeScript
interface Vault {
  vaultCID: string  // Correct
  credentials: Map<CredentialID, Credential>
}

// ❌ INCORRECT variations to NEVER use:
// cid, vault_cid, ipfsCID, contentId, ipfsHash
```

**CID Type Handling:**
```typescript
// CID storage: Always string representation
// Midnight contracts: String type
// TypeScript: string type
// IndexedDB: string type

// Conversion pattern
import { CID } from 'multiformats/cid'

// From IPFS add result
const cidObject = result.cid
const cidString = cidObject.toString()  // "bafybeig..."

// To fetch from IPFS
const data = await ipfsClient.cat(cidString)

// Type guard for CIDv1 validation
type CIDv1String = string & { __brand: 'CIDv1' }

function assertCIDv1(cid: string): asserts cid is CIDv1String {
  if (!cid.startsWith('bafy')) {
    throw createError(
      'INVALID_CID_VERSION',
      'CID must be version 1 (base32, starts with "bafy")',
      `Received: ${cid.substring(0, 10)}...`
    )
  }
}

// Usage in IPFS operations
async function uploadToIPFS(data: Uint8Array): Promise<CIDv1String> {
  const result = await ipfsClient.add(data, {
    pin: true,
    cidVersion: 1
  })
  
  const cidString = result.cid.toString()
  assertCIDv1(cidString)  // Runtime validation
  return cidString
}
```

**Enforcement:**
- CID version MUST always be 1 (`cidVersion: 1`)
- CID field name MUST always be `vaultCID`
- CID MUST always be stored as `string` type (never CID object)
- CID string format MUST match `bafybei*` pattern (CIDv1 base32)
- All IPFS upload functions MUST return `CIDv1String` branded type
- Type guards MUST be used to validate CIDs at runtime

### Pattern 4: Error Handling Standards

**Contract Error Wrapping:**
```typescript
// Midnight contract calls throw errors - catch and standardize

interface ContractError {
  code: 'MIDNIGHT_CONTRACT_ERROR'
  message: string
  contractMethod: string
  original: Error
}

async function callContract<T>(
  method: string, 
  args: any[]
): Promise<T> {
  try {
    return await midnightClient.call(method, args)
  } catch (error) {
    throw {
      code: 'MIDNIGHT_CONTRACT_ERROR',
      message: `Contract call failed: ${method}`,
      contractMethod: method,
      original: error
    } as ContractError
  }
}
```

**Application Error Structure:**
```typescript
// User-facing errors with consistent structure

interface AppError {
  code: string          // Machine-readable: 'IPFS_UPLOAD_FAILED'
  message: string       // User-friendly: 'Could not save vault to storage'
  technical?: string    // Optional developer details
  retryable: boolean    // Can user retry this operation?
}

// Error code patterns
const ErrorCodes = {
  // IPFS errors
  IPFS_UPLOAD_FAILED: 'IPFS_UPLOAD_FAILED',
  IPFS_DOWNLOAD_FAILED: 'IPFS_DOWNLOAD_FAILED',
  IPFS_PIN_FAILED: 'IPFS_PIN_FAILED',
  
  // Midnight errors
  MIDNIGHT_CONTRACT_ERROR: 'MIDNIGHT_CONTRACT_ERROR',
  MIDNIGHT_RPC_TIMEOUT: 'MIDNIGHT_RPC_TIMEOUT',
  
  // Wallet errors
  WALLET_NOT_CONNECTED: 'WALLET_NOT_CONNECTED',
  WALLET_SIGNATURE_REJECTED: 'WALLET_SIGNATURE_REJECTED',
  
  // Vault errors
  VAULT_CONFLICT_DETECTED: 'VAULT_CONFLICT_DETECTED',
  VAULT_DECRYPTION_FAILED: 'VAULT_DECRYPTION_FAILED',
  
  // Guardian errors
  GUARDIAN_RECOVERY_TIMELOCKED: 'GUARDIAN_RECOVERY_TIMELOCKED',
  GUARDIAN_INSUFFICIENT_APPROVALS: 'GUARDIAN_INSUFFICIENT_APPROVALS',
  
  // CID validation errors
  INVALID_CID_VERSION: 'INVALID_CID_VERSION'
} as const

// Retryable error codes (network/transient failures)
const RETRYABLE_CODES = [
  'IPFS_UPLOAD_FAILED',
  'IPFS_DOWNLOAD_FAILED',
  'IPFS_PIN_FAILED',
  'MIDNIGHT_RPC_TIMEOUT'
] as const

type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes]
type RetryableCode = typeof RETRYABLE_CODES[number]

// Error factory
function createError(
  code: string, 
  userMessage: string, 
  technicalDetails?: string
): AppError {
  return {
    code,
    message: userMessage,
    technical: technicalDetails,
    retryable: RETRYABLE_CODES.includes(code)
  }
}

// Usage example
try {
  await uploadToIPFS(vault)
} catch (error) {
  throw createError(
    'IPFS_UPLOAD_FAILED',
    'Could not save your vault. Please check your connection.',
    error.message
  )
}
```

**Error Logging Pattern:**
```typescript
// Console logging with structured format
function logError(error: AppError, context?: Record<string, any>) {
  console.error({
    timestamp: new Date().toISOString(),
    code: error.code,
    message: error.message,
    technical: error.technical,
    context
  })
}
```

**Enforcement:**
- All contract errors MUST be wrapped in `ContractError` structure
- User-facing errors MUST use `AppError` interface
- Error codes MUST use `SCREAMING_SNAKE_CASE` constants
- All errors MUST indicate if `retryable`

### Pattern 5: Conflict Resolution Flow

**Trigger Points:**
```typescript
// Check for conflicts at two points:
// 1. On vault load (check if remote differs from cached)
// 2. Before vault save (always fetch latest)

// On Load
async function loadVault(): Promise<Vault> {
  const cachedCID = await getFromIndexedDB('lastKnownCID')
  const remoteCID = await contract.getVaultCID()
  
  if (remoteCID !== cachedCID) {
    // Conflict detected - trigger resolution
    return await resolveAndMerge(cachedCID, remoteCID)
  }
  
  // No conflict - use cached vault
  return await getFromIndexedDB('vaultData')
}

// Before Save
async function saveVault(localVault: Vault): Promise<void> {
  const cachedCID = await getFromIndexedDB('lastKnownCID')
  const remoteCID = await contract.getVaultCID()
  
  if (remoteCID !== cachedCID) {
    // Another device updated since we loaded
    const remoteVault = await fetchFromIPFS(remoteCID)
    const merged = await resolveConflict(localVault, remoteVault)
    
    // Upload merged vault
    return await uploadVault(merged)
  }
  
  // No conflict - proceed with save
  return await uploadVault(localVault)
}
```

**Resolution Algorithm:**
```typescript
// Credential-level merge with last-write-wins
async function resolveConflict(
  localVault: Vault,
  remoteVault: Vault
): Promise<Vault> {
  const merged = new Map<CredentialID, Credential>()
  const changeLog: string[] = []
  
  // Add all local credentials
  for (const [id, cred] of localVault.credentials) {
    merged.set(id, cred)
  }
  
  // Merge remote credentials
  for (const [id, remoteCred] of remoteVault.credentials) {
    const localCred = merged.get(id)
    
    if (!localCred) {
      // New credential from remote device
      merged.set(id, remoteCred)
      changeLog.push(`Added: ${remoteCred.service}`)
    } else {
      // Same credential modified on both devices
      if (remoteCred.updatedAt > localCred.updatedAt) {
        merged.set(id, remoteCred)
        changeLog.push(`Updated: ${remoteCred.service} (remote newer)`)
      }
      // else keep local (it's newer)
    }
  }
  
  // Show user notification
  await showNotification({
    title: 'Vault Synced',
    message: `Merged changes from another device:\n${changeLog.join('\n')}`
  })
  
  return {
    ...localVault,
    credentials: merged,
    lastModified: Date.now()
  }
}
```

**User Notification Pattern:**
```typescript
// Show non-blocking notification after merge
interface ConflictNotification {
  type: 'vault-merge'
  changes: {
    added: number
    updated: number
    unchanged: number
  }
  timestamp: number
}

async function notifyMergeComplete(changes: ConflictNotification['changes']) {
  const message = `
    Synced with another device:
    • ${changes.added} credentials added
    • ${changes.updated} credentials updated
    • ${changes.unchanged} unchanged
  `
  
  // Browser extension notification API
  await chrome.notifications.create({
    type: 'basic',
    iconUrl: '/icon-128.png',
    title: 'Vault Synced',
    message: message.trim()
  })
}
```

**Enforcement:**
- Conflict check MUST occur on vault load AND before save
- Resolution MUST use credential-level merge (not vault-level)
- Last-write-wins MUST be determined by `updatedAt` timestamp
- User MUST be notified of merge results (non-blocking)

### Pattern 6: Guardian Share Encryption (Dual-Layer)

**Architecture: Dual-Layer Encryption with Wallet-Independent Recovery Key**

```typescript
/**
 * Layer 1: Master password encrypted with recovery key (stored in contract)
 * Layer 2: Encrypted password split into Shamir shares
 * Layer 3: Each share encrypted with guardian's public key
 * 
 * Security: Guardians cannot access password even if all collude
 * Recovery: Backup wallet can transfer ownership and access recovery key
 */

import * as secrets from 'secrets.js-34r7h'
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto'

interface GuardianShare {
  vaultOwner: WalletAddress
  guardianWallet: WalletAddress
  encryptedShare: Uint8Array
  shareIndex: number  // 0, 1, or 2 (for 2-of-3 threshold)
}

interface RecoveryKey {
  owner: WalletAddress
  key: Uint8Array  // AES-256 key, wallet-independent
}

// Setup: Generate recovery key and encrypt password
async function setupGuardianRecovery(
  masterPassword: string,
  guardianWallets: [WalletAddress, WalletAddress, WalletAddress],
  backupWallet: WalletAddress  // REQUIRED for catastrophic loss
): Promise<void> {
  // 1. Generate wallet-independent recovery key (AES-256)
  const recoveryKey = randomBytes(32)
  
  // 2. Store recovery key in VaultRegistry private state
  await vaultRegistry.storeRecoveryKey({
    owner: userWalletAddress,
    key: recoveryKey
  })
  
  // 3. Encrypt master password with recovery key (Layer 1)
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', recoveryKey, iv)
  const encryptedPassword = Buffer.concat([
    iv,  // Prepend IV for decryption
    cipher.update(masterPassword, 'utf8'),
    cipher.final(),
    cipher.getAuthTag()
  ])
  
  // 4. Split ENCRYPTED password into Shamir shares (Layer 2)
  const encryptedHex = encryptedPassword.toString('hex')
  const shares = secrets.share(encryptedHex, 3, 2)
  
  // 5. Encrypt each share with guardian's public key (Layer 3)
  for (let i = 0; i < 3; i++) {
    const guardianPublicKey = await fetchPublicKeyFromWallet(guardianWallets[i])
    const encryptedShare = await rsaEncrypt(shares[i], guardianPublicKey)
    
    await guardianContract.storeShare({
      vaultOwner: userWalletAddress,
      guardianWallet: guardianWallets[i],
      encryptedShare,
      shareIndex: i
    })
  }
  
  // 6. Grant backup wallet transfer permissions
  await vaultRegistry.setBackupWallet(backupWallet)
}

// RSA encryption helper
async function rsaEncrypt(
  data: string,
  publicKey: CryptoKey
): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      publicKey,
      Buffer.from(data, 'hex')
    )
  )
}

// Recovery: Normal flow (wallet intact)
async function recoverMasterPassword(
  guardianApprovals: [GuardianSignature, GuardianSignature]
): Promise<string> {
  const shares: string[] = []
  
  // 1. Decrypt shares from guardians (Layer 3)
  for (const approval of guardianApprovals) {
    const encryptedShare = await guardianContract.claimShare(approval)
    const decryptedShare = await rsaDecrypt(encryptedShare, userWalletPrivateKey)
    shares.push(decryptedShare)
  }
  
  // 2. Combine shares to get encrypted password (Layer 2)
  const encryptedPasswordHex = secrets.combine(shares)
  const encryptedPassword = Buffer.from(encryptedPasswordHex, 'hex')
  
  // 3. Fetch recovery key from contract (owner-only witness function)
  const recoveryKey = await vaultRegistry.getRecoveryKey()
  
  // 4. Decrypt password with recovery key (Layer 1)
  const iv = encryptedPassword.slice(0, 16)
  const authTag = encryptedPassword.slice(-16)
  const ciphertext = encryptedPassword.slice(16, -16)
  
  const decipher = createDecipheriv('aes-256-gcm', recoveryKey, iv)
  decipher.setAuthTag(authTag)
  
  const masterPassword = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]).toString('utf8')
  
  return masterPassword
}

// Recovery: Catastrophic loss (lost primary wallet + password)
async function recoverWithBackupWallet(
  backupWallet: Wallet,
  guardianApprovals: [GuardianSignature, GuardianSignature]
): Promise<string> {
  // 1. Transfer ownership using backup wallet's special permission
  await vaultRegistry.transferOwnershipFromBackup(
    backupWallet.address,
    backupWallet.signature
  )
  
  // 2. Now backup wallet is owner, access recovery key
  const recoveryKey = await vaultRegistry.getRecoveryKey()
  
  // 3. Decrypt shares and combine (same as normal recovery)
  const shares: string[] = []
  for (const approval of guardianApprovals) {
    const encryptedShare = await guardianContract.claimShare(approval)
    const decryptedShare = await rsaDecrypt(encryptedShare, backupWallet.privateKey)
    shares.push(decryptedShare)
  }
  
  const encryptedPasswordHex = secrets.combine(shares)
  const encryptedPassword = Buffer.from(encryptedPasswordHex, 'hex')
  
  // 4. Decrypt password with recovery key
  // (Recovery key is wallet-independent - works with any owner!)
  const iv = encryptedPassword.slice(0, 16)
  const authTag = encryptedPassword.slice(-16)
  const ciphertext = encryptedPassword.slice(16, -16)
  
  const decipher = createDecipheriv('aes-256-gcm', recoveryKey, iv)
  decipher.setAuthTag(authTag)
  
  const masterPassword = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]).toString('utf8')
  
  return masterPassword
}

// Ownership transfer: Re-encrypt shares for new wallet
async function transferOwnershipWithReencryption(
  newWallet: WalletAddress,
  masterPassword: string  // User must know password
): Promise<void> {
  // 1. Fetch recovery key (current owner only)
  const recoveryKey = await vaultRegistry.getRecoveryKey()
  
  // 2. Re-encrypt password with same recovery key (key is portable)
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', recoveryKey, iv)
  const encryptedPassword = Buffer.concat([
    iv,
    cipher.update(masterPassword, 'utf8'),
    cipher.final(),
    cipher.getAuthTag()
  ])
  
  // 3. Re-split and re-encrypt shares for new guardians (if different)
  const encryptedHex = encryptedPassword.toString('hex')
  const shares = secrets.share(encryptedHex, 3, 2)
  
  // ... encrypt shares with guardian keys and store
  
  // 4. Transfer ownership (recovery key stays the same!)
  await vaultRegistry.transferOwnership(newWallet)
}
```

**Midnight Smart Contract Updates:**

```typescript
// VaultRegistry.compact (updated)
contract VaultRegistry {
  private state {
    vaultCID: String
    encryptionPublicKey: Bytes
    recoveryKey: Bytes  // NEW: Wallet-independent recovery key
    backupWallet: WalletAddress  // NEW: For catastrophic loss
  }
  
  @witness
  function getRecoveryKey(): Bytes {
    // Only current owner can access
    require(this.sender == this.public.owner, "Not owner")
    return this.private.recoveryKey
  }
  
  function transferOwnershipFromBackup(newOwner: WalletAddress) {
    // Allow backup wallet to transfer in emergency
    require(this.sender == this.private.backupWallet, "Not backup wallet")
    this.public.owner = newOwner
  }
}
```

**Enforcement:**
- Recovery key MUST be 32 bytes (AES-256)
- Recovery key MUST be stored in contract private state (never exposed)
- Master password MUST be encrypted before Shamir splitting
- Backup wallet MUST be configured during setup (cannot be optional)
- Share indices MUST be 0, 1, 2 (for 2-of-3 threshold)
- Each share MUST be encrypted with guardian's public key (RSA-OAEP-SHA256)

**Testing Requirements:**

Given the complexity of 6 advanced guardian mechanisms (35+ critical test scenarios), comprehensive testing is mandatory:

```typescript
// Test configuration for guardian recovery
interface GuardianTestConfig {
  timeLockDuration: number  // 5 minutes for CI, 72 hours for production
  mockMidnightRPC: boolean  // true for unit tests, false for integration
  enableChaosMode: boolean  // true for concurrent operation testing
}

// Testnet deployment with configurable time-lock
const TESTNET_CONFIG: GuardianTestConfig = {
  timeLockDuration: 5 * 60 * 1000,  // 5 minutes for CI
  mockMidnightRPC: true,
  enableChaosMode: false
}
```

**Test Coverage Matrix:**

1. **Backup Wallet Time-Lock** (3 scenarios): Happy path, cancellation, malicious actor
2. **Guardian Rotation** (9 scenarios): Individual rotation, failures, concurrent operations
3. **Multi-Backup Wallets** (6 scenarios): Priority conflicts, race conditions
4. **Recovery Key Rotation** (4 scenarios): Success, partial failure, concurrent operations
5. **Guardian Portal** (5 scenarios): Connection failures, approvals, network timeouts
6. **Cross-Device Recovery** (8 scenarios): Multi-device claims, double-claim prevention, Byzantine failures

**Chaos Testing:** Concurrent backup transfers, recovery + transfer races, network partitions during approval

### Pattern 7: Test Organization

**Structure Pattern:**
```
contracts/
├── VaultRegistry.compact
├── GuardianRecovery.compact
├── AliasRegistry.compact
└── __tests__/                    # Separate test directory
    ├── VaultRegistry.test.ts
    ├── GuardianRecovery.test.ts
    └── AliasRegistry.test.ts

apps/browser-extension/src/
├── services/
│   ├── midnightClient.ts
│   ├── midnightClient.test.ts   # Co-located
│   ├── ipfsClient.ts
│   └── ipfsClient.test.ts       # Co-located
├── lib/
│   ├── conflictResolver.ts
│   ├── conflictResolver.test.ts # Co-located
│   ├── shamirSharing.ts
│   └── shamirSharing.test.ts    # Co-located
└── components/
    ├── WalletConnect.tsx
    └── WalletConnect.test.tsx    # Co-located

smtp-bridge/src/
├── services/
│   ├── emailEncryptor.ts
│   └── emailEncryptor.test.ts   # Co-located
└── __tests__/                    # Integration tests separate
    └── smtp-flow.integration.test.ts
```

**Test Naming:**
```typescript
// Unit test files: {filename}.test.ts
midnightClient.test.ts
conflictResolver.test.ts

// Integration test files: {feature}.integration.test.ts
vault-sync.integration.test.ts
guardian-recovery.integration.test.ts

// Contract test files: {ContractName}.test.ts
VaultRegistry.test.ts
GuardianRecovery.test.ts
```

**Enforcement:**
- Contract tests MUST use separate `__tests__/` directory
- Service/lib tests MUST be co-located with source files
- Integration tests MUST use `.integration.test.ts` suffix
- Test files MUST use `.test.ts` extension (not `.spec.ts`)

### Enforcement Guidelines

**All AI Agents MUST:**

1. **Verify naming conventions** before creating any file, variable, or database field
2. **Use CIDv1** for all IPFS operations (no exceptions)
3. **Wrap all contract errors** in standardized error structure
4. **Implement conflict checking** at load and save points
5. **Follow monorepo structure** exactly as defined (no custom directories)
6. **Co-locate service tests** with source files
7. **Use 2-of-3 Shamir threshold** for guardian recovery (not 3-of-5 or other)

**Pattern Verification:**

Before committing code, AI agents should verify:
```bash
# Naming convention check
grep -r "vault_cid\|ipfsCID\|contentId" . && echo "❌ CID naming violation"

# CID version check
grep -r "cidVersion: 0" . && echo "❌ Using CIDv0 instead of CIDv1"

# Test location check
find contracts/ -name "*.test.ts" ! -path "*/__tests__/*" && echo "❌ Contract test not in __tests__/"

# Error structure check
grep -r "throw new Error" apps/browser-extension/src && echo "⚠️  Review: Should use AppError structure"
```

**Pattern Violation Process:**

1. **Detection:** Automated checks in pre-commit hooks or CI
2. **Documentation:** Log violation in `docs/pattern-violations.md`
3. **Resolution:** Fix immediately before proceeding with new work
4. **Update:** If pattern needs adjustment, update this section and notify all agents

### Pattern Examples

**Good Example - Vault Save with Conflict Check:**
```typescript
// ✅ CORRECT: Follows all patterns
async function saveVault(vault: Vault): Promise<void> {
  try {
    // Pattern 5: Check for conflicts before save
    const remoteCID = await midnightClient.getVaultCID()
    const cachedCID = await indexedDB.get('vaultCache', 'lastKnownCID')
    
    if (remoteCID !== cachedCID) {
      const remoteVault = await ipfsClient.cat(remoteCID)
      vault = await resolveConflict(vault, remoteVault)
    }
    
    // Pattern 3: Upload with CIDv1
    const newCID = await ipfsClient.add(vault.encrypted, { 
      cidVersion: 1,
      pin: true 
    })
    
    // Pattern 4: Proper error handling
    await midnightClient.updateVault(newCID.toString())
    
  } catch (error) {
    throw createError(
      'VAULT_SAVE_FAILED',
      'Could not save vault. Please try again.',
      error.message
    )
  }
}
```

**Anti-Pattern - What NOT to do:**
```typescript
// ❌ INCORRECT: Multiple pattern violations
async function saveVault(vault: any): Promise<void> {
  // ❌ No conflict check (violates Pattern 5)
  // ❌ Using snake_case for variable (violates Pattern 2)
  const vault_data = JSON.stringify(vault)
  
  // ❌ Using CIDv0 (violates Pattern 3)
  const result = await ipfs.add(vault_data, { cidVersion: 0 })
  
  // ❌ Storing CID as "cid" instead of "vaultCID" (violates Pattern 3)
  const cid = result.cid
  
  // ❌ Throwing generic Error instead of AppError (violates Pattern 4)
  try {
    await contract.update(cid)
  } catch (e) {
    throw new Error('Failed to update')  // No error code, no context
  }
}
```

These implementation patterns ensure that multiple AI agents can work on different components of the AliasVault architecture while maintaining code compatibility and consistency. All future implementation work must adhere to these patterns without exception.
# AliasVault Project Structure - Complete Directory Tree

## Architecture Decision Records (ADRs)

### ADR-001: Monorepo with pnpm Workspaces
**Decision:** Use pnpm workspace monorepo structure  
**Rationale:** Fastest package manager (hard-linked node_modules), unified CI/CD, atomic cross-package changes  
**Alternatives Rejected:** Separate repos (type sharing pain), npm/yarn (slower), Lerna (maintenance mode)  
**Consequences:** ✅ Single lock file, shared deps, workspace protocol | ⚠️ Requires pnpm globally

### ADR-002: MeshJS Template Structure for Contracts + CLI
**Decision:** Adopt MeshJS template for `contracts/` and `cli/`, discard `react/` folder  
**Rationale:** Official Midnight conventions, pre-configured Compact compiler, easier to follow docs  
**Alternatives Rejected:** Build from scratch (reinventing wheel), use full template (conflicts with WXT)  
**Consequences:** ✅ Follows conventions, upstream updates | ⚠️ Must align with template structure

### ADR-003: Shared Business Logic Package
**Decision:** Create `shared/logic/` with pure functions for platform-agnostic business logic  
**Rationale:** Prevents platform drift, enables fast unit testing (50ms vs 5min), single source of truth  
**Alternatives Rejected:** Duplicate logic (code drift), wait until mobile (refactor under pressure)  
**Consequences:** ✅ Fast iteration, prevents drift | ⚠️ Lint rule: no business logic in apps/ services

### ADR-004: Centralized Contract Configuration
**Decision:** `shared/config/contracts.ts` as single source of truth for contract addresses  
**Rationale:** Deploy once updates all apps, type-safe, version tracking prevents compatibility issues  
**Alternatives Rejected:** ENV vars per app (manual updates), export from contracts/ (circular deps)  
**Consequences:** ✅ Deploy once, type-safe, versioned | ⚠️ Lint rule: no manual address hardcoding

### ADR-005: Services Grouped Under `services/`
**Decision:** Group SMTP bridge + guardian portal under `services/` directory  
**Rationale:** Clear separation: apps (user-facing) vs services (infrastructure), easier to navigate  
**Alternatives Rejected:** Root level (flat structure), under apps/ (conceptually wrong)  
**Consequences:** ✅ Clear separation, service-specific CI/CD | ⚠️ Services must not depend on apps

### ADR-006: MVP Simplifications (Cross-Functional Decisions)
**Decisions:** Mobile = README only | SMTP = 1 replica → 3 on launch | Guardian portal = add RECOVERY.md  
**Rationale:** PM - don't over-engineer | Engineer - can't compromise security | Designer - fast iteration  
**Alternatives Rejected:** Full mobile scaffold (not needed), 3 SMTP replicas from day 1 (overkill)  
**Consequences:** ✅ Faster MVP launch, clear migration path | ⚠️ Monitor SMTP, scale on launch day

---

## Complete Project Directory Structure

```
aliasvault/
├── README.md
├── package.json                     # Root workspace config (pnpm workspace)
├── pnpm-workspace.yaml              # Workspace definition
├── tsconfig.json                    # Root TypeScript config
├── .env.example                     # Environment template
├── .gitignore
├── docker-compose.yml               # Midnight local network stack
├── turbo.json                       # Build orchestration with caching
│
├── .github/
│   └── workflows/
│       ├── ci.yml                   # Test + lint on PR
│       ├── deploy-contracts.yml     # Testnet contract deployment
│       └── deploy-extension.yml     # Extension packaging
│
├── docs/                            # Existing documentation
│   ├── project-knowledge-index.md
│   ├── midnight-developer-guide.md
│   ├── data-models-server.md        # Legacy (reference only)
│   └── api-contracts-server.md      # Legacy (reference only)
│
├── contracts/                       # From MeshJS template (unchanged)
│   ├── VaultRegistry.compact
│   ├── GuardianRecovery.compact
│   ├── AliasRegistry.compact
│   ├── package.json
│   ├── tsconfig.json
│   ├── compact.config.json          # Compact compiler config
│   └── __tests__/
│       ├── VaultRegistry.test.ts
│       ├── GuardianRecovery.test.ts
│       ├── AliasRegistry.test.ts
│       └── helpers/
│           ├── mockMidnight.ts
│           └── fixtures.ts
│
├── cli/                             # From MeshJS template (unchanged)
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   ├── deploy.ts                    # Contract deployment script
│   ├── interact.ts                  # Contract interaction CLI
│   ├── setup-standalone.ts          # Local network setup
│   └── scripts/
│       ├── fund-wallet.ts
│       ├── generate-dust.ts
│       └── verify-deployment.ts
│
├── apps/                            # Multi-platform applications
│   ├── browser-extension/           # WXT browser extension (current)
│       ├── package.json
│       ├── wxt.config.ts
│       ├── tsconfig.json
│       ├── .env.example
│       ├── manifest.json
│       │
│       ├── public/
│       │   ├── icon-16.png
│       │   ├── icon-48.png
│       │   ├── icon-128.png
│       │   └── assets/
│       │
│       ├── src/
│       │   ├── background/           # Service worker
│       │   │   ├── index.ts
│       │   │   ├── syncManager.ts   # Cross-device sync orchestration
│       │   │   └── notificationHandler.ts
│       │   │
│       │   ├── popup/                # Extension popup UI
│       │   │   ├── index.tsx
│       │   │   ├── App.tsx
│       │   │   └── pages/
│       │   │       ├── Dashboard.tsx
│       │   │       ├── VaultManager.tsx
│       │   │       ├── GuardianSetup.tsx
│       │   │       ├── RecoveryFlow.tsx
│       │   │       └── Settings.tsx
│       │   │
│       │   ├── components/           # React components
│       │   │   ├── ui/               # Base UI components
│       │   │   │   ├── Button.tsx
│       │   │   │   ├── Input.tsx
│       │   │   │   ├── Modal.tsx
│       │   │   │   └── Spinner.tsx
│       │   │   │
│       │   │   ├── wallet/
│       │   │   │   ├── WalletConnect.tsx
│       │   │   │   ├── WalletInfo.tsx
│       │   │   │   └── WalletSelector.tsx
│       │   │   │
│       │   │   ├── vault/
│       │   │   │   ├── VaultList.tsx
│       │   │   │   ├── CredentialCard.tsx
│       │   │   │   ├── CredentialForm.tsx
│       │   │   │   └── ConflictResolver.tsx
│       │   │   │
│       │   │   ├── recovery/
│       │   │   │   ├── GuardianConfig.tsx
│       │   │   │   ├── BackupWalletSetup.tsx
│       │   │   │   ├── RecoveryInitiate.tsx
│       │   │   │   ├── RecoveryStatus.tsx
│       │   │   │   └── ShareClaim.tsx
│       │   │   │
│       │   │   └── alias/
│       │   │       ├── AliasGenerator.tsx
│       │   │       ├── AliasList.tsx
│       │   │       └── EmailViewer.tsx
│       │   │
│       │   ├── services/              # Business logic layer
│       │   │   ├── midnightClient.ts  # Midnight SDK wrapper
│       │   │   │   └── midnightClient.test.ts
│       │   │   │
│       │   │   ├── ipfsClient.ts      # IPFS + Pinata client
│       │   │   │   └── ipfsClient.test.ts
│       │   │   │
│       │   │   ├── vaultService.ts    # Vault CRUD + sync
│       │   │   │   └── vaultService.test.ts
│       │   │   │
│       │   │   ├── guardianService.ts # Guardian recovery logic
│       │   │   │   └── guardianService.test.ts
│       │   │   │
│       │   │   ├── aliasService.ts    # Alias generation + management
│       │   │   │   └── aliasService.test.ts
│       │   │   │
│       │   │   └── walletService.ts   # Lace wallet integration (Mesh SDK)
│       │   │       └── walletService.test.ts
│       │   │
│       │   ├── lib/                   # Utility libraries
│       │   │   ├── encryption.ts      # Existing Argon2id + AES-256-GCM
│       │   │   │   └── encryption.test.ts
│       │   │   │
│       │   │   ├── conflictResolver.ts # Credential-level merge
│       │   │   │   └── conflictResolver.test.ts
│       │   │   │
│       │   │   ├── shamirSharing.ts   # secrets.js-34r7h wrapper
│       │   │   │   └── shamirSharing.test.ts
│       │   │   │
│       │   │   ├── errorHandler.ts    # AppError factory
│       │   │   │   └── errorHandler.test.ts
│       │   │   │
│       │   │   └── utils.ts           # General utilities
│       │   │       └── utils.test.ts
│       │   │
│       │   ├── types/                 # TypeScript type definitions
│       │   │   ├── vault.ts
│       │   │   ├── credential.ts
│       │   │   ├── guardian.ts
│       │   │   ├── alias.ts
│       │   │   ├── wallet.ts
│       │   │   └── errors.ts
│       │   │
│       │   ├── hooks/                 # React hooks
│       │   │   ├── useWallet.ts
│       │   │   ├── useVault.ts
│       │   │   ├── useGuardians.ts
│       │   │   └── useMidnight.ts
│       │   │
│       │   ├── store/                 # Local state (IndexedDB)
│       │   │   ├── vaultCache.ts
│       │   │   ├── conflictLog.ts
│       │   │   └── guardianShares.ts
│       │   │
│       │   └── config/
│       │       ├── constants.ts        # MAX_RETRY_ATTEMPTS, etc.
│       │       ├── errorCodes.ts       # Error code constants
│       │       └── midnight.config.ts  # Midnight RPC endpoints
│       │
│       └── __tests__/
│           ├── integration/
│           │   ├── vault-sync.integration.test.ts
│           │   ├── guardian-recovery.integration.test.ts
│           │   └── conflict-resolution.integration.test.ts
│           │
│           └── e2e/
│               ├── onboarding.e2e.test.ts
│               ├── vault-operations.e2e.test.ts
│               └── recovery-flow.e2e.test.ts
│
│   └── mobile/                      # React Native app (future - not scaffolded yet)
│       └── README.md                # Mobile implementation guide
│           # "Mobile app will use shared/logic/ for business logic.
│           #  See apps/browser-extension/ for reference implementation.
│           #  When ready to implement:
│           #  1. Install Expo: npx create-expo-app@latest
│           #  2. Copy shared/logic/ imports from extension
│           #  3. Implement platform-specific UI (React Native)"
│
├── services/                        # Infrastructure services (grouped)
│   ├── smtp-bridge/                 # Express microservice
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── .env.example
│   │   ├── Dockerfile
│   │   ├── docker-compose.yml           # Local development
│   │   ├── docker-compose.prod.yml      # Production (1 replica + health + auto-restart)
│   │   │   # Start simple for MVP, scale to 3 replicas on launch day
│   │   │
│   │   ├── src/
│   │   │   ├── index.ts                 # Express app entry
│   │   │   ├── app.ts                   # Express config
│   │   │   ├── healthcheck.ts           # /health endpoint for monitoring
│   │   │   │
│   │   │   ├── routes/
│   │   │   │   └── email.routes.ts      # POST /receive-email
│   │   │   │
│   │   │   ├── services/
│   │   │   │   ├── midnightRPC.ts       # Midnight contract calls
│   │   │   │   │   └── midnightRPC.test.ts
│   │   │   │   │
│   │   │   │   ├── ipfsUpload.ts        # IPFS email storage
│   │   │   │   │   └── ipfsUpload.test.ts
│   │   │   │   │
│   │   │   │   ├── emailEncryptor.ts    # RSA-OAEP email encryption
│   │   │   │   │   └── emailEncryptor.test.ts
│   │   │   │   │
│   │   │   │   └── moxIntegration.ts    # Mox SMTP webhook
│   │   │   │       └── moxIntegration.test.ts
│   │   │   │
│   │   │   ├── config/
│   │   │   │   ├── env.ts
│   │   │   │   └── midnight.config.ts
│   │   │   │
│   │   │   └── types/
│   │   │       ├── email.ts
│   │   │       └── midnight.ts
│   │   │
│   │   └── __tests__/
│   │       ├── smtp-flow.integration.test.ts
│   │       └── fixtures/
│   │           └── sampleEmails.ts
│   │
│   └── guardian-portal/             # Static IPFS-hosted React app
│       ├── package.json
│       ├── vite.config.ts
│       ├── tsconfig.json
│       ├── index.html
│       │
│       ├── deploy/                      # Deployment scripts
│       │   ├── pin-to-ipfs.sh           # Upload dist/ to Pinata
│       │   ├── verify-pin.sh            # Check pin health
│       │   ├── update-dns.sh            # Update DNS TXT record with new CID
│       │   └── RECOVERY.md              # Failover instructions if IPFS pin expires
│       │       # "Emergency Recovery Steps:
│       │       #  1. Rebuild: npm run build
│       │       #  2. Re-pin: ./pin-to-ipfs.sh
│       │       #  3. Update DNS: ./update-dns.sh
│       │       #  4. Verify: curl https://guardians.aliasvault.id"
│       │
│       ├── .github/
│       │   └── workflows/
│       │       └── verify-ipfs-pin.yml  # Weekly pin verification CI
│       │
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   │
│       │   ├── pages/
│       │   │   ├── ApprovalPage.tsx     # /approve/:cid
│       │   │   └── NotFoundPage.tsx
│       │   │
│       │   ├── components/
│       │   │   ├── WalletConnect.tsx
│       │   │   ├── RecoveryDetails.tsx
│       │   │   └── ApprovalButton.tsx
│       │   │
│       │   ├── services/
│       │   │   ├── ipfsClient.ts        # Fetch metadata from CID
│       │   │   └── midnightClient.ts    # Submit approval to contract
│       │   │
│       │   └── types/
│       │       └── recovery.ts
│       │
│       └── dist/                        # Build output (to pin to IPFS)
│
├── shared/                          # Shared code (DRY principle)
│   ├── package.json
│   ├── tsconfig.json
│   │
│   ├── logic/                       # Shared business logic (platform-agnostic)
│   │   ├── vaultLogic.ts            # Pure functions for vault operations
│   │   │   └── vaultLogic.test.ts
│   │   ├── guardianLogic.ts         # Guardian recovery logic
│   │   │   └── guardianLogic.test.ts
│   │   ├── aliasLogic.ts            # Alias generation/validation
│   │   │   └── aliasLogic.test.ts
│   │   ├── encryptionLogic.ts       # Crypto operations
│   │   │   └── encryptionLogic.test.ts
│   │   └── index.ts                 # Re-export all logic
│   │
│   ├── types/                       # Common TypeScript types
│   │   ├── errors.ts                # AppError, ContractError interfaces
│   │   ├── midnight.ts              # WalletAddress, CIDv1String, etc.
│   │   ├── ipfs.ts                  # IPFS-related types
│   │   └── index.ts                 # Re-export all types
│   │
│   ├── config/                      # Centralized configuration
│   │   ├── contracts.ts             # Contract addresses & ABIs (single source of truth)
│   │   ├── ipfs.ts                  # IPFS/Pinata config
│   │   └── index.ts                 # Re-export all config
│   │
│   └── constants/                   # Shared constants
│       ├── errorCodes.ts            # ErrorCodes, RETRYABLE_CODES
│       └── index.ts                 # Re-export all constants
│
└── _bmad/                           # Existing BMM workflow config
    └── ...

```

## Architectural Boundaries

### API Boundaries

**Midnight Contracts (Public Functions):**
- `VaultRegistry.updateVault(newCID: String)` - Update vault CID
- `VaultRegistry.getVaultCID(): String` (witness) - Retrieve vault CID
- `VaultRegistry.transferOwnership(newOwner: WalletAddress)` - Transfer vault
- `VaultRegistry.getRecoveryKey(): Bytes` (witness) - Fetch recovery key
- `GuardianRecovery.initiateRecovery(guardians: WalletAddress[])` - Start recovery
- `GuardianRecovery.approveRecovery(vaultOwner: WalletAddress)` - Guardian approval
- `GuardianRecovery.claimShares(vaultOwner: WalletAddress): GuardianShare[]` (witness)
- `AliasRegistry.registerAlias(alias: String)` - Register email alias
- `AliasRegistry.getOwner(alias: String): WalletAddress` - Lookup alias owner

**IPFS API (Pinata Integration):**
- `POST /pinning/pinFileToIPFS` - Upload encrypted vault
- `GET /data/pinList` - List pinned CIDs
- `ipfs.cat(cid)` - Retrieve vault data

**SMTP Bridge API:**
- `POST /receive-email` - Mox webhook endpoint
  - Body: `{ to, from, subject, body }`
  - Response: `{ success: boolean, cid: string }`

**Browser Extension Internal APIs:**
- Message passing between popup ↔ background script
- IndexedDB queries for local cache
- Chrome storage API for settings

### Component Boundaries

**Browser Extension:**
- **Popup UI** ↔ **Background Service Worker** (via `chrome.runtime.sendMessage`)
- **Services** ↔ **Components** (React props + hooks)
- **Vault Service** ↔ **Midnight Client** (async function calls)
- **Vault Service** ↔ **IPFS Client** (async function calls)

**Cross-Component Communication:**
- React Context for global state (wallet connection, vault sync status)
- Custom hooks (`useWallet`, `useVault`) for state management
- Event emitters for background sync notifications

### Service Boundaries

**Guardian Portal:**
- Static site (no backend)
- Direct Midnight contract interaction via Lace wallet
- IPFS client for fetching recovery metadata

**SMTP Bridge:**
- Stateless microservice
- No database (all state on-chain or IPFS)
- Environment variables for Midnight RPC + Pinata config

**Browser Extension:**
- Thick client (all business logic local)
- IndexedDB for caching vault data
- Direct Midnight + IPFS integration

### Data Boundaries

**On-Chain (Midnight Public State):**
- Vault owner wallet address
- Last updated timestamp
- Recovery request status (pending/approved/claimed)
- Guardian approval signatures

**On-Chain (Midnight Private State):**
- Vault CID (encrypted location)
- Recovery key (wallet-independent AES-256 key)
- Guardian encrypted shares
- Backup wallet addresses

**Off-Chain (IPFS):**
- Encrypted vault blobs (AES-256-GCM)
- Encrypted email data (RSA-OAEP)
- Recovery metadata (public, hashed wallet addresses)

**Client-Side (IndexedDB):**
- Cached vault data
- Conflict resolution log
- Last known vault CID
- Sync status

## Requirements to Structure Mapping

### Vault Management (FR1-FR7)

**Components:**
- `apps/browser-extension/src/components/vault/VaultList.tsx`
- `apps/browser-extension/src/components/vault/CredentialCard.tsx`
- `apps/browser-extension/src/components/vault/CredentialForm.tsx`

**Services:**
- `apps/browser-extension/src/services/vaultService.ts` - CRUD operations
- `apps/browser-extension/src/services/ipfsClient.ts` - Upload/download
- `apps/browser-extension/src/lib/encryption.ts` - Argon2id + AES

**Contracts:**
- `contracts/VaultRegistry.compact` - CID storage

**Tests:**
- `apps/browser-extension/src/services/vaultService.test.ts` (unit)
- `apps/browser-extension/__tests__/integration/vault-sync.integration.test.ts`

### Guardian Recovery (FR8-FR15)

**Components:**
- `apps/browser-extension/src/components/recovery/GuardianConfig.tsx` - Setup UI
- `apps/browser-extension/src/components/recovery/BackupWalletSetup.tsx`
- `apps/browser-extension/src/components/recovery/RecoveryInitiate.tsx`
- `apps/browser-extension/src/components/recovery/ShareClaim.tsx`

**Services:**
- `apps/browser-extension/src/services/guardianService.ts` - Recovery logic
- `apps/browser-extension/src/lib/shamirSharing.ts` - secrets.js-34r7h

**Contracts:**
- `contracts/GuardianRecovery.compact` - Share storage, 72-hour time-lock
- `contracts/VaultRegistry.compact` - Recovery key storage

**Guardian Portal:**
- `guardian-portal/src/pages/ApprovalPage.tsx` - Guardian approval UI
- `guardian-portal/src/services/midnightClient.ts` - Submit approval

**Tests:**
- `contracts/__tests__/GuardianRecovery.test.ts` (unit)
- `apps/browser-extension/__tests__/integration/guardian-recovery.integration.test.ts`

### Multi-Device Security (FR16-FR19)

**Components:**
- `apps/browser-extension/src/components/vault/ConflictResolver.tsx` - Merge UI
- `apps/browser-extension/src/background/syncManager.ts` - Sync orchestration
- `apps/browser-extension/src/background/notificationHandler.ts` - Push notifications

**Services:**
- `apps/browser-extension/src/lib/conflictResolver.ts` - Credential-level merge
- `apps/browser-extension/src/store/conflictLog.ts` - Conflict tracking

**Contracts:**
- `contracts/VaultRegistry.compact` - Ownership transfer, CID updates

**Tests:**
- `apps/browser-extension/src/lib/conflictResolver.test.ts` (unit)
- `apps/browser-extension/__tests__/integration/conflict-resolution.integration.test.ts`

### Alias Generation (FR20-FR25)

**Components:**
- `apps/browser-extension/src/components/alias/AliasGenerator.tsx`
- `apps/browser-extension/src/components/alias/AliasList.tsx`
- `apps/browser-extension/src/components/alias/EmailViewer.tsx`

**Services:**
- `apps/browser-extension/src/services/aliasService.ts` - Alias CRUD

**Contracts:**
- `contracts/AliasRegistry.compact` - Alias → Owner mapping

**SMTP Bridge:**
- `smtp-bridge/src/routes/email.routes.ts` - Email reception
- `smtp-bridge/src/services/emailEncryptor.ts` - RSA-OAEP encryption
- `smtp-bridge/src/services/ipfsUpload.ts` - Encrypted email storage

**Tests:**
- `contracts/__tests__/AliasRegistry.test.ts` (unit)
- `smtp-bridge/__tests__/smtp-flow.integration.test.ts`

## Integration Points

### Internal Communication

**Browser Extension (Popup ↔ Background):**
```typescript
// From popup
chrome.runtime.sendMessage({
  type: 'SYNC_VAULT',
  payload: { force: true }
})

// Background listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SYNC_VAULT') {
    syncManager.sync(message.payload.force)
    sendResponse({ success: true })
  }
})
```

**Service Layer Communication:**
```typescript
// vaultService.ts depends on midnightClient + ipfsClient
import { midnightClient } from './midnightClient'
import { ipfsClient } from './ipfsClient'

async function saveVault(vault: Vault) {
  const remoteCID = await midnightClient.getVaultCID()
  // ... conflict check
  const newCID = await ipfsClient.upload(encrypted)
  await midnightClient.updateVault(newCID)
}
```

### External Integrations

**Lace Wallet (via Mesh SDK):**
```typescript
// apps/browser-extension/src/services/walletService.ts
import { BrowserWallet } from '@meshsdk/core'

export async function connectWallet(): Promise<WalletAddress> {
  const wallet = await BrowserWallet.enable('lace')
  return wallet.getChangeAddress()
}
```

**Pinata IPFS:**
```typescript
// apps/browser-extension/src/services/ipfsClient.ts
import { create } from 'ipfs-http-client'

const client = create({
  host: 'api.pinata.cloud',
  port: 443,
  protocol: 'https',
  headers: { authorization: `Bearer ${PINATA_JWT}` }
})
```

**Midnight Network:**
```typescript
// apps/browser-extension/src/services/midnightClient.ts
import { MidnightRPC } from '@midnight-ntwrk/client-sdk'

const rpc = new MidnightRPC(process.env.MIDNIGHT_RPC_URL)
```

**Mox SMTP:**
```typescript
// smtp-bridge/src/services/moxIntegration.ts
// Mox forwards emails to POST /receive-email webhook
```

### Data Flow

**Vault Update Flow:**
```
User edits credential → Popup UI
  ↓
vaultService.saveVault(vault)
  ↓
┌─────────────────────────────────┐
│ 1. Encrypt with master password │ (encryption.ts)
└─────────────────────────────────┘
  ↓
┌─────────────────────────────────┐
│ 2. Check for conflicts          │ (midnightClient.getVaultCID)
└─────────────────────────────────┘
  ↓
┌─────────────────────────────────┐
│ 3. Upload to IPFS               │ (ipfsClient.upload)
└─────────────────────────────────┘
  ↓
┌─────────────────────────────────┐
│ 4. Update contract CID          │ (midnightClient.updateVault)
└─────────────────────────────────┘
  ↓
┌─────────────────────────────────┐
│ 5. Update IndexedDB cache       │ (vaultCache.set)
└─────────────────────────────────┘
```

**Guardian Recovery Flow:**
```
User loses password → Recovery UI
  ↓
guardianService.initiateRecovery()
  ↓
┌─────────────────────────────────┐
│ 1. Call contract.initiateRe...  │ (midnightClient)
└─────────────────────────────────┘
  ↓
┌─────────────────────────────────┐
│ 2. Upload metadata to IPFS      │ (ipfsClient)
└─────────────────────────────────┘
  ↓
┌─────────────────────────────────┐
│ 3. Get portal URL               │ (guardians.aliasvault.id/approve/CID)
└─────────────────────────────────┘
  ↓
User shares URL with guardians (email/SMS)
  ↓
Guardians visit portal → Connect wallet → Approve
  ↓
┌─────────────────────────────────┐
│ 4. Contract records approvals   │ (72-hour lock starts)
└─────────────────────────────────┘
  ↓
After 72 hours: User claims shares
  ↓
┌─────────────────────────────────┐
│ 5. Combine shares → encrypted   │ (shamirSharing.ts)
│    password                      │
└─────────────────────────────────┘
  ↓
┌─────────────────────────────────┐
│ 6. Get recovery key from        │ (midnightClient.getRecoveryKey)
│    contract                      │
└─────────────────────────────────┘
  ↓
┌─────────────────────────────────┐
│ 7. Decrypt password             │ (encryption.aesDecrypt)
└─────────────────────────────────┘
  ↓
User resets master password
```

## File Organization Patterns

### Configuration Files

**Root Level:**
- `package.json` - Workspace config, scripts
- `pnpm-workspace.yaml` - Workspace packages
- `tsconfig.json` - Base TypeScript config (extended by packages)
- `.env.example` - Environment template
- `docker-compose.yml` - Local Midnight network

**Package Level:**
- Each package has own `package.json` + `tsconfig.json`
- Package-specific `.env.example` files
- WXT extension has `wxt.config.ts` + `manifest.json`
- Contracts have `compact.config.json`

### Source Organization

**By Concern (Browser Extension):**
```
src/
├── components/   # UI (React)
├── services/     # Business logic
├── lib/          # Utilities
├── types/        # TypeScript definitions
├── hooks/        # React hooks
├── store/        # IndexedDB
└── config/       # Constants
```

**By Feature (SMTP Bridge):**
```
src/
├── routes/       # Express routes
├── services/     # Business logic
├── config/       # Environment
└── types/        # TypeScript definitions
```

### Test Organization

**Browser Extension:**
- Unit tests: Co-located (e.g., `vaultService.test.ts`)
- Integration tests: `__tests__/integration/`
- E2E tests: `__tests__/e2e/`

**Contracts:**
- Separate `__tests__/` directory for all contract tests

**SMTP Bridge:**
- Unit tests: Co-located in `services/`
- Integration tests: `__tests__/smtp-flow.integration.test.ts`

### Asset Organization

**Browser Extension:**
```
public/
├── icon-16.png
├── icon-48.png
├── icon-128.png
└── assets/
    └── (images, fonts, etc.)
```

**Guardian Portal:**
```
public/
└── assets/
    └── (logo, icons, etc.)
```

## Development Workflow Integration

### Development Server Structure

**Local Midnight Network:**
```bash
# Start local node, proof server, indexer (from MeshJS template)
npm run standalone-start
```

**Browser Extension:**
```bash
cd apps/browser-extension
npm run dev  # WXT dev server with HMR
```

**SMTP Bridge:**
```bash
cd smtp-bridge
npm run dev  # Express dev server with hot reload
```

**Guardian Portal:**
```bash
cd guardian-portal
npm run dev  # Vite dev server
```

### Build Process Structure

**Contracts:**
```bash
cd contracts
npm run build  # Compile Compact → TypeScript types
```

**Browser Extension:**
```bash
cd apps/browser-extension
npm run build  # WXT builds production extension (.zip)
```

**SMTP Bridge:**
```bash
cd smtp-bridge
npm run build  # TypeScript → dist/
docker build -t smtp-bridge .
```

**Guardian Portal:**
```bash
cd guardian-portal
npm run build  # Vite builds static site → dist/
# Pin dist/ to IPFS for hosting
```

### Deployment Structure

**Testnet Deployment:**
```bash
cd cli
npm run deploy  # Deploy contracts to Midnight Preview testnet
# Updates .env with deployed contract addresses
```

**Production Extension:**
```bash
cd apps/browser-extension
npm run build
# Upload .output/chrome-mv3.zip to Chrome Web Store
# Upload .output/firefox-mv2.zip to Firefox Add-ons
```

**SMTP Bridge:**
```bash
cd smtp-bridge
docker-compose up -d  # Deploy to VPS/cloud
```

**Guardian Portal:**
```bash
cd guardian-portal
npm run build
ipfs add -r dist/  # Returns CID
# Set aliasvault.id DNS TXT record to point to IPFS CID
```
## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:**

All architectural decisions work together harmoniously:

- ✅ **MeshJS Template + WXT Extension:** Hybrid approach successfully separates Midnight contracts (`contracts/`  + `cli/`) from browser extension (`apps/browser-extension/`). No conflicts.
- ✅ **pnpm Workspace + TurboRepo:** Package manager supports build orchestration. Workspace protocol enables cross-package dependencies (contracts → shared → apps).
- ✅ **Midnight SDK + Lace Wallet:** Wallet abstracts proof server interaction. Midnight RPC configured in `shared/config/`. Version compatibility ensured via shared config.
- ✅ **IPFS + Pinata:** CIDv1 enforcement consistent. Client-side encryption (AES-256-GCM) before upload. No version conflicts.
- ✅ **Guardian Recovery Stack:** Shamir Secret Sharing (`secrets.js-34r7h`) + RSA-OAEP + Midnight private state storage work together. 72-hour time-lock compatible with contract design.
- ✅ **React + WXT + Vite:** Browser extension uses WXT with React. Guardian portal uses Vite with React. Consistent UI framework reduces cognitive load.

**Pattern Consistency:**

Implementation patterns fully support architectural decisions:

- ✅ **Pattern 1 (Wallet Auth):** Aligns with Lace wallet decision. Mesh SDK implementation matches pattern.
- ✅ **Pattern 2 (Master Password):** Client-side Argon2id + AES-256-GCM consistent with zero-knowledge requirement.
- ✅ **Pattern 3 (CID Handling):** CIDv1 enforcement with type guards (`assertCIDv1`) matches IPFS decision. String storage format consistent.
- ✅ **Pattern 4 (Error Handling):** `RETRYABLE_CODES` array supports retry logic. Error factory compatible with async operations.
- ✅ **Pattern 5 (Conflict Resolution):** Credential-level merge supports multi-device requirement. Last-write-wins aligns with timestamp tracking.
- ✅ **Pattern 6 (Guardian Encryption):** Triple-layer encryption (master password → recovery key → Shamir → RSA-OAEP) matches guardian recovery decision.
- ✅ **Pattern 7 (Test Organization):** Co-located unit tests + separate integration tests matches monorepo structure.

**Structure Alignment:**

Project structure enables all architectural decisions:

- ✅ **Monorepo Structure:** 6 packages (`contracts/`, `cli/`, `apps/browser-extension/`, `apps/mobile/`, `services/smtp-bridge/`, `services/guardian-portal/`, `shared/`) support all decisions.
- ✅ **Shared Business Logic:** `shared/logic/` prevents platform drift (ADR-003). Pure functions work for both web and mobile.
- ✅ **Centralized Config:** `shared/config/contracts.ts` prevents version chaos (ADR-004). Single source of truth for contract addresses.
- ✅ **Services Grouping:** `services/` directory clearly separates infrastructure from user-facing apps (ADR-005).
- ✅ **MeshJS Compatibility:** `contracts/` and `cli/` match upstream template structure (ADR-002). Easy to apply official updates.
- ✅ **Integration Points:** Browser extension → Midnight contracts, IPFS, SMTP bridge all properly structured with clear boundaries.

### Requirements Coverage Validation ✅

**Functional Requirements Coverage:**

All FR1-FR25 from PRD are architecturally supported:

**FR1-FR7: Vault Management**
- ✅ FR1 (Wallet-based authentication): Pattern 1, `walletService.ts`, Lace wallet integration
- ✅ FR2 (Master password encryption): Pattern 2, `encryption.ts` (Argon2id + AES-256-GCM)
- ✅ FR3 (IPFS storage): Pattern 3, `ipfsClient.ts`, Pinata integration
- ✅ FR4 (Midnight metadata sync): `VaultRegistry.compact`, `midnightClient.ts`
- ✅ FR5 (Client-side decryption): `vaultService.ts` + `encryption.ts` (browser-only)
- ✅ FR6 (Credential CRUD): `VaultList.tsx`, `CredentialForm.tsx`, `vaultService.ts`
- ✅ FR7 (Auto-fill integration): Browser extension content scripts (deferred to implementation)

**FR8-FR15: Guardian Recovery**
- ✅ FR8 (Guardian setup): `GuardianConfig.tsx`, `guardianService.ts`
- ✅ FR9 (Shamir Secret Sharing): Pattern 6, `shamirSharing.ts` (2-of-3 threshold)
- ✅ FR10 (Guardian approval): `GuardianRecovery.compact`, guardian portal (`ApprovalPage.tsx`)
- ✅ FR11 (72-hour time-lock): `GuardianRecovery.compact` time-lock logic
- ✅ FR12 (Share claim): `ShareClaim.tsx`, `guardianService.ts`
- ✅ FR13 (Master password recovery): `recoverMasterPassword()` function, Pattern 6
- ✅ FR14 (Backup wallet transfer): `VaultRegistry.transferOwnership()`, backup wallet config
- ✅ FR15 (Recovery key access): Dual-layer encryption, `getRecoveryKey()` witness function

**FR16-FR19: Multi-Device Security**
- ✅ FR16 (Cross-device sync): `syncManager.ts`, `midnightClient.getVaultCID()`
- ✅ FR17 (Conflict detection): `conflictResolver.ts`, CID comparison logic
- ✅ FR18 (Credential-level merge): Pattern 5, `ConflictResolver.tsx` UI
- ✅ FR19 (Ownership encryption): Pattern 2, wallet-based access control

**FR20-FR25: Alias Generation**
- ✅ FR20 (Alias generation): `AliasGenerator.tsx`, `aliasService.ts`
- ✅ FR21 (Alias registry): `AliasRegistry.compact` (alias → owner mapping)
- ✅ FR22 (SMTP bridge): `services/smtp-bridge/`, Express microservice
- ✅ FR23 (Email encryption): `emailEncryptor.ts` (RSA-OAEP)
- ✅ FR24 (IPFS email storage): `ipfsUpload.ts`, encrypted email blobs
- ✅ FR25 (Email retrieval): `EmailViewer.tsx`, `ipfsClient.cat()`

**Non-Functional Requirements Coverage:**

- ✅ **Performance:** Client-side encryption (<2s decryption target), IndexedDB caching, TurboRepo build caching
- ✅ **Security:** Zero-knowledge principles enforced, dual-layer recovery key encryption, guardian approvals on-chain, Argon2id password derivation
- ✅ **Scalability:** Midnight private state is off-chain (no bloat), IPFS distributed storage, multi-device support via contract CID
- ✅ **Compliance:** Zero-knowledge aligns with privacy regulations, IPFS data portable (GDPR right to delete = user controls private keys)
- ✅ **Reliability:** SMTP bridge health checks, guardian portal pin monitoring, multi-backup wallet support

### Implementation Readiness Validation ✅

**Decision Completeness:**

All critical decisions documented with specifics:

- ✅ **Technology Versions:** Midnight SDK (when available, Q4 2025 target), React 18+, TypeScript 5+, WXT latest, pnpm 8+
- ✅ **Implementation Patterns:** 7 comprehensive patterns with code examples (Wallet Auth, Master Password, CID Handling, Error Handling, Conflict Resolution, Guardian Encryption, Test Organization)
- ✅ **Consistency Rules:** Explicit enforcement guidelines for each pattern (e.g., "CID MUST be v1", "RETRYABLE_CODES for network failures")
- ✅ **Architecture Decision Records:** 6 ADRs documented with rationale and alternatives rejected
- ✅ **Contract Specifications:** 3 Compact contracts defined (`VaultRegistry`, `GuardianRecovery`, `AliasRegistry`) with public functions

**Structure Completeness:**

Project structure is specific and implementation-ready:

- ✅ **Complete Directory Tree:** All 6 packages fully defined with file structure down to individual `.ts` files
- ✅ **Integration Points:** Browser extension ↔ Midnight, IPFS, SMTP bridge clearly specified with code examples
- ✅ **Component Boundaries:** React components organized by feature (`vault/`, `recovery/`, `alias/`), services layer separated
- ✅ **Test Structure:** Unit tests co-located, integration tests in `__tests__/integration/`, e2e tests in `__tests__/e2e/`
- ✅ **Configuration Files:** `package.json`, `tsconfig.json`, `wxt.config.ts`, `compact.config.json`, `turbo.json` all defined

**Pattern Completeness:**

All implementation patterns are comprehensive:

- ✅ **Naming Conventions:** Consistent across all patterns (e.g., `vaultService.ts`, `midnightClient.ts`, `CIDv1String` branded type)
- ✅ **Communication Patterns:** `chrome.runtime.sendMessage` for popup ↔ background, React Context for global state, async function calls for service layer
- ✅ **Process Patterns:** Error handling with retry logic, conflict resolution with user review, guardian approval with 72-hour time-lock
- ✅ **Code Examples:** Every pattern includes TypeScript code snippets showing exact usage

### Gap Analysis Results

**✅ No Critical Gaps Found**

All requirements have architectural support. No blocking issues for implementation.

**⚠️ Important Gaps (Recommended for Implementation Phase):**

1. **ESLint Rules for Pattern Enforcement**
   - **Gap:** ADR-003 requires "no business logic in apps/*/src/services/" but no lint rule enforces it
   - **Impact:** Developers might accidentally duplicate logic in extension/mobile
   - **Recommendation:** Add custom ESLint rule during implementation: `no-business-logic-in-app-services`

2. **Contract Deployment Checklist**
   - **Gap:** Deployment scripts defined but no step-by-step checklist for testnet → mainnet promotion
   - **Impact:** Risk of missing steps during production deployment
   - **Recommendation:** Create `cli/docs/DEPLOYMENT.md` with checklist during contract implementation

3. **IPFS Pinning Strategy Documentation**
   - **Gap:** Pinata integration decided but no documented retention policy or backup strategy
   - **Impact:** Risk of pin expiration (free tier) or unclear failover process
   - **Recommendation:** Document in `services/guardian-portal/deploy/RECOVERY.md` (already added for portal, extend for vault pins)

**📝 Nice-to-Have Gaps (Post-MVP):**

1. **Mobile App Scaffold** - Currently just README (ADR-006 MVP simplification). Implement when needed.
2. **Performance Benchmarks** - <2s decryption target defined but no benchmark suite. Add during optimization phase.
3. **ZK Circuit Formal Verification** - Deferred post-audit (accepted trade-off).

### Validation Issues Addressed

**🟢 No Critical Issues Found**

Architecture is coherent and implementation-ready.

**🟡 Minor Recommendations (Addressed via ADRs):**

1. **Originally Proposed:** Full mobile app scaffold in structure
   - **Resolution:** ADR-006 simplified to README only (PM: don't over-engineer MVP)
   - **Status:** ✅ Addressed

2. **Originally Proposed:** 3 SMTP bridge replicas from day 1
   - **Resolution:** ADR-006 simplified to 1 replica + health checks (scale on launch)
   - **Status:** ✅ Addressed

3. **Originally Proposed:** Merge CLI into contracts/
   - **Resolution:** First Principles Analysis reverted this to maintain MeshJS compatibility (ADR-002)
   - **Status:** ✅ Addressed

### Architecture Completeness Checklist

**✅ Requirements Analysis**
- [x] Project context thoroughly analyzed (Step 2)
- [x] Scale and complexity assessed (High complexity, Midnight + IPFS hybrid)
- [x] Technical constraints identified (Midnight SDK Q4 2025, IPFS CIDv1 requirement)
- [x] Cross-cutting concerns mapped (Security, multi-device sync, guardian recovery)

**✅ Architectural Decisions**
- [x] Critical decisions documented with versions (Midnight, IPFS, WXT, Lace wallet, pnpm)
- [x] Technology stack fully specified (React, TypeScript, Compact, Shamir, Argon2id, AES-256-GCM, RSA-OAEP)
- [x] Integration patterns defined (Wallet auth, IPFS storage, Midnight sync, SMTP bridge, guardian portal)
- [x] Performance considerations addressed (<2s decryption, TurboRepo caching, IndexedDB)

**✅ Implementation Patterns**
- [x] Naming conventions established (service pattern, client pattern, branded types)
- [x] Structure patterns defined (monorepo, apps/ vs services/, shared/ package)
- [x] Communication patterns specified (message passing, React Context, service layer)
- [x] Process patterns documented (error handling, conflict resolution, guardian approval flow)

**✅ Project Structure**
- [x] Complete directory structure defined (6 packages, full file tree)
- [x] Component boundaries established (popup ↔ background, services ↔ components, apps → services)
- [x] Integration points mapped (Midnight contracts, IPFS, Lace wallet, SMTP bridge, guardian portal)
- [x] Requirements to structure mapping complete (FR1-FR25 mapped to specific files)

**✅ Advanced Enhancements**
- [x] Architecture Decision Records (6 ADRs documenting rationale)
- [x] Pre-mortem failure prevention (shared logic, health checks, monitoring)
- [x] Cross-functional trade-offs (PM + Engineer + Designer input)
- [x] First Principles validation (MeshJS alignment, multi-platform support)

### Architecture Readiness Assessment

**Overall Status:** ✅ **READY FOR IMPLEMENTATION**

**Confidence Level:** **HIGH**

The architecture is comprehensive, coherent, and validated across all dimensions. Advanced Elicitation applied 4 methods (First Principles, Pre-mortem, Cross-Functional War Room, Architecture Decision Records) to ensure robustness.

**Key Strengths:**

1. **Zero-Knowledge Integrity:** Dual-layer encryption with wallet-independent recovery key achieves both true zero-knowledge (guardians can't reconstruct password) AND catastrophic loss recovery (backup wallet can transfer ownership)

2. **MeshJS Template Compatibility:** Following official Midnight conventions reduces onboarding friction and enables upstream updates

3. **DRY Principle Enforcement:** `shared/logic/` prevents platform drift before mobile app exists. Proactive architecture prevents future pain.

4. **Production-Ready Resilience:** SMTP health checks, guardian portal IPFS monitoring, multi-backup wallet support, and documented recovery procedures prevent common failure modes

5. **Implementation-Ready Detail:** Complete directory tree down to individual files, code examples for all patterns, explicit lint rules, comprehensive test organization

6. **Cross-Functional Validation:** PM, Engineer, and Designer perspectives incorporated via war room session, ensuring business value, technical feasibility, and developer experience

**Areas for Future Enhancement:**

1. **Mobile App Implementation** - Currently README placeholder. Implement when user demand validates investment.

2. **Performance Optimization** - <2s decryption target defined. Add benchmark suite during optimization phase.

3. **Advanced Guardian Patterns** - 6 patterns defined (time-lock, rotation, multi-backup, key rotation, IPFS portal, cross-device). Implement progressively based on user feedback.

4. **Legacy Import Tools** - LastPass/1Password migration deferred to post-MVP (PRD Growth Features).

### Implementation Handoff

**AI Agent Guidelines:**

1. **Strict Pattern Adherence:** Follow all 7 implementation patterns exactly as documented. Use code examples as templates.

2. **ADR-Driven Decisions:** When making implementation choices, refer to the 6 ADRs for rationale. Don't deviate without documenting new ADR.

3. **Shared Logic First:** ALL business logic goes in `shared/logic/` as pure functions. Apps only handle UI and platform-specific APIs (ADR-003 enforcement).

4. **Contract Address Management:** NEVER hardcode contract addresses in app code. Use `shared/config/contracts.ts` exclusively (ADR-004 enforcement).

5. **Testing Requirements:** Co-locate unit tests, separate integration tests. Chaos testing for guardian recovery (35+ scenarios) is mandatory (Pattern 6).

**First Implementation Priority:**

1. **Initialize Monorepo:**
   ```bash
   pnpm init
   # Create pnpm-workspace.yaml
   # Add packages: contracts, cli, apps/browser-extension, services/smtp-bridge, services/guardian-portal, shared
   ```

2. **Bootstrap from MeshJS Template:**
   ```bash
   git clone https://github.com/MeshJS/midnight-starter-template.git temp
   cp -r temp/contracts .
   cp -r temp/cli .
   rm -rf temp
   ```

3. **Setup WXT Extension:**
   ```bash
   cd apps/browser-extension
   pnpm create wxt@latest .
   # Configure for React, TypeScript
   ```

4. **Deploy Contracts to Testnet:**
   ```bash
   cd cli
   pnpm run deploy --network testnet
   # Updates shared/config/contracts.ts with deployed addresses
   ```

5. **Implement Core Vault Flow:**
   - Start with `shared/logic/vaultLogic.ts` (pure functions)
   - Then `apps/browser-extension/src/services/vaultService.ts` (thin wrapper)
   - Finally `apps/browser-extension/src/components/vault/` (UI)

**Implementation Order (Recommended):**
1. Contracts + CLI (Foundation layer)
2. Shared logic (Business logic layer)
3. Browser extension vault (Core user journey)
4. Guardian recovery (Security layer)
5. SMTP bridge + Alias (Identity layer)
6. Guardian portal (Infrastructure layer)
## Architecture Completion Summary

### Workflow Completion

**Architecture Decision Workflow:** COMPLETED ✅  
**Total Steps Completed:** 8  
**Date Completed:** 2026-01-10  
**Document Location:** `_bmad-output/architecture.md`

### Final Architecture Deliverables

**📋 Complete Architecture Document**

- All architectural decisions documented with specific versions
- Implementation patterns ensuring AI agent consistency
- Complete project structure with all files and directories
- Requirements to architecture mapping (FR1-FR25)
- Validation confirming coherence and completeness

**🏗️ Implementation Ready Foundation**

- 4 core architectural decisions made (Hybrid Midnight + IPFS, Guardian Recovery, SMTP Bridge, Project Structure)
- 7 implementation patterns defined (Wallet Auth, Master Password, CID Handling, Error Handling, Conflict Resolution, Guardian Encryption, Test Organization)
- 6 architectural components specified (contracts, CLI, browser extension, mobile, SMTP bridge, guardian portal, shared)
- 25 functional requirements fully supported (FR1-FR25)
- 6 Architecture Decision Records (ADRs) documenting rationale

**📚 AI Agent Implementation Guide**

- Technology stack with verified versions (Midnight SDK Q4 2025, React 18+, TypeScript 5+, WXT, pnpm 8+)
- Consistency rules that prevent implementation conflicts (CIDv1 enforcement, error codes, shared logic)
- Project structure with clear boundaries (apps/ vs services/, shared/ package)
- Integration patterns and communication standards (Lace wallet, IPFS, Midnight contracts)

### Implementation Handoff

**For AI Agents:**
This architecture document is your complete guide for implementing AliasVault 2.0. Follow all decisions, patterns, and structures exactly as documented.

**First Implementation Priority:**

```bash
# 1. Initialize Monorepo
pnpm init
# Create pnpm-workspace.yaml
# Add packages: contracts, cli, apps/browser-extension, services/smtp-bridge, services/guardian-portal, shared

# 2. Bootstrap from MeshJS Template
git clone https://github.com/MeshJS/midnight-starter-template.git temp
cp -r temp/contracts .
cp -r temp/cli .
rm -rf temp

# 3. Setup WXT Extension
cd apps/browser-extension
pnpm create wxt@latest .
# Configure for React, TypeScript

# 4. Deploy Contracts to Testnet
cd ../../cli
pnpm run deploy --network testnet
# Updates shared/config/contracts.ts with deployed addresses
```

**Development Sequence:**

1. Initialize project using documented starter template
2. Set up development environment per architecture
3. Implement contracts + CLI (foundation layer)
4. Build shared business logic (`shared/logic/`)
5. Implement browser extension vault (core user journey)
6. Add guardian recovery (security layer)
7. Build SMTP bridge + alias (identity layer)
8. Deploy guardian portal (infrastructure layer)

### Quality Assurance Checklist

**✅ Architecture Coherence**

- [x] All decisions work together without conflicts
- [x] Technology choices are compatible (Midnight + IPFS + WXT)
- [x] Patterns support the architectural decisions
- [x] Structure aligns with all choices (monorepo + MeshJS)

**✅ Requirements Coverage**

- [x] All functional requirements are supported (FR1-FR25 mapped)
- [x] All non-functional requirements are addressed (security, performance, scalability)
- [x] Cross-cutting concerns are handled (guardian recovery, multi-device sync)
- [x] Integration points are defined (Lace wallet, IPFS, Midnight, SMTP)

**✅ Implementation Readiness**

- [x] Decisions are specific and actionable (versions specified)
- [x] Patterns prevent agent conflicts (7 patterns with code examples)
- [x] Structure is complete and unambiguous (full directory tree)
- [x] Examples are provided for clarity (TypeScript snippets for all patterns)

### Project Success Factors

**🎯 Clear Decision Framework**
Every technology choice was made collaboratively with clear rationale, documented in 6 ADRs ensuring all stakeholders understand the architectural direction.

**🔧 Consistency Guarantee**
Implementation patterns and rules ensure that multiple AI agents will produce compatible, consistent code that works together seamlessly.

**📋 Complete Coverage**
All 25 functional requirements are architecturally supported, with clear mapping from business needs (PRD) to technical implementation (specific files and components).

**🏗️ Solid Foundation**
The MeshJS template and hybrid WXT architecture provide a production-ready foundation following official Midnight conventions and current best practices.

**🛡️ Production Resilience**
Pre-mortem analysis and cross-functional validation incorporated failure prevention mechanisms: health checks, monitoring, recovery documentation, and MVP simplifications.

---

**Architecture Status:** ✅ **READY FOR IMPLEMENTATION**

**Next Phase:** Begin implementation using the architectural decisions and patterns documented herein.

**Document Maintenance:** Update this architecture when major technical decisions are made during implementation. Use ADR format for new decisions.
