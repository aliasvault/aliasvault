1---
stepsCompleted: [1, 2, 3, 4, 5]
inputDocuments:
  - c:\Users\ozi3o\Documents\projects\blockchain\aliasvault\PROPOSAL_DECENTRALIZED_VAULT.md
  - c:\Users\ozi3o\Documents\projects\blockchain\aliasvault\docs\gap-analysis.md
  - c:\Users\ozi3o\Documents\projects\blockchain\aliasvault\docs\data-models-server.md
  - c:\Users\ozi3o\Documents\projects\blockchain\aliasvault\docs\api-contracts-server.md
  - c:\Users\ozi3o\Documents\projects\blockchain\aliasvault\docs\source-tree-analysis.md
workflowType: 'product-brief'
lastStep: 1
project_name: 'aliasvault'
user_name: 'Ozi3o'
date: '2025-12-26'
author: 'Ozi3o'
---

# Product Brief: aliasvault


## Executive Summary

AliasVault represents a paradigm shift in identity security by moving from centralized trust to decentralized verification. It addresses the twin challenges of **Data Sovereignty** (users truly owning their credentials) and **Digital Anonymity** (shielding real identities from Web2 services). By leveraging the Midnight blockchain for zero-knowledge privacy and integrating a decentralized SMTP bridge, AliasVault offers a "Best of Both Worlds" solution: the privacy of Web3 with the utility of Web2.

---
c
## Core Vision

### Problem Statement
Current password managers centralized risk: users must trust a provider's server with their digital lives. Furthermore, standard Web2 authentication forces users to expose their personal email addresses, creating permanent tracking links between services.

### Proposed Solution
A **Decentralized Zero-Knowledge Vault** where:
1.  **Storage:** Encrypted data lives on IPFS/Filecoin, controlled 100% by user keys (no central database).
2.  **Anonymity:** A built-in "Email Alias" engine (Mox/SMTP bridge) lets users generate unique, anonymous emails for every login, decoupling their identity from their activity.
3.  **Adoption Path:** Designed for crypto-natives first, but architected to abstract Web3 complexity (invisible wallets) for future mass adoption.

### Key Differentiators
*   **Hyperscale Privacy:** Unlike standard managers, the server acts only as a blind relay/indexer. It cannot see or access data.
*   **Midnight Powered:** Utilizes Midnight blockchain's private state for "Zero-Knowledge Recovery" (Time-Locked Guardian), solving the "Lost Master Password" problem without backdoors.
*   **Seamless Integration:** Native SMTP bridge allows anonymous interactions with standard Web2 services.


## Target Users

### Primary Users (MVP Focus)

#### 1. The Web3 Purist ("The Sovereign")
*   **Profile:** Deeply embedded in the crypto ecosystem. Values self-custody above all. Likely uses a hardware wallet (Trezor/Ledger) and manages multiple seed phrases.
*   **Motivation:** "Not your keys, not your coins." Distrusts centralized password managers due to history of breaches.
*   **Goals:**
    *   Eliminate dependence on centralized servers.
    *   Prove ownership of data via blockchain.
    *   Use Web2 services efficiently without compromising sovereignty.

### Secondary Users (Post-MVP)

#### 2. The Privacy Nomad
*   **Profile:** Tech-savvy privacy advocate seeking better anonymity tools.
*   **Strategy:** Will be targeted in V2 once the "Web3 Bridge" UX is perfected.

### User Journey (The "Sovereign" Experience)
1.  **Discovery:** User finds AliasVault on a dApp store or crypto twitter.
2.  **Onboarding:** "Connect Wallet" (Lace/Nami). User signs a transaction to mint their "Vault Identity". **No email required.**
3.  **Core Usage:**
    *   **Login:** User signs a challenge to decrypt their vault locally.
    *   **Action:** Generates an `@alias.id` email for a service.
    *   **Sync:** Encrypted blob is pinned to IPFS; CID is updated on Midnight chain.
4.  **Success Moment:** User inspects the Midnight explorer and sees their Vault Update transaction—verifiable proof that *they* control the state, not a server.


## Success Metrics

### User Success (The "Sovereignty" Score)
*   **Verifiable Ownership:** Users can verify their vault state on the Midnight block explorer (proof of ownership).
*   **Zero-Knowledge Recovery:** Successful execution of the "Guardian" recovery flow without data loss.
*   **Performance:** Local vault decryption/unlock time remains under **2 seconds** (comparable to Web2 native apps).

### Business Objectives (MVP)
*   **Technical Viability:** Successful deployment of the Vault Registry verification contract on Midnight Testnet/Mainnet.
*   **Adoption Signals:** Growth in "Vault Mint" transactions (Proxy for User Acquisition).
*   **Retention Signals:** Recurring "Vault Update" transactions (Proxy for Active Usage).

### Key Performance Indicators (KPIs)
*   **# of Vaults Minted:** Total distinct on-chain identities created.
*   **# of Vault Updates:** Frequency of state updates (representing password saves/edits).
*   **Decryption Latency:** Time (ms) from "Connect Wallet" to "Vault Unlocked".


## MVP Scope

### Core Features (The "Sovereign" Extension)
1.  **Wallet Authentication:** Native integration with Lace/Nami wallets. No email/password registration.
2.  **Zero-Knowledge Vault:**
    *   Client-side encryption (AES-256-GCM + Argon2id).
    *   Decentralized Storage (IPFS) for encrypted blobs.
    *   Midnight Metadata Registry for state tracking.
3.  **Guardian Recovery:** The "Time-Locked" recovery smart contract to mitigate lost wallet risks.
4.  **Alias Engine:** Mox/SMTP bridge integration to generate and manage `@alias.id` identities.
5.  **Platform:** **Chrome/Brave Extension** only.

### Out of Scope for MVP
*   **Mobile Application:** iOS/Android apps deferred to V2.
*   **Fiat On-ramps:** User must bring their own token (tDust/Dust) for gas.
*   **Legacy Imports:** No automatic import from LastPass/1Password (Manual entry only initially).
*   **Shared Vaults:** No team/family features.

### MVP Success Criteria
*   **Functional:** Guardian Recovery works on Testnet with < 30s confirmation.
*   **Performance:** Extension unlocks in < 2s.
*   **Reliability:** IPFS blob retrieval success rate > 99%.

### Future Vision
*   **V2:** Mobile App with "Invisible Wallet" abstraction for the "Privacy Nomad".
*   **V3:** Enterprise Team Vaults with Multi-sig governance.

<!-- Content will be appended sequentially through collaborative workflow steps -->
