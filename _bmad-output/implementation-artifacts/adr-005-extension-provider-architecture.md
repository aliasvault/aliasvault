# ADR-005: Browser Extension Provider Architecture for Contract Write Operations

**Status:** Proposed
**Date:** 2026-03-28
**Author:** Winston (Architect Agent)
**Context:** Story 6.5 E2E smoke test revealed that `MidnightContractService.joinVaultRegistry()` only provides 2 of 5 required `MidnightProviders` to `findDeployedContract()`. All on-chain write operations are blocked.

---

## Problem Statement

The Midnight JS SDK's `findDeployedContract()` requires all 5 `MidnightProviders`:

| Provider | Purpose | Current Status |
|----------|---------|---------------|
| `publicDataProvider` | Reads blockchain state via indexer | **Provided** |
| `proofProvider` | Generates ZK proofs via proof server | **Provided** |
| `privateStateProvider` | Stores ZK private state (witness data) | **Missing** |
| `zkConfigProvider` | Loads compiled circuit artifacts (verifier keys) | **Missing** |
| `walletProvider` + `midnightProvider` | Balances transactions (tDUST fees) + submits to network | **Missing** |

The `as any` cast on the providers object hid TypeScript errors. Unit tests mock `findDeployedContract` entirely, so this was never caught until Story 6.5 E2E testing on preprod.

**Impact:** All contract WRITE operations fail — vault upload, alias claim, relay authorization, guardian setup, backup wallet management. READ operations (indexer queries) work fine.

---

## Research Findings

### SDK Reference Projects Analyzed

| Project | Context | Provider Pattern |
|---------|---------|-----------------|
| bboard-ui | Browser DApp (React) | All 5 providers, Lace DApp Connector for wallet |
| midnight-bank (bank-ui) | Browser DApp (React) | All 5 providers, Lace DApp Connector for wallet |
| midnight-game-2 (Paima) | Browser game | All 5 providers, Lace DApp Connector for wallet |
| naval-battle-game | Browser DApp | All 5 providers, Lace DApp Connector for wallet |
| counter-cli | Node.js CLI | All 5 providers, wallet-sdk-facade for wallet |
| bboard-cli | Node.js CLI | All 5 providers, wallet-sdk-facade for wallet |
| midnames | Node.js CLI | All 5 providers, wallet-sdk-facade for wallet |
| midnight-js testkit | Test harness | All 5 providers, test wallet provider |

**Key insight:** Every single reference project provides all 5 providers. There is no shortcut.

### Finding 1: Wallet Operations Use Serializable Hex Strings

From `bboard-ui/src/contexts/BrowserDeployedBoardManager.ts`:

```typescript
walletProvider: {
  getCoinPublicKey(): string {
    return shieldedAddresses.shieldedCoinPublicKey;
  },
  getEncryptionPublicKey(): string {
    return shieldedAddresses.shieldedEncryptionPublicKey;
  },
  balanceTx: async (tx: UnboundTransaction): Promise<FinalizedTransaction> => {
    const serializedTx = toHex(tx.serialize());
    const received = await connectedAPI.balanceUnsealedTransaction(serializedTx);
    return Transaction.deserialize('signature', 'proof', 'binding', fromHex(received.tx));
  },
},
midnightProvider: {
  submitTx(tx: BalancedTransaction): Promise<TransactionId> {
    return wallet.submitTransaction(tx);
  },
},
```

Transactions are serialized to hex before the wallet processes them, and results come back as hex. This means wallet operations **can cross process boundaries** (background service worker ↔ page context) via `chrome.scripting.executeScript` or message passing.

### Finding 2: In-Memory Private State Providers Exist in SDK Ecosystem

Both `bboard-ui` and `midnight-bank` include `inMemoryPrivateStateProvider` — simple `Map`-based implementations:

```typescript
// From bboard-ui/src/in-memory-private-state-provider.ts
export const inMemoryPrivateStateProvider = <PSI, PS>(): PrivateStateProvider<PSI, PS> => {
  const record = new Map<PSI, PS>();
  const signingKeys = {} as Record<ContractAddress, SigningKey>;
  return {
    async set(key, state) { record.set(key, state); },
    async get(key) { return record.get(key) ?? null; },
    async remove(key) { record.delete(key); },
    async clear() { record.clear(); },
    async setSigningKey(addr, key) { signingKeys[addr] = key; },
    async getSigningKey(addr) { return signingKeys[addr] ?? null; },
    // ...
  };
};
```

