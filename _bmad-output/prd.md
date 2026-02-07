---
stepsCompleted: [1, 2, 3, 4, 9, 10]
inputDocuments:
  - c:\Users\ozi3o\Documents\projects\blockchain\aliasvault\_bmad-output\project-planning-artifacts\product-brief-aliasvault-2025-12-26.md
  - c:\Users\ozi3o\Documents\projects\blockchain\aliasvault\PROPOSAL_DECENTRALIZED_VAULT.md
  - c:\Users\ozi3o\Documents\projects\blockchain\aliasvault\docs\gap-analysis.md
  - c:\Users\ozi3o\Documents\projects\blockchain\aliasvault\docs\project-knowledge-index.md
  - c:\Users\ozi3o\Documents\projects\blockchain\aliasvault\docs\data-models-server.md
  - c:\Users\ozi3o\Documents\projects\blockchain\aliasvault\docs\api-contracts-server.md
documentCounts:
  briefs: 1
  research: 2
  brainstorming: 0
  projectDocs: 3
workflowType: 'prd'
lastStep: 11
project_name: 'aliasvault'
user_name: 'Ozi3o'
date: '2025-12-26'
---

# Product Requirements Document - aliasvault

**Author:** Ozi3o
**Date:** 2025-12-26

## Executive Summary

AliasVault represents a paradigm shift in identity security by moving from centralized trust to decentralized verification. It addresses the twin challenges of **Data Sovereignty** (users truly owning their credentials) and **Digital Anonymity** (shielding real identities from Web2 services). 

By leveraging the **Midnight blockchain** for zero-knowledge privacy and integrating a decentralized SMTP bridge, AliasVault offers a "Best of Both Worlds" solution: the privacy of Web3 with the utility of Web2.

### What Makes This Special
*   **Zero-Knowledge Recovery:** A unique "Time-Locked Guardian" mechanism that enables account recovery via smart contracts without ever exposing a master password or creating a backdoor.
*   **Verifiable Sovereignty:** Unlike traditional password managers where "trust" is a policy, AliasVault provides cryptographic proof of ownership via on-chain state on Midnight.
*   **Identity Bridging:** It decouples authentication (Wallet) from communication (Email), allowing users to interact with Web2 services without revealing their true identity.

## Project Classification

**Technical Type:** blockchain_web3
**Domain:** Fintech / Cybersecurity
**Complexity:** High
**Project Context:** Brownfield - extending existing AliasVault architecture.

### Implementation Strategy
The project moves from a centralized server model to a **"Thick Client, Lean Protocol"** architecture, utilizing:
*   **Midnight Blockchain** for identity governance and recovery.
*   **IPFS** for localized, encrypted storage.
*   **Browser-based keys** (Wallet) for authentication.

## Success Criteria

### User Success
*   **Verifiable Sovereignty:** User can independently verify their vault state on the Midnight block explorer, confirming true ownership.
*   **Zero-Fear Failure:** User can successfully simulate a "lost wallet" scenario and recover access via the Guardian mechanism within 5 minutes.
*   **Frictionless Security:** The local decryption experience takes less than **2 seconds**, making high-security feel indistinguishable from standard apps.

### Business Success
*   **Technical Viability:** Successful deployment and verification of the Vault Registry contract on Midnight (Testnet/Mainnet).
*   **Adoption Quality:** **> 50%** conversion rate from "Wallet Connect" to "Mint Vault" (indicating the value prop resonates).
*   **Retention:** Recurring "Vault Update" transactions indicating active daily usage.

### Technical Success
*   **Security Assurance:** Smart contracts and ZK circuits pass external audit with **0 Critical** vulnerabilities.
*   **Storage Reliability:** IPFS pinning strategy achieves **> 99.9%** availability for encrypted blobs.

### Measurable Outcomes
*   **MVP Launch:** Chrome Extension live with < 30s onboarding time.
*   **Recovery Test:** 100% success rate in beta user recovery drills.

## Product Scope

### MVP - Minimum Viable Product
*   **Platform:** Chrome/Brave Extension (Desktop only).
*   **Authentication:** Wallet-only (Lace/Nami). No email signups.
*   **Core Vault:** Client-side AES-256 encryption, IPFS storage, Midnight metadata syncing.
*   **Recovery:** Time-Locked Guardian smart contract.
*   **Identity:** Basic "Alias" generation (SMTP bridge).

### Growth Features (Post-MVP)
*   **Mobile Application:** iOS/Android native apps (React Native).
*   **"Invisible Wallet":** Abstraction layer for non-crypto users ("Privacy Nomad").
*   **Legacy Import:** Tools to migrate from LastPass/1Password.

