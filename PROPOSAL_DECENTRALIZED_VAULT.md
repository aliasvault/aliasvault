# Decentralized Password & Alias Manager
## Built on Midnight Blockchain with Rational Privacy

**Draft Version**: 1.1  
**Date**: December 25, 2025  
**Status**: ✅ Analyst Review Complete  

---

## Executive Summary

This proposal outlines a decentralized password and email alias manager leveraging **Midnight blockchain** (Cardano's privacy-focused partner chain) for access control, **IPFS/Filecoin** for encrypted data storage, and **Web3 email protocols** for decentralized messaging. The system aims to eliminate single points of failure while maintaining the usability of traditional password managers.

---

## 1. Problem Statement

### Current Centralized Solutions
| Issue | Impact |
|-------|--------|
| **Single point of failure** | LastPass, 1Password breaches expose all users |
| **Company dependency** | Service shutdown = lost access |
| **Trust requirement** | Users must trust provider won't access data |
| **Censorship vulnerability** | Accounts can be locked/banned |
| **Email alias dependency** | Relies on centralized SMTP infrastructure |

### Existing Decentralized Attempts
| Project | Limitation |
|---------|-----------|
| Dassword, De Keeper | No email alias support, prototype-stage |
| Web3 email (Mailchain, EtherMail) | Not integrated with password management |
| Hardware wallets | No password vault functionality |

---

## 2. Proposed Solution

### Core Concept
A password and identity manager where:
- **User identity** = blockchain wallet (no email/password accounts)
- **Vault storage** = encrypted on IPFS, pointer on Midnight
- **Access control** = ZK proofs for privacy + social recovery
- **Email aliases** = Web3 native + optional SMTP bridge

### Value Proposition
| Feature | User Benefit |
|---------|-------------|
| No central server | Cannot be hacked, breached, or shut down |
| Wallet-based auth | No passwords to remember for login |
| ZK-proof sharing | Share single credentials privately |
| Social recovery | Recover access without "forgot password" flows |
| Self-sovereignty | User owns and controls all data |

---

## 3. Technical Architecture

### 3.1 System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Browser   │  │   Mobile    │  │   Desktop (optional)    │  │
│  │  Extension  │  │    App      │  │                         │  │
│  └──────┬──────┘  └──────┬──────┘  └────────────┬────────────┘  │
│         │                │                      │                │
│         └────────────────┼──────────────────────┘                │
│                          │                                       │
│  ┌───────────────────────▼───────────────────────────────────┐  │
│  │              LOCAL ENCRYPTION ENGINE                       │  │
│  │  • Argon2id key derivation from master password           │  │
│  │  • AES-256-GCM vault encryption                           │  │
│  │  • RSA-OAEP for email encryption                          │  │
│  │  • Identity/password/alias generation                     │  │
│  └───────────────────────┬───────────────────────────────────┘  │
└──────────────────────────┼───────────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
┌──────────────────┐ ┌──────────────┐ ┌──────────────────────────┐
│ MIDNIGHT CHAIN   │ │ IPFS/FILECOIN│ │ EMAIL LAYER              │
│                  │ │              │ │                          │
│ • Vault registry │ │ • Encrypted  │ │ Option A: Mailchain      │
│ • Access control │ │   vault blob │ │   (Web3 native)          │
│ • Guardian list  │ │ • CID-based  │ │                          │
│ • ZK proofs      │ │   addressing │ │ Option B: SMTP Bridge    │
│ • Public keys    │ │              │ │   (Gmail compatibility)  │
└──────────────────┘ └──────────────┘ └──────────────────────────┘
```

### 3.2 Data Flow

#### Saving a Credential
1. User adds password in client app
2. Client encrypts entire vault with master password (AES-256-GCM)
3. Encrypted blob uploaded to IPFS → returns CID (content hash)
4. Client signs transaction to update vault CID on Midnight
5. Midnight stores: `{ walletAddress, vaultCID, publicKey, lastUpdated }`

#### Retrieving Credentials
1. User connects wallet to client app
2. Client queries Midnight for vault CID
3. Client fetches encrypted blob from IPFS using CID
4. User enters master password → client decrypts locally
5. User accesses passwords/aliases

#### Social Recovery
1. User loses wallet, creates new wallet
2. Contacts designated guardians (e.g., 3 of 5)
3. Each guardian signs approval transaction on Midnight
4. After threshold reached + time-lock, ownership transfers
5. User accesses vault with new wallet (still needs master password)

### 3.3 Smart Contract Design (Conceptual)

```
Contract: VaultRegistry

State:
  - vaults: Map<WalletAddress, VaultRecord>
  
VaultRecord:
  - owner: WalletAddress
  - vaultCID: String (IPFS content identifier)
  - publicKey: Bytes (for email encryption)
  - guardians: WalletAddress[] (for social recovery)
  - recoveryThreshold: Number (e.g., 3 of 5)
  - pendingRecovery: RecoveryRequest | null
  - lastUpdated: Timestamp

Functions:
  - updateVault(newCID, signature) → requires owner signature
  - getVaultCID(address) → returns CID (public for owner access)
  - initiateRecovery(newOwner) → guardian-only
  - approveRecovery(newOwner) → guardian-only, accumulates approvals
  - cancelRecovery() → owner-only, within time-lock period
  - updateGuardians(newList) → owner-only

ZK Capabilities (Midnight-specific):
  - proveOwnership() → ZK proof of vault ownership without revealing wallet
  - proveCredentialExists(hash) → prove you have a credential without revealing it
  - grantAccessProof(recipientPK, credentialProof) → selective sharing
```

---

## 4. Technology Choices

### 4.1 Blockchain Layer: Midnight

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| **Chain** | Midnight (Cardano partner chain) | Native ZK-SNARKs, rational privacy, regulatory compliance |
| **Language** | Compact (TypeScript-like) | Developer-friendly, ZK-enabled |
| **Consensus** | Inherited from Cardano SPOs | Proven security, decentralization |

**Why Midnight over alternatives?**
- **vs Ethereum**: Native ZK support, lower fees, no need for L2
- **vs Secret Network**: Better tooling, Cardano ecosystem integration
- **vs Zcash**: Programmable smart contracts, not just payments
- **vs Aztec**: More mature, already launching

**Open Questions for Analyst**:
1. Is Midnight mature enough for production use in 2025?
2. What are the gas costs for vault updates on Midnight?
3. How does Midnight handle contract upgradability?

### 4.2 Storage Layer: IPFS + Filecoin

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| **Hot storage** | IPFS (pinning service) | Fast retrieval, content-addressed |
| **Cold storage** | Filecoin | Long-term persistence with incentives |
| **Pinning** | Pinata, Web3.Storage, or self-hosted | Reliability + redundancy |

**Why IPFS/Filecoin?**
- Content-addressed: CID = hash of content, tamper-proof
- Decentralized: No single point of failure
- Encrypted client-side: Storage nodes can't read data
- Incentivized: Filecoin pays for reliable storage

**Open Questions for Analyst**:
1. What's the latency for IPFS retrieval in practice?
2. Should we use Arweave instead for permanent storage?
3. How to handle IPFS garbage collection for infrequently accessed vaults?

### 4.3 Email Layer: Tiered Approach

> **Note:** Fully decentralized SMTP is an unsolved problem. Web2 services (YouTube, Gmail) require traditional email addresses. We prioritize user choice and portability.

#### Tier Overview

| Tier | Solution | Decentralization | User Effort | Use Case |
|------|----------|------------------|-------------|----------|
| **Free** | `@vault.email` alias | ❌ Centralized | 🟢 None | Quick signup, disposable aliases |
| **Pro** | Bring Your Domain + Mox cluster | 🟡 Partial | 🟡 DNS setup | Privacy-conscious users |
| **Self-Sovereign** | Self-hosted Mox | ✅ Full | 🔴 Technical | Maximum control |

#### Tier Details

**Free Tier (Default)**
- Users get `username@vault.email` aliases
- We host the infrastructure (centralized, but functional)
- Works immediately for Web2 signups (YouTube, etc.)

**Pro Tier (Recommended for Privacy)**
- User registers their own domain (~$10/year via Cloudflare/Namecheap)
- Points MX records to our Mox cluster
- User owns the domain — portable if they leave
- Alternative: Cloudflare Email Workers for serverless approach

**Self-Sovereign Tier (Technical Users)**
- Full documentation for deploying personal [Mox](https://github.com/mjl-/mox) server
- User controls domain, server, and data
- Can integrate with vault via API

#### Web3 Native Email

| Protocol | Status | Integration |
|----------|--------|-------------|
| **Mailchain** | ✅ Production | Wallet-to-wallet encrypted messaging |
| **Dmail** | ⚠️ Gmail bridge only | Alternative for MVP |

**Why Mailchain for Web3?**
- Open protocol, SDK available
- Multi-chain support (Cardano, EVM)
- End-to-end encryption by default
- <$0.005/message for high volume

### 4.4 Wallet Integration

> **MVP Strategy:** Lace wallet only to reduce complexity. Expand post-launch.

| Wallet | Priority | Status | Notes |
|--------|----------|--------|-------|
| **Lace** | P0 - MVP | ✅ Primary | Designed for Midnight; "Nami Mode" available |
| Eternl | P1 - Post-MVP | Planned | Popular Cardano wallet |
| WalletConnect | P2 - Future | Planned | Multi-chain support |

**Why Lace First?**
- Official IOG wallet designed for Midnight
- Integrated Midnight testnet support
- Chrome extension available
- Mobile version (Lace V2) coming 2025
- Mesh SDK provides integration helpers

---

## 5. Security Model

### 5.1 Two-Layer Authentication

> **Defense-in-depth:** Both wallet AND master password required. Neither alone grants access.

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1: Wallet Signature (Access Control)                    │
│  ──────────────────────────────────────────────────────────     │
│  1. User connects Lace wallet to app                           │
│  2. Signs challenge message to prove identity                  │
│  3. App queries Midnight for vault CID                         │
│  4. Fetches encrypted blob from IPFS                           │
│  Result: Attacker with password alone → cannot get blob        │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 2: Master Password (Decryption)                         │
│  ──────────────────────────────────────────────────────────     │
│  1. User enters master password                                │
│  2. Argon2id derives encryption key (19 MiB, 2 iter, 1 para)   │
│  3. AES-256-GCM decrypts vault blob locally                    │
│  4. Credentials available in app memory                        │
│  Result: Attacker with wallet alone → sees only ciphertext     │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Why Both Layers?

| Attack Scenario | Protection |
|-----------------|------------|
| **Wallet stolen** | Attacker can get encrypted blob, but cannot decrypt without master password |
| **Password phished** | Attacker cannot retrieve vault without wallet signature |
| **Server breach** | Nothing to breach — data is on IPFS, keys are client-side |
| **Both compromised** | Game over (same as any password manager with 2FA) |

### 5.3 Argon2id Parameters (OWASP-Aligned)

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Memory | 19 MiB | Resists GPU/ASIC attacks |
| Iterations | 2 | Balances security and UX |
| Parallelism | 1 | Single-threaded for consistency |
| Salt | 16 bytes random | Unique per vault |

### 5.4 Threat Analysis

| Threat | Mitigation |
|--------|-----------|
| **IPFS node compromise** | Data is encrypted; nodes see only ciphertext |
| **Midnight compromise** | Only stores CID pointers, not actual data |
| **Wallet theft** | Guardians can transfer ownership; attacker still needs master password |
| **Guardian collusion** | They can transfer access but cannot decrypt vault |
| **Master password phishing** | Same risk as any password manager; use hardware wallet signing |
| **Quantum computing** | Upgradeable encryption; plan hybrid PQC by 2030 |

### 5.5 Recovery Scenarios

| Scenario | Recovery Path |
|----------|--------------|
| Lost wallet | Social recovery (3 of 5 guardians) |
| Lost master password | ❌ Unrecoverable (by design, same as Bitwarden) |
| Lost both | ❌ Unrecoverable |
| Guardian unavailable | Replace guardians before losing more |
| All guardians unavailable | Pre-signed recovery card in safe deposit box |

---

## 6. Competitive Analysis

| Feature | AliasVault (current) | This Proposal | Bitwarden | 1Password |
|---------|---------------------|---------------|-----------|-----------|
| Open source | ✅ | ✅ | ✅ | ❌ |
| Self-hostable | ✅ | ✅ (IPFS node) | ✅ | ❌ |
| Decentralized storage | ❌ | ✅ | ❌ | ❌ |
| No central server | ❌ | ✅ | ❌ | ❌ |
| ZK credential sharing | ❌ | ✅ | ❌ | ❌ |
| Email aliases | ✅ | ✅ (hybrid) | ❌ | ❌ |
| Social recovery | ❌ | ✅ | ❌ | ❌ |
| Wallet auth | ❌ | ✅ | ❌ | ❌ |
| Works offline | ✅ | ⚠️ (cached) | ✅ | ✅ |

---

### 3.4. Time-Locked Zero-Knowledge Recovery ("Midnight Guardian")
> **New Feature:** Solves the "Lost Master Password" problem without creating a backdoor.

*   **Concept:** Use Midnight's **Private State** to store a backup of the user's Master Encryption Key, protected for recovery in case of emergency.
*   **Mechanism:**
    1.  **Backup:** On setup, Client encrypts Master Key (with a separate Recovery Key) and stores it in Midnight Private Smart Contract.
    2.  **Trigger:** User signs a `RequestRecovery()` transaction using their **Lace Wallet**.
    3.  **Time-Lock (Purgatory):** The Smart Contract enforces a mandatory **72-hour delay** before releasing the key.
    4.  **Monitoring & Defense:**
        *   The AliasVault Server monitors the Midnight blockchain for `RecoveryInitiated` events.
        *   **Alert:** Server broadcasts a "Critical Security Alert" push notification to **all active sessions** (Mobile, Extension).
        *   **Veto:** Any active session can sign a `CancelRecovery()` transaction to instantly block the attempt.
*   **Security Guarantee:** A remote hacker (who steals the Wallet Seed) cannot succeed unless they *also* have physical access to the user's unlocked devices to suppress the alerts.s

---

## 7. Development Phases

### Phase 1: Core Vault (MVP)
- [ ] Wallet authentication (Cardano)
- [ ] Vault encryption/decryption (AES-256-GCM)
- [ ] IPFS storage integration
- [ ] Midnight smart contract for vault registry
- [ ] Basic browser extension

### Phase 2: Credential Management
- [ ] Password generator
- [ ] Identity/alias generator
- [ ] Autofill functionality
- [ ] Import from existing password managers

### Phase 3: Social Recovery
- [ ] Guardian designation
- [ ] Recovery initiation flow
- [ ] Time-lock mechanism
- [ ] Guardian management UI

### Phase 4: Email Integration
- [ ] Mailchain integration (Web3 native)
- [ ] SMTP bridge (optional/modular)
- [ ] Encrypted email storage and display

### Phase 5: Advanced Features
- [ ] ZK credential sharing
- [ ] Mobile apps (iOS, Android)
- [ ] Hardware wallet integration
- [ ] Multi-vault support (personal, work)

---

## 8. Analyst Review Summary

> The following questions from the original draft have been researched and answered.

### Technical Feasibility ✅ VALIDATED

| Question | Finding |
|----------|---------|
| Is Midnight mature enough? | ✅ Mainnet Q4 2025; NIGHT token launched Dec 2025 |
| Gas costs on Midnight? | ✅ DUST auto-generated from NIGHT; predictable fees |
| IPFS reliability? | ⚠️ 750ms-4s latency; requires pinning + local cache |
| Arweave alternative? | 🟡 Option for permanent storage (~$3,500/TB one-time) |

### Architecture Decisions ✅ VALIDATED

| Question | Finding |
|----------|---------|
| Two-layer security (wallet + password)? | ✅ Defense-in-depth; OWASP-aligned |
| Guardian metadata visibility? | 🔲 Remaining open question |
| Vault versioning? | 🔲 Remaining open question |
| Mailchain vs alternatives? | ✅ Mailchain recommended; tiered approach for SMTP |

### Market & Adoption 🔲 REMAINING

| Question | Status |
|----------|--------|
| Crypto UX barrier? | Mitigated by Lace wallet + "Nami Mode" |
| Onboarding non-crypto users? | 🔲 UX design phase decision |
| Total addressable market? | 🔲 Market research needed |

### Regulatory & Compliance ✅ VALIDATED

| Question | Finding |
|----------|---------|
| GDPR + IPFS? | ✅ Key deletion = functional erasure |
| Midnight "rational privacy"? | ✅ Selective disclosure aligns with GDPR |
| ZK export controls? | 🟢 Standard crypto; no special restrictions |

---

## 9. References

### Midnight Blockchain
- [Midnight Official](https://midnight.network)
- [Midnight Documentation](https://docs.midnight.network)
- [Compact Language Spec](https://midnight.network/compact)

### IPFS/Filecoin
- [IPFS Documentation](https://docs.ipfs.tech)
- [Filecoin Spec](https://spec.filecoin.io)
- [Web3.Storage](https://web3.storage)

### Web3 Email
- [Mailchain Protocol](https://mailchain.com)
- [EtherMail](https://ethermail.io)

### Cryptography
- [Argon2 Specification](https://github.com/P-H-C/phc-winner-argon2)
- [AES-GCM (NIST)](https://csrc.nist.gov/publications/detail/sp/800-38d/final)
- [Social Recovery Wallets (Vitalik)](https://vitalik.ca/general/2021/01/11/recovery.html)

### Existing Implementations (Inspiration)
- [AliasVault Source Code](https://github.com/aliasvault/aliasvault)
- [Argent Wallet Recovery](https://www.argent.xyz/security/)
- [Safe Multisig](https://safe.global)

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2024-12-25 | [Your Name] | Initial draft for analyst review |
| 1.1 | 2025-12-25 | Analyst | Research validation complete; tiered email, Lace-only wallet, security model updates |

---

**Next Steps**: 
1. ~~Analyst review for feasibility and technology adequacy~~ ✅ Complete
2. ~~Incorporate feedback into v1.1~~ ✅ Complete
3. Create detailed technical specification (Product Brief)
4. Build proof-of-concept for core vault functionality (Phase 1 MVP)
