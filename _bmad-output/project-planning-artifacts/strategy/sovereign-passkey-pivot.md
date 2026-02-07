# Strategy Brief: Sovereign Passkey Pivot

**Date:** 2026-01-10
**Status:** Strategic Opportunity
**Related Research:** [Market Pertinence Analysis](../research/market-AliasVault_Pertinence-research-2025-12-29.md)

## 1. The Core Problem: Platform Lock-in
Big Tech (Apple, Google) is pushing "Passkeys" to replace passwords. While this improves security (phishing resistance), it introduces a new threat: **Ecosystem Capture.**
*   **iCloud Keychain:** Keys are locked to Apple devices.
*   **Google Password Manager:** Keys are locked to the Google ecosystem.
*   **The Consequence:** Users lose the freedom to switch platforms easily, as their digital identity is held hostage by the hardware vendor.

## 2. The Opportunity: "The Universal Keyring"
AliasVault can pivot from being just a "Password Manager" to a **"Sovereign Passkey Store."**
*   **Value Prop:** "Create your identity once, take it anywhere."
*   **Promise:** A Passkey created on an iPhone can be instantly used on a Windows PC or Linux laptop.
*   **Market Position:** The anti-lock-in alternative. We provide the *portability* of a software manager with the *sovereignty* of Web3.

## 3. Technical Implementation: "Software Authenticator"
We follow the architectural model proved by 1Password and Bitwarden, but with a decentralized backend.

### Architecture Comparison
| Component | Hardware Keys (Apple/Google) | Traditional Apps (1Password) | AliasVault (Sovereign) |
| :--- | :--- | :--- | :--- |
| **Key Generator** | Hardware (Secure Enclave) | Software (App Logic) | Software (App Logic) |
| **Storage** | Device Hardware | Centralized Cloud (AWS) | **IPFS (Encrypted Blob)** |
| **Encryption** | Device PIN/Bio | Master Password | **Midnight Wallet Key** |
| **Sync** | Vendor Ecosystem Only | Proprietary Sync | **Decentralized Network** |
| **Privacy Model** | Transparent (Vendor knows you) | Transparent (Vendor knows you) | **Stealth (Midnight ZK)** |

### Critical Technical Components
1.  **"Virtual Authenticator" (The Abstraction Layer):**
    *   *Concept:* A clean, FIDO2-compliant software module that mimics a hardware key.
    *   *Decoupling:* This module has NO idea it is running on a blockchain. It simply implements the `Authenticator` interface (Create Credential, Get Assertion).
    *   *Backend Injection:* The storage backend (Midnight/IPFS) is injected as a dependency, ensuring a "Refactored Class" architecture rather than monolithic "Main method" logic.

2.  **Stealth Vault Architecture (The "Better Ensemble"):**
    *   *Problem:* Naive IPFS storage reveals "Address A owns file B".
    *   *Solution:* **Midnight ZK Shield.** The IPFS hash is stored in Midnight's *Private State*.
    *   *Benefit:* An observer sees you interacting with the chain, but has zero knowledge of *what* vault you are accessing or *where* it is located.

3.  **OS/Browser Integration:**
    *   **Browser Extension:** Injects into the login flow to intercept `navigator.credentials.get()`.
    *   **OS APIs:** Integration with `AuthenticationServices` (iOS) and Credential Manager (Android).

### Deployment Targets (Where code lives)
*   **Desktop (Chrome/Firefox):** The Virtual Authenticator lives inside the **Extension Background Script (Service Worker)**. It runs locally on the user's machine, holding the keys in memory only during use.
*   **Mobile (iOS):** It lives in a specific **App Extension target** (`AuthenticationServices` framework) bundled with the main app.
*   **Mobile (Android):** It runs as a **System Service** implementing the `CredentialProviderService` API.

## 4. Risk & Trade-off Assessment: "The Safe vs. The Copy"

### The Trade-off
To achieve **Portability** (freedom from Apple/Google), we must accept that keys are **Copyable** (Software-based).

*   **Hardware Keys (The Safe):**
    *   *Security:* Maximum. Keys never leave the physical device.
    *   *Limitation:* Zero portability. You cannot move the key to another device easily.
*   **Software Keys (The Briefcase - AliasVault):**
    *   *Security:* High (Protected by Encryption). Keys are essentially "files" stored securely.
    *   *Benefit:* Maximum portability. Keys travel with you across any device.

