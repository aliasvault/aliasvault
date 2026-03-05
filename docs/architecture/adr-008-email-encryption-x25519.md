# ADR-008: X25519 Hybrid Encryption for Alias Email

**Status:** Accepted
**Date:** 2026-03-04
**Decision Makers:** Architect (Winston), Ozi3o
**Supersedes:** Architecture Section 5 "Encryption Strategy" (RSA-OAEP assumption)

---

## Context

Epic 5 (Alias Email System) requires the SMTP bridge to encrypt incoming emails so that only the alias owner can read them. The original architecture (Section 5) assumed RSA-OAEP asymmetric encryption with public keys stored on-chain via a `VaultRegistry.getPublicKey()` witness.

**Problem discovered during Implementation Readiness Review (2026-03-04):**

1. **No public key infrastructure exists.** Epics 1-4 built a purely symmetric system (Argon2id + AES-256-GCM). No RSA keypairs, no on-chain public key storage.
2. **`VaultRegistry.getPublicKey()` is listed as PLANNED** in the contract header but has no state variable, no witness, and no implementation path.
3. **RSA public keys are 256+ bytes** (2048-bit minimum), requiring `Opaque<'Uint8Array'>` storage on-chain — opaque, large, and expensive in gas.
4. **RSA provides no forward secrecy** — compromising the private key exposes all past emails.

### Midnight SDK Research (via MCP)

Reference contracts (welcome.compact, bboard.compact, midnames.compact, proofshare) all use a consistent pattern for on-chain public keys:

```compact
export circuit public_key(sk: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<2, Bytes<32>>>([pad(32, "domain:pk:"), sk]);
}
```

This derives a 32-byte hash-based public key — suitable for ownership verification but NOT for encryption. Actual encryption must happen off-chain in TypeScript, with only the key hash/commitment stored on-chain.

---

## Decision

**Use X25519 (Curve25519 ECDH) + AES-256-GCM hybrid encryption** for email encryption in the SMTP bridge.

### Key Infrastructure

| Component | Detail |
|-----------|--------|
| **Key type** | X25519 (Curve25519 Diffie-Hellman) |
| **Public key size** | 32 bytes — fits in Compact `Bytes<32>` natively |
| **Private key storage** | Inside encrypted vault blob (VaultJson) — never on-chain |
| **Public key storage** | On-chain in VaultRegistry as `Bytes<32>` ledger variable |
| **Key generation** | Client-side (browser extension) during vault creation |
| **Library** | `tweetnacl` (browser) / Node.js `crypto` (bridge) |

### Encryption Flow (Bridge → User)

```
1. Bridge receives email for alias@alias.id
2. Bridge queries AliasRegistry.getOwner() → owner wallet
3. Bridge reads owner's X25519 public key from VaultRegistry ledger
4. Bridge generates ephemeral X25519 keypair
5. Bridge derives shared secret: ECDH(ephemeral_private, recipient_public)
6. Bridge encrypts email JSON with AES-256-GCM using shared secret
7. Bridge packages: [ephemeral_public_key (32B) | nonce (24B) | ciphertext]
8. Bridge uploads encrypted blob to IPFS
9. Ephemeral private key is discarded (forward secrecy)
```

### Decryption Flow (User)

```
1. Extension downloads encrypted blob from IPFS
2. Extract ephemeral public key (first 32 bytes)
3. Derive shared secret: ECDH(user_private, ephemeral_public)
4. Decrypt email JSON with AES-256-GCM
```

---

## Alternatives Considered

### Option 1: RSA-OAEP (REJECTED)

**Pros:**
- Simpler mental model ("encrypt with public key")
- Built into every runtime, no libraries needed
- Familiar from PGP/S/MIME

**Cons:**
- ❌ 256+ byte public keys → `Opaque<'Uint8Array'>` on-chain (large, opaque)
- ❌ No forward secrecy — compromised private key exposes ALL past emails
- ❌ Slower key generation (~200ms vs ~1ms)
- ❌ Key rotation is heavier (regenerate 2048-bit pair vs 32 bytes)

