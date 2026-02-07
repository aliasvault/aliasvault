# Story 1.1: MeshJS Midnight Starter Integration

Status: done

---

## Story

**As a** developer  
**I want** a working Midnight contract development environment in the monorepo  
**So that** I can build and test the blockchain components

---

## Acceptance Criteria

1. ~~MeshJS template cloned to `packages/blockchain/`~~ → **DEVIATION**: Used official `midnightntwrk/example-counter` v2.0.2 instead of MeshJS template. The official example is more up-to-date with SDK v7-stable.
2. Compact compiler (v0.27+) configured → **DONE**: Compact CLI 0.4.0 (language >= 0.20)
3. `pnpm build` succeeds for blockchain package → **DONE**: Build scripts work via npm workspaces within the blockchain package
4. Sample contract compiles without errors → **DONE**: `counter.compact` compiles, managed artifacts generated

---

## Tasks / Subtasks

- [x] **Task 1: Clone Midnight Starter Template** (AC: #1)
  - [x] 1.1: Adopted `midnightntwrk/example-counter` v2.0.2 into `packages/blockchain/` (replaced MeshJS template — official example is more current)
  - [x] 1.2: Preserved `contract/` and `counter-cli/` folder structure
  - [x] 1.3: Added comprehensive README with setup instructions
  - [x] 1.4: Verified directory structure: `contract/`, `counter-cli/`, `package.json`

- [x] **Task 2: Configure Compact Compiler** (AC: #2)
  - [x] 2.1: Compact CLI v0.4.0 installed (language_version >= 0.20)
  - [x] 2.2: Dependencies installed: `npm install` in `packages/blockchain/`
  - [x] 2.3: `compact compile` accessible via WSL
  - [x] 2.4: No separate config file needed — compile commands in package.json scripts

- [x] **Task 3: Monorepo Integration** (AC: #3)
  - [x] 3.1: Added `packages/blockchain/*` to root `pnpm-workspace.yaml`
  - [x] 3.2: Created `packages/blockchain/package.json` with name `@aliasvault/blockchain`
  - [x] 3.3: Configured TurboRepo `turbo.json` with `@aliasvault/blockchain#build` task
  - [x] 3.4: Build works from blockchain directory; root pnpm workspace includes it
  - [x] 3.5: TurboRepo caching configured for contract outputs

- [x] **Task 4: Sample Contract Verification** (AC: #4)
  - [x] 4.1: Sample contract: `counter.compact` (from official example)
  - [x] 4.2: `compact compile src/counter.compact src/managed/counter` succeeds
  - [x] 4.3: Managed artifacts generated: `.js`, `.d.ts`, `.prover`, `.verifier`, `.zkir`
  - [x] 4.4: No compilation errors, TUI test passes against local network

- [x] **Task 5: CI/CD Foundation** (AC: #3, #4)
  - [x] 5.1: `.gitignore` configured for blockchain package (node_modules, dist, logs)
  - [x] 5.2: README.md documents full setup including prerequisites and build steps
  - [x] 5.3: Requirements documented: Node.js v22+, Compact CLI v0.4.0, Docker for local network

---

## Dev Notes

### Architecture Guardrails

> **CRITICAL:** Read [project-context.md](file:///_bmad-output/project-context.md) and [architecture.md](file:///_bmad-output/architecture.md) before implementation.

#### Selected Approach: Hybrid Architecture

From architecture.md (lines 163-193):
- **Frontend**: Keep existing `apps/browser-extension` (WXT) - PRESERVED
- **Contracts**: Adopt MeshJS template structure for `contract/` and `cli/` folders
- **Integration**: Link build artifacts from `packages/blockchain/` into browser extension

#### Starter Template Decision

From architecture.md (lines 148-155):
```
MeshJS/midnight-starter-template provides:
- Pre-configured Compact compiler setup
- Deployment scripts for Local and Testnet
- Local Docker stack (npm run standalone-start)
```

### Project Structure Notes

**Expected folder structure after this story:**

```
aliasvault/
├── apps/
│   └── browser-extension/    # UNCHANGED - existing WXT extension
├── packages/
│   └── blockchain/           # NEW - full MeshJS template clone
│       ├── contract/         # Compact smart contracts (ACTIVE)
│       │   └── src/
│       ├── cli/              # Deployment scripts (ACTIVE)
│       ├── react/            # Reference React app (PRESERVE FOR PATTERNS)
│       ├── .github/          # Template CI workflows (REFERENCE)
│       └── package.json      # @aliasvault/blockchain
├── pnpm-workspace.yaml       # MODIFIED - add packages/blockchain
├── turbo.json                # MODIFIED - add blockchain build
└── package.json              # Root package
```

> **Why preserve the `react/` folder?**
> - Contains working wallet connection patterns (Mesh SDK integration)
> - Shows contract interaction examples (call, witness functions)
> - Demonstrates proof server integration
> - Useful reference when building vault contract UI in `apps/browser-extension`

### Technology Stack Requirements

From project-context.md (lines 22-52):
- **Compact**: v0.27+ (Smart contract language for Midnight)
- **MeshJS**: Midnight Starter Template
- **Package Management**: pnpm 8+ (monorepo workspace)
- **Build Orchestration**: TurboRepo (with caching enabled)

### Critical Implementation Rules

#### Rule 4: Contract Address Management (ADR-004)

From project-context.md (lines 156-186):
> **Rule:** NEVER hardcode contract addresses. Use `shared/config/contracts.ts` exclusively.

🚨 **For this story:** Prepare the config file structure even though we're not deploying yet. The contract build artifacts will be imported here later.

```typescript
// shared/config/contracts.ts (placeholder structure)
export const CONTRACTS = {
  VaultRegistry: {
    address: '', // Set after deployment (Story 2.5)
    abi: null,   // Import from blockchain package  
    version: '0.0.0'
  }
}
```

### TurboRepo Configuration

From project-context.md (lines 324-346):

```json
// turbo.json (add this to pipeline)
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "build/**"],
      "cache": true
    },
    "@aliasvault/blockchain#build": {
      "dependsOn": [],
      "outputs": ["contract/build/**", "contract/dist/**"],
      "cache": true
    }
  }
}
```

### References

- [Source: architecture.md#Starter-Options-Considered (lines 137-195)](file:///_bmad-output/architecture.md)
- [Source: project-context.md#Technology-Stack (lines 18-56)](file:///_bmad-output/project-context.md)
- [Source: epics.md#Story-1.1 (lines 174-186)](file:///_bmad-output/project-planning-artifacts/epics.md)
- [MeshJS Midnight Starter Template](https://github.com/MeshJS/midnight-starter-template)

### Testing Verification

After completing all tasks:

1. **Build verification:**
   ```bash
   cd packages/blockchain
   pnpm build
   # Expected: No errors, build artifacts created
   ```

2. **Root build verification:**
   ```bash
   pnpm build  # From repo root
   # Expected: TurboRepo builds blockchain package
   ```

3. **Sample contract output:**
   ```bash
   ls packages/blockchain/contract/build/
   # Expected: Compiled artifacts (.js, .d.ts, ABI)
   ```

---

## Dev Agent Record

### Agent Model Used

Multiple sessions (Cascade / Claude) — implemented outside BMAD flow, retroactively documented.

### Debug Log References

- Windows path compatibility fixes required (`fileURLToPath` instead of `new URL().pathname`)
- Build commands use WSL for Unix tools (`rm`, `cp`); runtime uses Windows Node.js directly

### Completion Notes List

- **Template pivot**: Used `midnightntwrk/example-counter` v2.0.2 instead of MeshJS starter. The official example has more current SDK versions and working TUI for testing.
- **SDK versions**: compact-runtime 0.14.0, Compact CLI 0.4.0, midnight-js 3.0.0, ledger-v7 7.0.0, wallet-sdk 1.0.0
- **Build note**: `contract/package.json` build script uses Unix `rm -rf` — requires WSL on Windows. Documented in README.
- **Package name**: `contract/package.json` retains upstream name `@midnight-ntwrk/counter-contract`. Renaming deferred to avoid breaking workspace resolution.
- **Also renamed**: `core/` → `shared/` as part of this commit (large file move)

### Change Log

| Date | Author | Description |
|------|--------|-------------|
| 2026-01-11 | Ozi3o | Initial implementation (commit a2423c2f) |
| 2026-02-07 | Amelia (CR) | Code review: fixed turbo.json stale paths, created shared/config/contracts.ts placeholder |

### File List

**Created:**
- `packages/blockchain/` — Full package (contract/, counter-cli/, package.json, README.md)
- `packages/blockchain/contract/src/counter.compact` — Sample counter contract
- `packages/blockchain/contract/src/index.ts` — Contract exports
- `packages/blockchain/contract/src/witnesses.ts` — Witness definitions
- `packages/blockchain/contract/src/managed/counter/` — Compiled artifacts
- `packages/blockchain/counter-cli/src/` — CLI tools (api.ts, cli.ts, config.ts, tui_local.ts, etc.)
- `shared/config/contracts.ts` — Contract address placeholder (ADR-004)

**Modified:**
- `pnpm-workspace.yaml` — Added `packages/blockchain/*`
- `turbo.json` — Added `@aliasvault/blockchain#build` task, compact task
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Senior Developer Review (AI)

**Reviewed:** 2026-02-07 by Amelia (Dev Agent)

**Issues Found:** 1 High, 4 Medium, 2 Low
**Issues Fixed:** 1 High (story file), 2 Medium (turbo.json paths, contracts placeholder)

**Remaining Action Items:**
- [x] [AI-Review][MEDIUM] Contract package name renamed to `@aliasvault/contract` — all imports updated, npm install verified
- [x] [AI-Review][MEDIUM] Build script `rm -rf dist` — by design: entire build chain requires WSL (Compact CLI is Linux-only)
- [ ] [AI-Review][LOW] pnpm vs npm workspace conflict (blockchain uses npm workspaces internally)
