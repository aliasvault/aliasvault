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
| `src/vault/FieldKey.ts` | `apps/mobile-app/ios/AliasVault/VaultModels/FieldKey.swift` | Swift |
| `src/vault/FieldKey.ts` | `apps/mobile-app/android/.../vaultstore/models/FieldKey.kt` | Kotlin |