### Option 2: X25519 + AES-256-GCM (ACCEPTED)

**Pros:**
- ✅ 32-byte public key → `Bytes<32>` on-chain (native Compact type)
- ✅ Forward secrecy per email (ephemeral keys)
- ✅ ~100x faster key operations
- ✅ Minimal on-chain storage cost
- ✅ Aligns with modern crypto (Signal, WireGuard, TLS 1.3)
- ✅ `tweetnacl` is zero-dependency, 4KB, audited

**Cons:**
- DH pattern slightly less intuitive than RSA's direct encryption
- Adds `tweetnacl` dependency (mitigated: tiny, audited, well-maintained)

### Option 3: No Asymmetric Encryption — Bridge Encrypts with Shared Key (REJECTED)

**Pros:**
- Simplest implementation

**Cons:**
- ❌ Bridge sees plaintext emails — violates zero-knowledge principle
- ❌ Compromised bridge exposes all user emails
- ❌ Contradicts PRD privacy requirements (NFR12)

---

## Consequences

### Positive

- Forward secrecy: each email encrypted with unique ephemeral key
- Compact on-chain footprint: single `Bytes<32>` per user
- Consistent with existing Midnight patterns (`persistentHash`-based keys)
- Zero-knowledge maintained: bridge never sees plaintext after encryption

### Negative

- New dependency: `tweetnacl` (or `libsodium-wrappers`) in browser extension and SMTP bridge
- New story required: keypair generation + on-chain public key storage (Story 5.0)
- VaultRegistry contract needs new state variable + circuit for public key storage

### Migration Impact

- **VaultRegistry contract:** Add `emailPublicKey: Bytes<32>` ledger variable + `setEmailPublicKey()` circuit + witness to read it
- **VaultJson format:** Add `emailKeyPair: { publicKey: string, privateKey: string }` to vault settings
- **Existing vaults:** Will need to generate keypair on first access after upgrade (lazy migration)

---

## Implementation Notes

### Contract Changes (Story 5.0)

```compact
// New ledger variable
export ledger emailPublicKey: Bytes<32>;

// Owner-only: store X25519 public key
export circuit setEmailPublicKey(pubKey: Bytes<32>): [] {
  const key = disclose(pubKey);
  const sk = local_secret_key();
  assert(owner == ownerCommitment(sk), "Not the vault owner");
  emailPublicKey = key;
}
```

### TypeScript Key Generation

```typescript
import nacl from 'tweetnacl';

// Generate keypair during vault creation
const keyPair = nacl.box.keyPair();
// keyPair.publicKey → 32 bytes → store on-chain
// keyPair.secretKey → 32 bytes → store in vault blob
```

### Bridge Encryption

```typescript
import nacl from 'tweetnacl';

function encryptEmail(emailJson: string, recipientPublicKey: Uint8Array): Uint8Array {
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);
  const messageBytes = new TextEncoder().encode(emailJson);
  const encrypted = nacl.box(messageBytes, nonce, recipientPublicKey, ephemeral.secretKey);
  // Package: [ephemeralPubKey(32) | nonce(24) | ciphertext]
  const result = new Uint8Array(32 + 24 + encrypted.length);
  result.set(ephemeral.publicKey, 0);
  result.set(nonce, 32);
  result.set(encrypted, 56);
  return result;
}
```

---

## Related Documents

- [Architecture Section 5](_bmad-output/architecture.md) — SMTP Bridge (encryption strategy superseded by this ADR)
- [ADR-001](adr-001-smtp-infrastructure.md) — SMTP Infrastructure (Mox + Express decision stands; line 101 RSA-OAEP note superseded)
- [ADR-006](_bmad-output/architecture.md) — MVP Simplifications (no Midnight private state for keys)
- [Implementation Readiness Report](_bmad-output/project-planning-artifacts/implementation-readiness-report-2026-03-04.md) — C1 finding