Since the browser extension recreates private state from the secret key each session (via `createVaultRegistryPrivateState(secretKey)`), in-memory is the correct choice. No persistence needed.

**Note:** SDK v3.1.0 added `setContractAddress()` to the `PrivateStateProvider` interface. The in-memory implementations above predate this. Our implementation must include it.

### Finding 3: FetchZkConfigProvider Works in Service Workers

Browser DApps use:
```typescript
zkConfigProvider: new FetchZkConfigProvider<CircuitKeys>(zkConfigPath, fetch.bind(window))
```

The `fetch` API is available in Chrome MV3 service workers. The question is where to host the ZK artifacts (compiled contract's `managed/` directory containing verifier keys and circuit configs).

### Finding 4: levelPrivateStateProvider Now Requires Encryption

From the counter example migration guide (SDK v3.1.0):
```
levelPrivateStateProvider now requires either a walletProvider or
privateStoragePasswordProvider for encrypting private state storage.
```

This is moot for our use case since we'll use in-memory, not level. But worth noting if we ever switch to persistent private state.

### Finding 5: Browser Extension ≠ Browser DApp

All SDK reference projects are standard browser DApps (React SPAs running in a web page). They access Lace wallet directly via `window.midnight.mnLace`. Our browser extension has a fundamentally different architecture:

- **Background service worker**: No DOM, no `window.midnight`, no dynamic `import()`, no LevelDB filesystem
- **Popup page**: Extension-origin page (`chrome-extension://...`), Lace doesn't inject into extension pages
- **Content script**: Can inject into web pages, can access `window.midnight` via MAIN world

This means we need a **proxy pattern** to bridge the service worker ↔ Lace wallet gap.

---

## Architecture Options

### Option A: Full Page-Context Injection

Move ALL contract interactions to the web page's MAIN world via `chrome.scripting.executeScript`.

```
Background ──(args)──→ Page MAIN world ──→ Lace wallet
                       (SDK + contract code)
```

**Pros:**
- Simplest conceptually — all SDK code runs where Lace is available
- No proxy complexity

**Cons:**
- Must bundle entire Midnight SDK as injectable script (~5-20MB)
- Secret key exposed to page context (security risk)
- Complex build pipeline for injectable bundles
- Fragile — injected code must coexist with page's own scripts

**Verdict:** Not recommended. Security risk too high.

### Option B: Offscreen Document

Use Chrome's Offscreen API to create a hidden document with full DOM + dynamic import support.

```
Background ──(message)──→ Offscreen document ──→ SDK operations
                          (full DOM context)
```

**Pros:**
- Full page capabilities (DOM, dynamic imports)
- Isolated from web pages

**Cons:**
- Offscreen documents CANNOT access `window.midnight` (isolated from web pages)
- Still needs a proxy to Lace wallet via content script
- Adds architectural complexity (background + offscreen + content script)
- Chrome limits offscreen document lifetime

**Verdict:** Not recommended. Doesn't solve the Lace wallet access problem.

### Option C: Hybrid Read/Write Split with Wallet Proxy (Recommended)

Keep reads in background. For writes, create thin proxy objects that forward wallet operations to the page context.

```
┌─────────────────────────────┐
│  Background Service Worker  │
│                             │
│  READ ops: direct           │──→ indexer (publicDataProvider)
│                             │
│  WRITE ops: full provider   │
│  stack with proxy wallet:   │
│  ├─ privateStateProvider    │  (in-memory, in-process)
│  ├─ publicDataProvider      │  (indexer, in-process)
│  ├─ zkConfigProvider        │  (fetch-based, in-process)
│  ├─ proofProvider           │  (http proof server, in-process)
│  ├─ walletProvider ─────────┼──┐
│  └─ midnightProvider ───────┼──┤  serialized hex
└─────────────────────────────┘  │  via chrome.scripting
                                 │  .executeScript
┌─────────────────────────────┐  │  (world: MAIN)
│  Active Web Page Context    │  │
│                             │◄─┘
│  window.midnight.mnLace     │
│  ├─ balanceUnsealedTx(hex)  │
│  ├─ submitTransaction(tx)   │
│  └─ state() → keys          │
└─────────────────────────────┘
```

**Pros:**
- Secret key NEVER leaves the background service worker
- Only serialized hex transactions cross the boundary (same security model as all Midnight DApps)
- 4 of 5 providers run fully in-process in the background
- Only wallet operations need the proxy (2 methods: `balanceTx`, `submitTx`)
- Minimal change to existing architecture
- Leverages Lace's existing tDUST balance — no separate wallet funding
- Lace provides transaction approval UI — user sees what they're signing

**Cons:**
- Requires an active web page tab for wallet operations (user must have a tab open)
- Proxy adds latency (background → page → Lace → page → background)
- Must handle edge cases (tab closed, Lace not available, connection expired)

**Verdict:** Recommended for preprod/testnet. Best security/complexity trade-off.

### Option D: Extension-Controlled Tab

Open a dedicated extension tab that loads a web page where Lace is available.

**Pros:**
- Controlled environment
- No dependency on user's current tab

**Cons:**
- Poor UX (opens a new tab for every transaction)
- Still needs the same proxy pattern as Option C

**Verdict:** Could complement Option C as a fallback when no suitable tab is available.

### Option E: In-Process Wallet (wallet-sdk-facade) — No Lace Dependency

Use the Midnight `wallet-sdk-facade` package to create a fully self-contained wallet in the service worker. This is the pattern used by all CLI examples (`counter-cli`, `bboard-cli`, `midnames-cli`). All 5 providers run entirely in-process with zero Lace dependency.

```
┌─────────────────────────────────┐
│  Background Service Worker      │
│                                 │
│  ALL ops: in-process            │
│  ├─ privateStateProvider        │  (in-memory Map)
│  ├─ publicDataProvider          │  (indexer HTTP/WS)
│  ├─ zkConfigProvider            │  (fetch-based)
│  ├─ proofProvider               │  (http proof server)
│  ├─ walletProvider ─────────────┼──→ WalletFacade.balanceTx()
│  └─ midnightProvider ───────────┼──→ WalletFacade.submitTx()
│                                 │
│  WalletBuilder.buildFromSeed(   │
│    indexer, indexerWS,           │
│    proofServer, node, seed,     │
│    networkId                    │
│  )                              │
└─────────────────────────────────┘
     No page context needed
     No Lace dependency
```

**SDK pattern** (from `midnames-cli/src/api.ts`):
```typescript
wallet = await WalletBuilder.buildFromSeed(
  indexer, indexerWS, proofServer, node, seed, getZswapNetworkId(), "info"
);
wallet.start();
// wallet now provides walletProvider + midnightProvider directly — all in-process
```

**Packages already installed in project:**
- `@midnight-ntwrk/wallet-sdk-facade@1.0.0`
- `@midnight-ntwrk/wallet-sdk-shielded@1.0.0`
- `@midnight-ntwrk/wallet-sdk-unshielded-wallet@1.0.0`
- `@midnight-ntwrk/wallet-sdk-dust-wallet@1.0.0`
- `@midnight-ntwrk/wallet-sdk-hd@3.0.0`

**Pros:**
- All 5 providers in-process — zero proxy complexity
- No tab dependency, no content script injection, no page context needed
- Architecturally clean — same pattern as CLI examples
- No Lace extension required at all
- Works even when browser has no open tabs

**Cons:**
- **~~MV3 service worker lifetime~~** *(mitigated)*: Lace wallet is also MV3 and solves this. The SDK provides `serializeState()` and `restore()` methods specifically designed for browser extensions. Wallet state can be persisted to `chrome.storage.session` and restored in ~1-2 seconds on service worker wake-up (vs 5-10s for full sync). This is a solved problem, not a blocker.
- **~~Separate Night/Dust balance~~** *(mitigated)*: Midnight's Dust registration system allows a **different Dust receiver address** than the Night holder. The `DustMappingDatum` has separate `c_wallet` (Night holder on Cardano) and `dust_address` (Dust receiver on Midnight) fields. This means the user's existing Lace Night tokens can generate Dust directly into the extension's in-process wallet address — no Night transfer needed. One-time registration via Lace or the cNIGHT-to-Dust DApp.
- **Wallet seed management**: Yet another secret to derive, store, and protect (though similar to existing `midnightSecretKey` pattern in `VaultCidStore`).
- **One-time Dust registration**: User must register their Night tokens to point `dust_address` at the extension wallet. This is a one-time setup step, not recurring friction, but does require the user to understand the concept.

**Mitigated concerns (originally listed as cons, now resolved):**
- ~~No transaction approval UI~~: Trivially implementable — show a confirmation dialog in the extension popup before signing. Same pattern as any browser extension permission prompt.
- ~~WebSocket stability~~: The `serializeState()`/`restore()` pattern handles service worker hibernation. WebSocket connections are re-established on restore, not maintained persistently.

**Key finding — Dust address separation:**

From `midnight-reserve-contracts` `DustMappingDatum`:
```typescript
const dustMappingDatum: Contracts.DustMappingDatum = {
  c_wallet: {
    VerificationKey: [addr.asBase()?.getPaymentCredential().hash!],  // Night holder (Lace/Cardano)
  },
  dust_address: extensionWalletDustAddress,  // Dust receiver (extension's in-process wallet)
};
```

The `dust_address` can be any valid Midnight Dust address — it does not need to belong to the same wallet holding Night. The `midnight-cnight-to-dust-dapp` even provides a UI for entering a manual Dust address. Registration can also be updated later to point to a different address.

**User flow for Option E with Dust delegation:**
1. Extension generates wallet from seed → derives Dust address
2. User connects Lace (holds Night on Cardano)
3. User registers Night for Dust generation, pointing `dust_address` to extension's wallet address (one-time)
4. Extension's wallet receives Dust automatically over time
5. Extension can now submit transactions independently — no Lace proxy needed for writes

**Verdict:** Recommended. With the Dust delegation pattern and SDK state serialization, the original major cons are resolved. Architecturally simpler than Option C (all in-process, no tab dependency, no content script injection, no Lace coupling for writes). The only remaining setup friction is the one-time Dust registration, which can be guided by the extension's onboarding flow.

### Option F: Server-Mediated Transactions (Future Strategic Direction)

Delegate transaction balancing and submission to a server-side component (e.g., guardian-portal or a new relay service) that runs in Node.js with no service worker constraints.

```
┌─────────────────────────────┐
│  Background Service Worker  │
│                             │
│  1. Create private state    │  (client-side, secret key stays here)
│  2. Request ZK proof        │──→ proof server (already external)
│  3. Send unbalanced tx      │──→ relay server
│                             │
└─────────────────────────────┘
                                    ┌──────────────────────────┐
                                    │  Relay Server (Node.js)  │
                                    │                          │
                                    │  4. Balance tx (own      │
                                    │     funded wallet)       │
                                    │  5. Submit to network    │──→ blockchain
                                    │                          │
                                    │  Full wallet-sdk-facade  │
                                    │  No service worker limits│
                                    └──────────────────────────┘
```

**Pros:**
- Zero extension complexity for wallet operations — just HTTP API calls
- No Lace dependency, no tab dependency, no service worker constraints
- Users never manage tDUST — server pays gas (meta-transaction / gasless pattern)
- Best UX for non-crypto-native users (password manager users shouldn't need to understand blockchain fees)
- Server runs in Node.js — full wallet-sdk-facade, persistent WebSockets, no lifetime limits
- `guardian-portal` already has full 6-provider stack in Node.js — pattern exists

**Cons:**
- **Centralization point**: Relies on server availability — against blockchain decentralization ethos
- **Operational cost**: Server's wallet needs Night tokens to generate Dust for all users' transactions. Dust is non-transferable — only the wallet holding Night generates its own Dust. The relay server must maintain sufficient Night balance.
- **Authorization complexity**: Server must verify user intent/ownership before submitting transactions (ZK proof provides this, but protocol design needed)
- **Bigger architectural shift**: Not a drop-in fix — requires new API endpoints, authorization protocol, and server wallet management
- **Trust model change**: Users must trust the relay not to censor or reorder their transactions

**Verdict:** Not recommended for current sprint. However, this is the strongest long-term architecture for mainnet. A password manager's users shouldn't need to understand Night, Dust, wallets, or Lace. Consider as a strategic follow-up after preprod validation.

---

## Decision Rationale: Comparing C, E, and F

The three viable options represent a spectrum of architectural ambition:

| Criterion | C: Lace Proxy | E: In-Process Wallet | F: Server-Mediated |
|-----------|--------------|---------------------|-------------------|
| Extension complexity | Medium (proxy) | Low (all in-process) | Lowest (HTTP calls) |
| Infrastructure needed | Lace extension for writes | Lace for Dust registration only | Relay server |
| Night/Dust management | Lace (user manages) | Dust delegated from Lace Night | Server (operational cost) |
| MV3 compatibility | Good (proxy is stateless) | Good (serialize/restore) | Good (just HTTP) |
| Tab dependency | Yes (needs web page) | No | No |
| User transparency | High (Lace approval UI) | Medium (extension approval dialog) | Low (server signs) |
| Implementation effort | ~8 points | ~5 points | ~13 points |
| Decentralization | Full (user's wallet) | Full (user's wallet) | Partial (relay trust) |
| Lace dependency for writes | Required (every write) | None (after one-time Dust registration) | None |
| Error surface area | High (tab, page, Lace API) | Low (all in-process) | Low (HTTP) |

### Option C advantages:
1. **Zero wallet management** — Lace handles Night tokens, Dust generation, wallet sync, key storage. Extension just proxies 2 methods.
2. **Pattern already half-built** — `WalletMessageHandler` already does `chrome.scripting.executeScript({ world: 'MAIN' })` to connect to Lace.

### Option C disadvantages:
1. **Tab dependency** — requires an active web page tab for every write operation. Fragile (tab closed, Lace not available, user on chrome:// page).
2. **Lace coupling** — extension is dependent on another extension's availability, API stability, and version compatibility for every transaction.
3. **Proxy latency** — background → page → Lace → page → background adds roundtrip overhead per transaction.
4. **Higher error surface** — cross-process communication failures, tab-not-found edge cases, Lace connection expiry.

### Option E advantages:
1. **Architecturally cleanest** — all 5 providers in-process, same proven pattern as CLI examples. No proxy, no tab, no content script injection.
2. **No runtime Lace dependency** — works without Lace installed after initial Dust registration. No open tabs needed. No page context needed.
3. **SDK explicitly supports this** — `serializeState()`/`restore()` designed for browser extensions. ~1-2s restore on service worker wake-up.
4. **Simpler error handling** — no cross-process communication failures, no tab-not-found edge cases.
5. **Dust delegation eliminates funding friction** — user's existing Lace Night tokens generate Dust into extension's wallet via `DustMappingDatum.dust_address`. No Night transfer needed.
6. **Lower implementation effort** (~5 points vs ~8 for Option C).

### Option E disadvantages:
1. **One-time Dust registration** — user must register Night tokens pointing `dust_address` to extension wallet. Can be guided by onboarding flow.
2. **Wallet lifecycle** — must implement serialize/restore cycle (though SDK provides the primitives).

### Option F advantages:
1. **Best user experience** — users never touch Night, Dust, wallets, or blockchain mechanics.
2. **Zero extension constraints** — server handles everything, extension just makes HTTP calls.

### Option F disadvantages:
1. **Biggest scope** — new relay server, authorization protocol, wallet funding pipeline.
2. **Centralization trade-off** — depends on server availability.
3. **Operational cost** — server's wallet needs Night tokens to generate Dust for all users.

### Recommendation: Option C now, Option E as future enhancement

**Phase 1 — Option C (Lace Proxy) for preprod/testnet:**

Option C is the pragmatic starting point because:
1. **Lace wallet integration already exists** — `WalletMessageHandler` already bridges to Lace via `chrome.scripting.executeScript({ world: 'MAIN' })`. The proxy pattern extends what's already built.
2. **Zero extra user setup** — users connect Lace (already required for testnet), and writes just work. No Dust registration, no wallet seed management, no new onboarding steps.
3. **Proven pattern** — all browser DApp reference projects (bboard-ui, midnight-bank, midnight-game-2) use this exact approach.
4. **Fastest path to validating on-chain writes on preprod** — the goal is to unblock Story 6.5's blocked acceptance criteria.

**Phase 2 — Option E (In-Process Wallet) as additional feature:**

Once Option C is validated on preprod, add Option E as a user-selectable alternative:
1. **Settings toggle**: "Wallet mode: Lace (default) / Self-hosted"
2. **Self-hosted mode**: Extension manages its own wallet via wallet-sdk-facade. User registers Dust delegation from Lace Night → extension's Dust address (one-time setup).
3. **Benefits for power users**: No tab dependency, no Lace required for writes after setup, works offline from Lace, more reliable (all in-process).
4. **Both modes share Phase 1 providers** — `InMemoryPrivateStateProvider`, `FetchZkConfigProvider`, `publicDataProvider`, `proofProvider` are identical. Only the wallet/midnight provider differs.

**Phase 3 (future) — Option F for mainnet:**

Server-mediated transactions eliminate all blockchain UX for end users. Password manager users shouldn't need to understand Night, Dust, wallets, or Lace.

**Architecture layering:**
```
┌─────────────────────────────────────────────┐
│  MidnightContractService.joinVaultRegistry  │
│  (consumes MidnightProviders interface)     │
├─────────────────────────────────────────────┤
│  privateStateProvider  │ InMemory (shared)  │
│  publicDataProvider    │ Indexer (shared)    │
│  zkConfigProvider      │ Fetch (shared)     │
│  proofProvider         │ HTTP (shared)      │
├────────────────────────┼────────────────────┤
│  walletProvider        │ Option C: LaceProxy│
│  midnightProvider      │ Option E: WalletSDK│
│                        │ Option F: RelayHTTP│
└────────────────────────┴────────────────────┘
```

The provider interface means switching wallet backends is a **swap of 2 provider implementations** — the rest of the stack is unchanged. This makes it safe to start with Option C and add Option E later without rework.

---

## Implementation Reference

### Option E Implementation (Recommended) — In-Process Wallet

**Phase 1: In-Process Providers (same as Option C Phase 1)**
- `InMemoryPrivateStateProvider` — see Phase 1a below
- `FetchZkConfigProvider` — see Phase 1b below

**Phase 2: Wallet-SDK Integration**

Create `src/services/providers/ExtensionWalletProvider.ts`:
```typescript
import { WalletBuilder } from '@midnight-ntwrk/wallet';
import type { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';

class ExtensionWalletProvider {
  private wallet: WalletFacade | null = null;

  async initialize(seed: string, config: NetworkConfig): Promise<void> {
    // Try restore from persisted state first (~1-2s)
    const stored = await chrome.storage.session.get('wallet_state');
    if (stored.wallet_state) {
      this.wallet = this.wallet!.restore(stored.wallet_state);
      await this.wallet.start(secretKeys);
    } else {
      // Full build from seed (~5-10s first time)
      this.wallet = await WalletBuilder.buildFromSeed(
        config.indexerUrl, config.wsIndexerUrl,
        config.proofServerUrl, config.nodeUrl,
        seed, networkId
      );
      await this.wallet.start(secretKeys);
    }
  }

  async persist(): Promise<void> {
    if (this.wallet) {
      const state = await this.wallet.serializeState();
      await chrome.storage.session.set({ wallet_state: state });
    }
  }

  getWalletProvider(): WalletProvider { /* delegate to this.wallet */ }
  getMidnightProvider(): MidnightProvider { /* delegate to this.wallet */ }
}
```

**Phase 3: Dust Registration Onboarding**
- On first setup, derive Dust address from wallet seed and display to user
- Guide user to register `dust_address` in Lace or cNIGHT-to-Dust DApp
- Monitor `wallet.state()` for `dust.walletBalance(new Date()) > 0n`

**Phase 4: Wire into MidnightContractService** — same as Option C Phase 3 but using `ExtensionWalletProvider` instead of `LaceWalletProxy`/`LaceMidnightProxy`.

### Option C Implementation (Fallback) — Lace Proxy

> **Note:** Retained as fallback reference. If Option E encounters unforeseen service worker issues during testing, Option C can be implemented using the details below.

### Implementation Phases

#### Phase 1: In-Process Providers (No Lace dependency)

**1a. InMemoryPrivateStateProvider**

Create `src/services/providers/InMemoryPrivateStateProvider.ts`:

```typescript
// Based on bboard-ui and midnight-bank patterns, updated for SDK v3.1.0
class InMemoryPrivateStateProvider implements PrivateStateProvider {
  private contractAddress = '';
  private states = new Map<string, any>();
  private signingKeys = new Map<string, any>();

  setContractAddress(address: string): void {
    this.contractAddress = address;
  }

  async get(id: string) { return this.states.get(`${this.contractAddress}:${id}`) ?? null; }
  async set(id: string, state: any) { this.states.set(`${this.contractAddress}:${id}`, state); }
  async remove(id: string) { this.states.delete(`${this.contractAddress}:${id}`); }
  async clear() { this.states.clear(); }

  async setSigningKey(addr: string, key: any) { this.signingKeys.set(addr, key); }
  async getSigningKey(addr: string) { return this.signingKeys.get(addr) ?? null; }
  async removeSigningKey(addr: string) { this.signingKeys.delete(addr); }
  async clearSigningKeys() { this.signingKeys.clear(); }

  async exportPrivateStates() { throw new Error('Not supported in browser extension'); }
  async importPrivateStates() { throw new Error('Not supported in browser extension'); }
}
```

**1b. ZkConfigProvider**

Use `FetchZkConfigProvider` from `@midnight-ntwrk/midnight-js-fetch-zk-config-provider`:

```typescript
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';

const zkConfigProvider = new FetchZkConfigProvider(zkConfigUrl, fetch.bind(globalThis));
```

**ZK artifact hosting decision:**

| Option | Extension Size Impact | Latency | Recommended For |
|--------|----------------------|---------|-----------------|
| Bundle as extension assets | +5-20MB per contract | Zero (local) | Testnet/preprod |
| Serve from proof server | None | ~100ms | Production |
| CDN / IPFS | None | ~200ms | Production |

Recommendation: Bundle for preprod testing, switch to CDN for mainnet.

#### Phase 2: Lace Wallet Proxy

**2a. Store wallet state during Lace connection**

Extend `WalletMessageHandler.handleConnectLaceWallet()` to also store:
- `coinPublicKey` (already retrieved as `shieldedAddress`)
- `encryptionPublicKey` (retrieve from `api.getShieldedAddresses()`)
- Active tab ID for future proxy calls

Store in `VaultCidStore` or a new `WalletStateStore`.

**2b. Create LaceWalletProxy**

Create `src/services/providers/LaceWalletProxy.ts`:

```typescript
class LaceWalletProxy implements WalletProvider {
  getCoinPublicKey(): string {
    return this.cachedCoinPublicKey; // stored during connection
  }

  getEncryptionPublicKey(): string {
    return this.cachedEncryptionPublicKey;
  }

  async balanceTx(tx: UnboundTransaction): Promise<FinalizedTransaction> {
    const serializedHex = toHex(tx.serialize());

    // Execute in page's MAIN world where Lace is available
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: this.activeTabId },
      world: 'MAIN',
      args: [serializedHex, this.networkId],
      func: async (txHex: string, networkId: string) => {
        const lace = window.midnight?.mnLace ?? Object.values(window.midnight)[0];
        const api = await lace.connect(networkId);
        const balanced = await api.balanceUnsealedTransaction(txHex);
        return balanced.tx; // hex string
      },
    });

    return Transaction.deserialize(..., fromHex(result.result));
  }
}
```

**2c. Create LaceMidnightProxy**

```typescript
class LaceMidnightProxy implements MidnightProvider {
  async submitTx(tx: BalancedTransaction): Promise<TransactionId> {
    // Similar chrome.scripting.executeScript pattern
    // Serialize tx → page context → wallet.submitTransaction → return txId
  }
}
```

#### Phase 3: Wire Into MidnightContractService

Update `joinVaultRegistry()` to use all 5 providers:

```typescript
async joinVaultRegistry(secretKey: Uint8Array): Promise<void> {
  const compiledContract = CompiledContract.make('vault-registry', VaultRegistry.Contract)
    .pipe(CompiledContract.withWitnesses(vaultRegistryWitnesses));

  const providers = {
    privateStateProvider: new InMemoryPrivateStateProvider(),
    publicDataProvider: indexerPublicDataProvider(this.indexerUrl, this.wsIndexerUrl),
    zkConfigProvider: new FetchZkConfigProvider(this.zkConfigUrl, fetch.bind(globalThis)),
    proofProvider: httpClientProofProvider(this.proofServerUrl),
    walletProvider: new LaceWalletProxy(walletState),
    midnightProvider: new LaceMidnightProxy(walletState),
  };

  this.contract = await findDeployedContract(providers, {
    contractAddress: this.contractAddress,
    compiledContract,
    privateStateId: 'vaultRegistryPrivateState',
    initialPrivateState: createVaultRegistryPrivateState(secretKey),
  });
}
```

Remove all `as any` casts — providers should be properly typed.

---

## Open Questions

1. **ZK artifact location**: Where does the proof server expect ZK configs? Can it serve them, or must they be hosted separately? Need to test with preprod proof server.

2. **Proof server ZK config**: Some examples pass `zkConfigProvider` as second argument to `httpClientProofProvider(proofServer, zkConfigProvider)`. Need to determine if our proof server setup requires this.

3. **Transaction serialization format**: The bboard-ui uses `toHex(tx.serialize())` and `Transaction.deserialize('signature', 'proof', 'binding', fromHex(hex))`. Need to verify this works with SDK v3.1.0 transaction types. The midnight-game-2 example uses a different serialization path involving `ZswapTransaction` and `getLedgerNetworkId()`.

### Option C specific questions:

4. **Lace connection persistence**: Does `lace.connect(networkId)` return a new API object each call, or reuse an existing session? If new, the `balanceTx` proxy can call `connect()` each time. If session-based, we need to handle connection expiry.

5. **Tab dependency**: The proxy requires an active web page tab. What happens if:
   - User closes all tabs? → Need fallback (Option D: open controlled tab)
   - User is on `chrome://` page? → Need to find a suitable tab or open one
   - Tab navigates away during transaction? → Need retry logic

### Option E specific questions:

6. **Wallet seed derivation**: Should the extension wallet seed be derived from the existing `midnightSecretKey`, or generated independently? Derived = one fewer secret to manage, but tighter coupling.

7. **Dust registration UX**: Can the extension automate the Dust registration via `chrome.scripting.executeScript` to Lace's page context (similar to Option C's proxy), or must it be a manual step?

8. **wallet-sdk-facade in service worker**: Need to verify that `WalletBuilder.buildFromSeed()` and `serializeState()`/`restore()` work in a Chrome MV3 service worker (no dynamic imports, no DOM dependencies). The SDK targets browser extensions but this should be validated early.

---

## Effort Estimates

### Option C (Lace Proxy)

| Phase | Scope | Estimate |
|-------|-------|----------|
| Phase 1 | InMemoryPrivateStateProvider + ZkConfigProvider | 2 points |
| Phase 2 | LaceWalletProxy + LaceMidnightProxy + WalletStateStore | 5 points |
| Phase 3 | Wire into MidnightContractService + remove `as any` | 1 point |
| Testing | E2E test on preprod with full write flow | 2 points |
| **Total** | | **~10 points** |

### Option E (In-Process Wallet)

| Phase | Scope | Estimate |
|-------|-------|----------|
| Phase 1 | InMemoryPrivateStateProvider + ZkConfigProvider | 2 points |
| Phase 2 | ExtensionWalletProvider (wallet-sdk-facade + serialize/restore) | 3 points |
| Phase 3 | Wire into MidnightContractService + remove `as any` | 1 point |
| Phase 4 | Dust registration onboarding UX | 2 points |
| Testing | E2E test on preprod with full write flow | 2 points |
| **Total** | | **~10 points** |

---

## References

**Browser DApp patterns (Lace wallet):**
- bboard-ui `BrowserDeployedBoardManager.ts`: Browser wallet provider pattern
- midnight-bank `BankWallet.tsx`: Browser wallet provider with Lace
- midnight-game-2 `wallet.ts`: Game wallet provider with Lace
- bboard-ui `in-memory-private-state-provider.ts`: In-memory private state

**CLI patterns (wallet-sdk-facade, no Lace):**
- midnames-cli `api.ts`: `WalletBuilder.buildFromSeed()` → full in-process wallet
- bboard-cli `index.ts`: `MidnightWalletProvider.build()` → wallet-sdk-facade with seed
- counter-cli: wallet-sdk-facade for wallet provider + midnight provider
- midnight-js testkit `fluent-wallet-builder.ts`: `WalletFactory` + `WalletSeeds` pattern

**Dust delegation (separate receiver address):**
- midnight-reserve-contracts `cnight_generate_dust.test.ts`: `DustMappingDatum` with separate `c_wallet` and `dust_address`
- midnight-cnight-to-dust-dapp `dustTransactionsUtils.ts`: Registration with custom `dust_address` (different from Night holder)
- midnight-cnight-to-dust-dapp `WalletContext.tsx`: Manual Dust address entry UI
- midnight-ledger `spec/cardano-system-transactions.md`: "produce DUST to an indicated DUST address on Midnight"
- midnight-architecture `WalletEngine/Specification.md`: `serializeState()`/`restore()` wallet lifecycle

**SDK references:**
- Midnight SDK README: Provider pattern documentation
- midnight-js testkit `providers.ts`: Full provider initialization
- DApp Connector API docs: `balanceUnsealedTransaction`, `submitTransaction`
- SDK v3.1.0 `PrivateStateProvider` interface: `setContractAddress` addition
- `@midnight-ntwrk/wallet-sdk-facade@1.0.0`: `WalletFacade` class, `balanceFinalizedTransaction`, `submitTransaction`
- `@midnight-ntwrk/wallet-sdk-hd@3.0.0`: `HDWallet.fromSeed()`, role-based key derivation

**Browser extension constraints:**
- Chrome MV3 docs: `chrome.scripting.executeScript`, offscreen documents
- Chrome MV3 service worker lifecycle: ~30 second idle timeout, no persistent connections
- WXT #392, Vite #3311, Vite #16429: Service worker limitations
- w3c/ServiceWorker#1356: Dynamic `import()` ban in extension service workers
