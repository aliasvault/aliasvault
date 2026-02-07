# Source Tree Analysis

**Repository Type:** Monorepo
**Root:** `c:\Users\ozi3o\Documents\projects\blockchain\aliasvault`

## High-Level Structure

```
aliasvault/
├── apps/                    # Application source code
│   ├── browser-extension/   # WXT-based browser extension
│   ├── mobile-app/          # Expo/React Native mobile app
│   └── server/              # .NET 8 Monolith (API + Client)
├── docs/                    # Project documentation (Jekyll website)
├── scripts/                 # Utility scripts
├── docker-compose.yml       # Production deployment config
└── PROPOSAL_DECENTRALIZED_VAULT.md  # Decentralization Proposal (New)
```

## Detailed Analysis by Part

### 1. Server (`apps/server`)
**Framework:** .NET 8 (ASP.NET Core)
**Architecture:** Monolithic Solution with clean separation of concerns.

```
apps/server/
├── AliasVault.Api/          # Core REST API (Controllers)
│   └── Controllers/         # Auth, Vault, Identity endpoints
├── AliasVault.Client/       # Web Client (Blazor/Razor)
│   └── wwwroot/             # Static assets
├── AliasVault.Admin/        # Admin Dashboard for self-hosters
├── AliasVault.Shared/       # Shared business logic & models
├── Databases/               # Entity Framework Contexts
│   ├── AliasServerDb/       # Server-side schema (User, Vault)
│   └── AliasClientDb/       # Client-side schema (Local Sync)
├── Services/                # Background Services
│   └── AliasVault.SmtpService/ # Inbound Email Processing
└── Utilities/               # Helper libraries (Crypto, Auth, Logging)
```

**Key Entry Points:**
- API: `AliasVault.Api/Program.cs`
- Client: `AliasVault.Client/Program.cs`

### 2. Browser Extension (`apps/browser-extension`)
**Framework:** WXT + React
**Architecture:** Entrypoint-based extension

```
apps/browser-extension/
├── src/
│   ├── entrypoints/         # Extension targets
│   │   ├── background/      # Service worker
│   │   ├── content/         # Content scripts
│   │   └── popup/           # Toolbar popup UI
│   ├── utils/               # Shared utilities
│   └── hooks/               # React hooks
├── package.json
└── wxt.config.ts            # Build configuration
```

### 3. Mobile App (`apps/mobile-app`)
**Framework:** React Native + Expo
**Architecture:** Cross-platform mobile

```
apps/mobile-app/
├── src/                     # Source code (inferred)
├── package.json
└── app.json                 # Expo config
```

## Critical Integration Points

1.  **Shared Crypto:** Both Client and Server use `AliasVault.Cryptography.*` (C#) or ported JS logic.
2.  **API Contract:** All clients (Web, Mobile, Extension) communicate with `AliasVault.Api`.
3.  **Database:** Server manages PostgreSQL; Clients sync local replicas (verified by `AliasClientDb`).
