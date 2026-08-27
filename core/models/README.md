# Core Models

This package serves as the **single source of truth** for data models across all AliasVault platforms.

## What This Does

This package performs two key functions:

### 1. TypeScript Distribution (As-Is)
Builds and copies TypeScript models directly to:
- **Browser Extension**: `apps/browser-extension/src/utils/dist/core/models`
- **Mobile App**: `apps/mobile-app/utils/dist/core/models`

These apps consume the TypeScript models as-is, enabling type-safe development with no manual synchronization needed.

### 2. Native Code Generation (Transformed)
Automatically generates platform-specific models from TypeScript sources:

| Source | Generated Output | Language |
|--------|-----------------|----------|
| `src/vault/FieldKey.ts` | `apps/server/Databases/AliasClientDb/Models/FieldKey.cs` | C# |
| `src/vault/FieldKey.ts` | `apps/mobile-app/ios/VaultModels/FieldKey.swift` | Swift |
| `src/vault/FieldKey.ts` | `apps/mobile-app/android/.../vaultstore/models/FieldKey.kt` | Kotlin |

### 3. Registry and Vocabulary Generators

| Generator | Source of truth | Emits |
|-----------|-----------------|-------|
| `scripts/generate-vault-table-registry.cjs` | `src/vault/VaultTableRegistry.ts` | the Rust codec's datamodel registry, the C# `VaultTableRegistry`, and `VaultDataBucketCategory` (C#, Swift, Kotlin) |
| `scripts/generate-key-vocabulary.cjs` | the `VOCABULARIES` table inside the script | `UnlockMethodType`, `ManifestKeyType`, `VaultKeyAlgorithm` |

The key vocabulary is the set of tokens naming how a vault key is protected, which unlock method encrypts a
user's Account Key, how a manifest's VEK reaches a given user, and which algorithm a piece of key ciphertext
uses. Each token is a contract shared by the API, the database and every client, so it is declared once and
emitted per platform. A member's `token` is the only identifier that is persisted or transmitted; the C# enum
ordinals follow declaration order and are cosmetic, so members can be reordered freely.