### Vision (Future)
*   **Enterprise Sovereignty:** Multi-sig shared vaults for teams and families.
*   **Universal Identity:** Using the Vault Identity for "Sign in with Alias" across Web3.

## User Journeys

### Journey 1: Alex Chen - The Invisible Identity

Alex is a DeFi protocol contributor who participates in multiple DAOs and uses various dApp trading platforms. He's tired of giving his real email (`alex.chen@gmail.com`) to centralized exchanges, creating a permanent tracking link between his on-chain activity and real-world identity. Late one night, after another KYC rejection, he discovers AliasVault on Cardano community forums.

The next morning, Alex opens his Chrome browser and installs the AliasVault extension. Instead of the usual "Create Account" form, he simply clicks **"Connect Wallet"** and signs a message with his Lace wallet. Within 10 seconds, AliasVault mints his Vault Identity on the Midnight blockchain—no email, no password, just his signature. 

When he needs to sign up for a new exchange, Alex clicks the extension icon and generates `alex-trade-42@alias.id`. The exchange sends a verification email, which routes through the SMTP bridge and appears encrypted in his vault. Six months later, Alex has 15 different aliases for 15 different services, and he can verify his vault's existence by searching his wallet address on the Midnight explorer—proof that he, not a company, controls his data.

### Journey 2: Sarah Martinez - Reclaiming the Forgotten

Sarah has been using AliasVault for eight months, managing passwords for 30+ services. One stressful Monday, after returning from vacation, she realizes she can't remember her Master Password. She tries five variations—nothing works. In any traditional password manager, she'd be locked out permanently, forced to reset accounts manually or abandon her data.

Instead, Sarah connects her Ledger (her original wallet) to AliasVault and initiates the **Guardian Recovery Protocol**. The contract verifies her wallet signature and begins a **72-hour time-lock countdown**. AliasVault sends a push notification to her tablet: "Recovery initiated. If this wasn't you, cancel immediately."

Sarah waits anxiously. On day three, she receives another notification: "Your recovery key is ready." She claims the key from the smart contract, decrypts her vault, and sets a new Master Password. Within 5 minutes, she's back in—all 30 accounts intact. She feels relieved but also empowered: the blockchain itself was her safety net, not a customer support agent.

### Journey 3: Sarah Martinez - Defending Against the Breach

Two weeks after her password recovery, Sarah's worst fear materializes: her laptop is stolen from a café. Worse, she suspects the thief may have extracted her wallet's private key using malware that was on the device. At 2 AM, she gets an urgent push notification on her tablet (where AliasVault is also installed): **"⚠️ CRITICAL: Recovery request initiated from unknown device. If not you, transfer ownership NOW."**

Sarah's heart races—this wasn't her. The thief is trying to use the Guardian Recovery to steal her vault. She immediately opens AliasVault on her tablet and connects her **backup wallet** (a secondary Ledger she configured during onboarding as her "Social Guardian"). She initiates **`transferOwnership(newWallet)`**, signing the transaction with her Guardian wallet.

The transaction completes in under 30 seconds. Her vault is now owned by her backup wallet, and the attacker's recovery request becomes invalid—they no longer own the asset. Sarah has successfully defended her digital life using the decentralized security model. The next day, she generates a fresh wallet and re-configures her guardians.

### Journey 4: Protocol Ops - Maintaining the Infrastructure

Marcus is part of the core AliasVault infrastructure team responsible for monitoring the health of the IPFS pinning network and the Midnight smart contracts. Each morning, he connects to the **AliasVault Admin Dashboard** (a specialized interface) and reviews:

*   **IPFS Pinning Health:** 99.97% availability across distributed nodes
*   **Guardian Contract Activity:** 3 recovery requests in the past 24 hours (2 completed, 1 cancelled—a good sign of attack prevention)
*   **Vault Registry Stats:** 1,247 new vaults minted this week

When he notices a pinning node in Frankfurt has dropped to 94% uptime, he triggers a re-pinning job to redundant nodes in Singapore and Virginia. He also reviews the on-chain logs for any suspicious pattern of rapid `transferOwnership()` calls that might indicate a coordinated attack. His role isn't customer support (there is none)—it's protocol stewardship, ensuring the decentralized infrastructure remains resilient.

### Journey Requirements Summary

These journeys reveal the following capability areas needed for AliasVault:

**Core Vault Operations:**
*   Wallet-based authentication (no email/password signup)
*   Vault minting and on-chain identity registration
*   Master Password encryption for local data
*   Alias generation and SMTP bridge integration
*   Multi-device synchronization via IPFS

