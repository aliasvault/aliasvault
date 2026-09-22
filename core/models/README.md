# Core Models

This package serves as the **single source of truth** for data models across all AliasVault platforms.

## What This Does

This package performs two key functions:

### 1. TypeScript Distribution (Linked as Source)
TypeScript models are consumed as the `@aliasvault/models` package:
- **Browser Extension**: linked as source through `@aliasvault/models` (see `core/client`)
- **Mobile App**: linked as source through `@aliasvault/models` (a `file:` dependency; `metro.config.js` watches `core/`)

### 2. Native Code Generation (Transformed)
Automatically generates platform-specific models and icon assets from TypeScript sources:

| Source                      | Generated Output                                                      | Language      |
|-----------------------------|-----------------------------------------------------------------------|---------------|
| `src/vault/FieldKey.ts`     | `apps/server/Databases/AliasClientDb/Models/FieldKey.cs`              | C#            |
| `src/vault/FieldKey.ts`     | `apps/mobile-app/ios/VaultModels/FieldKey.swift`                      | Swift         |
| `src/vault/FieldKey.ts`     | `apps/mobile-app/android/.../vaultstore/models/FieldKey.kt`           | Kotlin        |
| `src/icons/ItemTypeIcons.ts`| `apps/server/Databases/AliasClientDb/Models/ItemTypeIcons.cs`         | C#            |
| `src/icons/ItemTypeIcons.ts`| `apps/mobile-app/ios/VaultModels/ItemTypeIcons.swift`                 | Swift         |
| `src/icons/ItemTypeIcons.ts`| `apps/mobile-app/android/.../vaultstore/models/ItemTypeIcons.kt`      | Kotlin        |
| `src/icons/ItemTypeIcons.ts`| `apps/mobile-app/components/items/ItemTypeIconComponents.tsx`         | React Native  |
| `src/icons/AppIcons.ts`     | `apps/server/Databases/AliasClientDb/Models/AppIcons.cs`              | C#            |
| `src/icons/AppIcons.ts`     | `apps/mobile-app/ios/VaultModels/AppIcons.swift`                      | Swift         |
| `src/icons/AppIcons.ts`     | `apps/mobile-app/android/.../vaultstore/models/AppIcons.kt`           | Kotlin        |
| `src/icons/AppIcons.ts`     | `apps/mobile-app/components/items/AppIconComponents.tsx`              | React Native  |

### 3. Registry and Vocabulary Generators

| Generator | Source of truth | Emits |
|-----------|-----------------|-------|
| `scripts/generate-vault-table-registry.cjs` | `src/vault/VaultTableRegistry.ts` | the Rust codec's datamodel registry, the C# `VaultTableRegistry`, and `VaultDataBucketCategory` (C#, Swift, Kotlin) |
| `scripts/generate-key-vocabulary.cjs` | the `VOCABULARIES` table inside the script | `UnlockMethodType`, `ManifestKeyType`, `VaultKeyAlgorithm` |
| `scripts/generate-app-defaults.cjs` | `src/defaults/AppDefaults.ts` | the Swift and Kotlin `AppInfo` (minimum server version, default URLs) |

The key vocabulary is the set of tokens naming how a vault key is protected, which unlock method encrypts a
user's Account Key, how a manifest's VEK reaches a given user, and which algorithm a piece of key ciphertext
uses. Each token is a contract shared by the API, the database and every client, so it is declared once and
emitted per platform. A member's `token` is the only identifier that is persisted or transmitted; the C# enum
ordinals follow declaration order and are cosmetic, so members can be reordered freely.
