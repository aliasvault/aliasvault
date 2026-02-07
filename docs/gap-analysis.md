# Gap Analysis Matrix: Decentralized Migration

This document maps the **Current State** (Monorepo) to the **Future State** (Decentralized Architecture).

**Legend:**
*   🟢 **KEEP:** Component retained with minimal changes.
*   🟡 **MODIFY:** Component logic retained but needs adaptation (e.g., swapping API calls for Chain calls).
*   🔴 **DELETE:** Component replaced entirely by decentralized infrastructure.
*   🔵 **NEW:** New component required.

---

## 1. Server Components (`apps/server`)

The biggest impact is here. The monolithic server is effectively decomposed into Blockchain (State) + IPFS (Storage).

| Component | Status | Action / Future State |
|-----------|--------|-----------------------|
| **`AliasVault.Api`** | 🔴 DELETE | Replaced by **Midnight Smart Contract** (Registry) + **IPFS**. |
| `AuthController.cs` | 🔴 DELETE | Replaced by **Wallet Authentication** (Lace) on Client. |
| `VaultController.cs` | 🔴 DELETE | Replaced by **IPFS Upload** (Client) + **Contract Update**. |
| **`AliasServerDb`** | 🔴 DELETE | **PostgreSQL** replaced by **Midnight Ledger** (Metadata) + **IPFS** (Blobs). |
| `AliasVaultUser` | 🔴 DELETE | Identity is now the **Wallet Address**. |
| `Vault` (Entity) | 🔴 DELETE | Stored on IPFS. Pointer (CID) stored in Contract. |
| `UserEmailClaim` | 🔴 DELETE | Replaced by **Global Alias Registry** (Smart Contract). |
| **`AliasVault.SmtpService`** | 🟡 MODIFY | **Mox Integration:** Needs to verify blockchain ownership before accepting mail. |
| **`AliasVault.Client`** | 🔴 DELETE | The "Web Vault" becomes a pure static SPA (served via IPFS/ENS or standard host). |

---

## 2. Client Components (`apps/browser-extension` & `mobile-app`)

The clients become "Thick Clients" that talk directly to the blockchain/IPFS instead of a REST API.

| Component | Status | Action / Future State |
|-----------|--------|-----------------------|
| **Encryption Engine** | 🟢 KEEP | **Argon2id + AES-256-GCM** logic is reused 100%. Master Password concept remains. |
| **UI / UX** | 🟢 KEEP | Vault view, item listings, icons remain the same. |
| **API Client** | 🔴 DELETE | `HttpClient` calls to `/v1/*` endpoints are removed. |
| **Data Synchronization** | 🔵 NEW | Implement **Midnight Compact SDK** + **IPFS Client** to fetch/save data. |
| **Auth Flow** | 🟡 MODIFY | Remove "Login Form" (User/Pass). Add **"Connect Wallet"** + **"Unlock Vault"** (Master Pass). |
| **Local Storage** | 🟡 MODIFY | `AliasClientDb` (SQLite) remains as a **Offline Cache**. |

---

## 3. Infrastructure & New Components

| Component | Status | Description |
|-----------|--------|-------------|
| **Smart Contract** | 🔵 NEW | **Midnight Compact** contract to manage Vault Registry (CID map) + Alias Registry. |
| **IPFS Gateway** | 🔵 NEW | Setup Pinning Service (Pinata) or private IPFS nodes for reliability. |
| **Mail Bridge** | 🔵 NEW | A small service that bridges **Mox** (SMTP) with **Midnight** (Auth). |
| **Midnight Guardian**| 🔵 NEW | Time-locked interaction for "Zero-Knowledge Recovery". |

---

## 4. Implementation Priorities

1.  **Refactor Clients:** Abstract the "Data Layer" so we can swap REST for Chain/IPFS.
2.  **Smart Contract MVP:** Implement basic "User -> CID" registry.
3.  **Migration Tool:** Script to export from SQL -> Upload IPFS -> Mint Chain Identity.
