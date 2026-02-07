# ADR-001: SMTP Infrastructure for Decentralized Email Aliases

**Status:** Accepted  
**Date:** 2026-01-11  
**Decision Makers:** Architect (Winston), PM

---

## Context

Epic 5 (Alias Email System) requires SMTP infrastructure to receive emails for `@alias.id` aliases and store them encrypted on IPFS with blockchain-verified ownership.

**Conflict discovered:** The architecture document proposed Mox (Go) + Express TypeScript, but the brownfield codebase contains a complete SmtpServer NuGet implementation in C#.

### Existing Brownfield Implementation

| Component | Location | Lines |
|-----------|----------|-------|
| SMTP Server | `SmtpServer.SmtpServer` NuGet | - |
| Message Handler | `DatabaseMessageStore.cs` | 391 |
| Integration Tests | `SmtpServerTests.cs` | 352 |
| Deployment | Dockerfile + s6-scripts | - |

### Key Constraint Discovered

**Midnight SDK is TypeScript/JavaScript only.** No .NET/C# SDK exists.

Sources:
- [midnight.network docs](https://midnight.network) - SDK documentation
- NuGet search - No Midnight packages found
- [go.dev](https://go.dev) - SDK ecosystem analysis

---

## Decision

**Use Mox (Go SMTP server) + Express TypeScript bridge** as the architecture originally proposed.

The existing C# SmtpServer implementation cannot integrate with Midnight contracts without:
- Raw HTTP calls (no type safety, high risk)
- Additional HTTP bridge to TypeScript service (added complexity)

Both alternatives are inferior to building natively in TypeScript where Midnight SDK is available.

---

## Alternatives Considered

### Option 1: Adapt SmtpServer NuGet (REJECTED)

**Pros:**
- Reuse 391-line handler and 352-line test suite
- Proven production code

**Cons:**
- ❌ Cannot use Midnight SDK (TypeScript only)
- ❌ Would require raw HTTP RPC or bridge service
- ❌ Violates Big Bang migration strategy (no v1/v2 integration)

### Option 2: SmtpServer + HTTP Bridge (REJECTED)

**Pros:**
- Keep SMTP layer, add TypeScript for blockchain

**Cons:**
- ❌ Two services to maintain
- ❌ Network hop latency
- ❌ Increased operational complexity

### Option 3: Mox + Express (ACCEPTED)

**Pros:**
- ✅ Native Midnight SDK integration
- ✅ Single language stack (TypeScript)
- ✅ Mox is production-ready (Go, extensive tests)
- ✅ Built-in webhook support (`IncomingWebhook`)

**Cons:**
- New codebase (not reusing existing tests)
- New infrastructure to deploy

---

## Consequences

### Positive

- Clean integration with Midnight SDK
- Consistent with Big Bang migration strategy
- Simplified deployment (TypeScript everywhere for v2)

### Negative

- Existing SmtpServer tests don't transfer (new test suite needed)
- Team needs familiarity with Mox configuration
- Additional infrastructure (Mox container)

### Neutral

- v1 SmtpServer continues operating during migration period
- Encryption patterns (RSA-OAEP) transfer conceptually

---

## Technical Notes

### Mox Webhook Configuration

The architecture document contained a minor syntax error. Correct configuration:

```yaml
# domains.conf (sconf format)
Accounts:
  aliasvault:
    IncomingWebhook:
      URL: http://smtp-bridge:3000/receive-email
      Authorization: Bearer ${BRIDGE_SECRET}
```

### Verification Sources

| Claim | Verified | Source |
|-------|----------|--------|
| Midnight SDK = TypeScript only | ✅ | midnight.network, NuGet search |
| Mox production-ready | ✅ | github.com/mjl-/mox, xmox.nl |
| Mox webhook support | ✅ | xmox.nl/config (`IncomingWebhook`) |

---

## Related Documents

- [Architecture Section 5](file:///_bmad-output/architecture.md) - SMTP Bridge Service Architecture
- [Epic 5](file:///_bmad-output/project-planning-artifacts/epics.md) - Alias Email System
- [Project Context](file:///_bmad-output/project-context.md) - SDK constraint rule
