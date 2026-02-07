# Data Models - Server

The server uses **Entity Framework Core** with a PostgreSQL compatible schema.

## Core Entities

### 1. Vault (`AliasServerDb.Vault`)
Stores the encrypted user data. The server sees this as an opaque blob.

| Field | Type | Description |
|-------|------|-------------|
| `Id` | `Guid` | Primary Key |
| `UserId` | `string` | FK to `AliasVaultUser` |
| `VaultBlob` | `string` | **Encrypted** vault JSON (AES-256-GCM) |
| `RevisionNumber` | `long` | Version control (incremented on update) |
| `Version` | `string` | Data model version (e.g., "0.20.0") |
| `Salt` | `string` | SRP Salt (100 chars) |
| `Verifier` | `string` | SRP Verifier (1000 chars) |
| `EncryptionSettings` | `json` | KDF parameters (Argon2id config) |

> **Note:** `Salt` and `Verifier` are stored with the *Vault* (not just the User) to ensure that if a user restores an old vault backup, the cryptographic material matches the password used at that time.

### 2. User (`AliasServerDb.AliasVaultUser`)
Extends ASP.NET Identity `IdentityUser`.

| Field | Type | Description |
|-------|------|-------------|
| `Id` | `string` | Primary Key |
| `PasswordChangedAt` | `DateTime` | Timestamp of last password rotation |
| `MaxEmails` | `int` | Quota limit (0 = unlimited) |
| `EmailsReceived` | `int` | Lifetime counter for abuse detection |
| `TwoFactorEnabled` | `bool` | Inherited from IdentityUser |

### 3. Email Claim (`AliasServerDb.UserEmailClaim`)
Represents an alias registered by a user.

| Field | Type | Description |
|-------|------|-------------|
| `Address` | `string` | Full email address (sanitized) |
| `AddressLocal` | `string` | Local part (before @) |
| `AddressDomain` | `string` | Domain part (after @) |
| `Disabled` | `bool` | If true, rejects incoming mail |

### 4. Encryption Key (`AliasServerDb.UserEncryptionKey`)
Stores public keys for sharing/Zero-Knowledge features.

| Field | Type | Description |
|-------|------|-------------|
| `PublicKey` | `string` | RSA/ECC public key |
| `IsPrimary` | `bool` | Active key for new encryption |

## Relationships
- **User** 1:N **Vault** (History retention)
- **User** 1:N **EmailClaim**
- **User** 1:N **EncryptionKey**