### Conclusion
For the target market (Web3 Purists, Privacy Nomads), the risk of **Platform Lock-in** is often perceived as greater than the theoretical risk of a software-key compromise (assuming strong encryption). The "Briefcase" model is the industry standard for commercial password managers and is accepted by the market.

### Critical Integration Review: "Seamless vs. Exogenous"
**Risk:** If we treat Passkeys as a separate system (e.g., a "Wallet" sidecar) alongside the Password Vault, we create a disjointed "Exogenous" architecture. This leads to UX friction (two vaults) and logic duplication.

**Solution: The Unified Vault Model**
To ensure seamless integration, Passkeys must be treated strictly as **just another Credential Type** within the existing `VaultBlob`.

*   **Current Model:** `VaultItem = { Username, Password, Email_Alias }`
*   **Unified Model:** `VaultItem = { Username, Authentication_Data (Polymorphic), Email_Alias }`
    *   *Type A (Legacy):* `Authentication_Data = { Type: "Password", Value: "hunter2" }`
    *   *Type B (Modern):* `Authentication_Data = { Type: "Passkey", KeyPair: [Private_Blob] }`

**Result:**
The `VirtualAuthenticator` does **NOT** have its own storage. It reads from the **SAME** `VaultBlob` as the traditional Password Manager.
1.  **User unlocks Vault** (One Master Key).
2.  **App runs:**
    *   If site requires Password -> Fills Password.
    *   If site requires Passkey -> Feeds `Private_Blob` to `VirtualAuthenticator` -> Signs Challenge.

This guarantees a **single source of truth** (The Midnight/IPFS Vault) for both legacy and future identities, preventing architectural fragmentation.

### Conclusion
**The Bridge Strategy:**
We are currently building a **Traditional Password Manager** (Project Scope MVP), focused on:
1.  **Credentials:** Usernames/Passwords.
2.  **Privacy:** Email Aliases (SMTP Bridge).
3.  **Storage:** Decentralized Vault (IPFS/Midnight).

The **Sovereign Passkey Store** is the **Next Logical Step (Phase 2).** It is an additive pivot. We verify the "Legacy" world (Passwords) first, then layer the "Future" world (Passkeys) on top. This document prepares the architecture for that future integration.

*   **Immediate Action:** Prioritize research into `AuthenticationServices` (iOS) and Android Credential Manager integration.
*   **Architecture Action:** Design the `VirtualAuthenticator` interface to be strictly FIDO2 compliant, decoupled from the Midnight storage layer.
*   **Marketing Angle:** "Don't let Apple own your Identity. Own your keys with AliasVault."

## 6. Architecture Flowchart: "Refactored Class" Design

This diagram illustrates the decoupling between the FIDO2 logic and the Midnight backend.

```text
+---------------------+     +--------------------------+     +-------------------+
|     Browser/OS      |     |  Virtual Authenticator   |     |  Midnight Adapter |
| (Client Application)|     | (Standard FIDO2 Logic)   |     | (Storage Backend) |
+----------+----------+     +------------+-------------+     +---------+---------+
           |                             |                             |
           | 1. Create Credential        |                             |
           +---------------------------->|                             |
           |                             | 2. Generate Key Pair        |
           |                             +------------+                |
           |                             |            |                |
           |                             |<-----------+                |
           |                             |                             |
           |                             | 3. Storage.save(Blob)       |
           |                             +---------------------------->|
           |                             |                             | 4. Encrypt (Wallet Key)
           |                             |                             +-----------+
           |                             |                             |           |
           |                             |                             |<----------+
CODE BOUNDARY ==============================================================================
           |                             |                             | 5. Upload to IPFS
           |                             |                             +--------------------> [IPFS]
           |                             |                             |                       |
           |                             |                             |<----------------------+
           |                             |                             | Returns CID
           |                             |                             |
           |                             |                             | 6. ZK Proof (Store CID)
           |                             |                             +--------------------> [Midnight]
           |                             |                             |                       |
           |                             |                             |<----------------------+
           |                             |                             | State Updated
           |                             |                             |
           |                             | 7. Success (Void)           |
           |                             |<----------------------------+
           |                             |                             |
           | 8. Public Key Attestation   |                             |
           |<----------------------------+                             |
           |                             |                             |
```