**Security & Recovery:**
*   Guardian Recovery smart contract with time-locks
*   Multi-device push notifications for security events
*   Social recovery / Guardian wallet configuration
*   Ownership transfer mechanism for breach defense
*   Recovery key claim and Master Password reset

**Infrastructure & Monitoring:**
*   IPFS pinning health monitoring
*   Smart contract activity analytics
*   Vault registry statistics
*   Redundant node management
*   Attack pattern detection

## Functional Requirements

### Wallet-Based Authentication
- FR1: Users can connect their Cardano wallet (Lace/Nami) to create a vault identity
- FR2: Users can sign cryptographic challenges with their wallet to unlock their vault
- FR3: System can create an on-chain vault registration on Midnight blockchain upon first connection
- FR4: Users can verify their vault ownership via the Midnight block explorer

### Vault Operations
- FR5: Users can encrypt their credentials locally using a Master Password
- FR6: Users can store encrypted vault data on IPFS
- FR7: Users can update vault metadata on Midnight when vault state changes
- FR8: Users can decrypt and view their stored credentials in under 2 seconds
- FR9: Users can manually add new credentials (service name, username, password, notes)

### Guardian Recovery Protocol
- FR10: Users can configure a Guardian wallet during initial setup
- FR11: Users can initiate a password recovery request via their wallet signature
- FR12: System can enforce a 72-hour time-lock on recovery requests
- FR13: Users can claim an encrypted vault backup key from the Guardian contract after time-lock expires
- FR14: Users can use the claimed backup key to decrypt their vault and set a new Master Password
- FR15: Users can cancel an active recovery request with their wallet signature

### Multi-Device Security & Notifications
- FR16: Users can install AliasVault on multiple devices (work laptop, tablet, etc.)
- FR17: System can send push notifications to all user devices when security events occur (e.g., recovery initiated)
- FR18: Users can transfer vault ownership to a new wallet address
- FR19: System can invalidate previous recovery requests when ownership is transferred

### Alias Generation & Management
- FR20: Users can generate anonymous email aliases (`@alias.id`)
- FR21: Users can customize alias names (e.g., `alex-trade-42@alias.id`)
- FR22: System can route incoming emails from aliases through the SMTP bridge
- FR23: Users can view encrypted incoming emails in their vault
- FR24: Users can manage (create, view, delete) multiple aliases per vault

### Protocol Infrastructure Monitoring (Admin/Ops)
- FR25: Ops team can monitor IPFS pinning health across distributed nodes
- FR26: Ops team can view Guardian contract activity (recovery requests, completions, cancellations)
- FR27: Ops team can track vault registry statistics (mints, updates)
- FR28: Ops team can trigger re-pinning jobs for degraded nodes
- FR29: Ops team can detect suspicious on-chain patterns (e.g., rapid ownership transfers)

## Non-Functional Requirements

### Performance
- **NFR1:** Vault decryption must complete in < **2 seconds** after Master Password entry (FR8 requirement)
- **NFR2:** Onboarding flow (connect wallet → mint vault) must complete in < **30 seconds**
- **NFR3:** Guardian Recovery claim transaction must confirm in < **30 seconds** on Midnight testnet/mainnet

### Security
- **NFR4:** All vault data must be encrypted using **AES-256-GCM** before IPFS upload
- **NFR5:** Master Password derivation must use **Argon2id** (resistant to GPU attacks)
- **NFR6:** Smart contracts (Guardian Recovery, Vault Registry) must pass external audit with **0 Critical** vulnerabilities
- **NFR7:** ZK-proof circuits must be formally verified before mainnet deployment
- **NFR8:** Recovery requests must enforce a minimum **72-hour time-lock** (cannot be bypassed)

### Reliability & Availability
- **NFR9:** IPFS pinning strategy must achieve **> 99.9%** availability for encrypted vault blobs
- **NFR10:** System must support multi-region IPFS pinning (minimum 3 redundant nodes across different geographies)
- **NFR11:** Midnight blockchain connectivity must gracefully handle node failures (fallback to secondary RPC endpoints)

### Data Privacy & Compliance
- **NFR12:** Zero personal data (emails, names, IPs) stored on-chain or in IPFS metadata
- **NFR13:** GDPR "right to be forgotten" supported via IPFS unpin + local key deletion (cryptographic erasure)
- **NFR14:** Multi-device notifications must use end-to-end encrypted channels (no plaintext alerts)

### Browser Extension Compatibility
- **NFR15:** Extension must support **Chrome v100+** and **Brave v1.40+** (no legacy browser support for MVP)
- **NFR16:** Extension package size must be < **5MB** (optimized for fast download/install)
