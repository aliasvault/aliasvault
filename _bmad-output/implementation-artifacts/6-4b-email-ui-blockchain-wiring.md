# Story 6.4b: Email UI Blockchain Wiring

Status: ready-for-dev

<!-- Removes server-dependent email paths. Routes to existing blockchain InboxList + builds missing InboxDetail. -->

## Story

As a **user on preprod (no centralized server)**,
I want **the email experience to use the blockchain-based inbox (IPFS + VaultRegistry manifest) exclusively**,
so that **I can view and manage my emails without any server dependency**.

## Acceptance Criteria

1. Email list view routes to `InboxList.tsx` (blockchain-native, already implemented) — `EmailsList.tsx` is removed or deprecated
2. Email detail view uses a new `InboxDetail.tsx` that loads the full decrypted email from IPFS cache or re-fetches from IPFS by CID — `EmailDetails.tsx` is removed or deprecated
3. Attachments render from the embedded `base64` field in the decrypted email blob — no server download endpoint
4. Email deletion removes the email from local `EmailCacheService` (soft delete) — no server `DELETE` call
5. `EmailPreview.tsx` private-domain path uses `InboxService` instead of `webApi.authFetch('EmailBox/{email}')` — or is removed if inbox page subsumes it
6. No `webApi` calls remain in any email-related component
7. All email-related tests pass, extension builds for preprod

## Tasks / Subtasks

- [ ] Task 1: Audit current email routing and switch list view (AC: #1)
  - [ ] 1.1 Find the route definition in `App.tsx` that maps to email pages — determine whether `/emails` routes to `EmailsList.tsx` or `InboxList.tsx`
  - [ ] 1.2 If `/emails` → `EmailsList.tsx`: reroute to `InboxList.tsx`
  - [ ] 1.3 If both coexist at different routes (e.g., `/emails` vs `/inbox`): unify to a single blockchain route
  - [ ] 1.4 Remove or deprecate `EmailsList.tsx` — do NOT delete if other components import from it; mark dead code

- [ ] Task 2: Create InboxDetail.tsx for blockchain email detail (AC: #2)
  - [ ] 2.1 Route: `/inbox/:cid` (CID string replaces numeric ID from server path)
  - [ ] 2.2 Load email: first check `EmailCacheService` for cached full body; if body not cached, re-fetch from IPFS via `InboxService.fetchAndDecryptEmail(pinata, cid, privateKey)`
  - [ ] 2.3 Render: subject, from (parse into display name + address), to, date (format `receivedAt` unix timestamp), body (plaintext — no HTML rendering needed for blockchain emails)
  - [ ] 2.4 Cache the full decrypted email body after first fetch to avoid redundant IPFS downloads

- [ ] Task 3: Handle attachments from embedded base64 (AC: #3)
  - [ ] 3.1 Blockchain emails embed attachments as `{ name: string, contentType: string, base64: string }[]` inside the decrypted email JSON
  - [ ] 3.2 Render attachment list with download button
  - [ ] 3.3 On download: `atob(attachment.base64)` → create Blob → trigger browser download
  - [ ] 3.4 No separate IPFS fetch needed — attachments travel with the email blob

- [ ] Task 4: Email deletion via cache (AC: #4)
  - [ ] 4.1 In InboxDetail, "Delete" button calls `EmailCacheService.deleteEmail(cid)` — removes from local cache index
  - [ ] 4.2 Email remains on IPFS (immutable) but disappears from the user's inbox view
  - [ ] 4.3 Navigate back to inbox list after deletion

- [ ] Task 5: Fix EmailPreview.tsx private-domain path (AC: #5)
  - [ ] 5.1 Read `EmailPreview.tsx` — the private-domain path calls `webApi.authFetch('EmailBox/{email}')`
  - [ ] 5.2 Option A: Replace with InboxService call to show recent emails for that alias
  - [ ] 5.3 Option B: Remove the server-fetched preview entirely — let users check the full inbox page
  - [ ] 5.4 The SpamOK public-domain path (external API, not our server) can stay — it's a third-party service, not our centralized server

- [ ] Task 6: Remove server-dependent email code and verify (AC: #6, #7)
  - [ ] 6.1 Deprecate or remove `EmailsList.tsx` and `EmailDetails.tsx`
  - [ ] 6.2 Search for any remaining `webApi` imports in `/pages/emails/`, `/services/Inbox*`, `/services/Email*`
  - [ ] 6.3 Run email-related tests
  - [ ] 6.4 Build with `VITE_MIDNIGHT_NETWORK=preprod`

## Dev Notes

### Dual-Path Architecture (Current State)

Two separate email implementations exist side by side:

| Component | Path | Type Shapes | Status |
|-----------|------|------------|--------|
| `EmailsList.tsx` | Server (`webApi.post('EmailBox/bulk')`) | `MailboxEmail` (server types) | LEGACY — remove |
| `EmailDetails.tsx` | Server (`webApi.get('Email/{id}')`) | `Email` (server types) | LEGACY — remove |
| `InboxList.tsx` | Blockchain (InboxService + IPFS) | `CachedEmail` / `DecryptedEmailWithCid` | KEEP — already works |
| InboxDetail (missing) | Blockchain | `DecryptedEmail` + `CachedEmail` | BUILD — new component |

### Type Shape Differences (Critical)

The server and blockchain paths use **incompatible types**. Do NOT try to adapt one to the other — use the blockchain types natively.

| Aspect | Server (`MailboxEmail`) | Blockchain (`CachedEmail` / `DecryptedEmail`) |
|--------|------------------------|-----------------------------------------------|
| ID | `id: number` | `cid: string` (IPFS CID) |
| Sender | Decomposed: `fromDisplay`, `fromDomain`, `fromLocal` | Combined: `from: string` (full address) |
| Date | `dateSystem: string` (ISO) + `secondsAgo: number` | `receivedAt: number` (unix seconds) |
| Body | `messageHtml` + `messagePlain` (separate) | `body: string` (plaintext only) |
| Preview | `messagePreview` (server-truncated) | `bodyPreview` (cached, substring 0-100) |
| Attachments | Separate metadata with server download endpoint | Embedded `{ name, contentType, base64 }[]` in blob |
| Encryption | RSA + AES-GCM envelope (JWK keys) | X25519 box.open (nacl) |

### Blockchain Email Decryption (Already Implemented)

`EmailDecryptionService.ts` handles the full pipeline:
```
IPFS blob → [32B ephemeralPubKey | 24B nonce | ciphertext]
         → nacl.box.open(ciphertext, nonce, ephemeralPubKey, userPrivateKey)
         → JSON.parse → DecryptedEmail { from, to, subject, body, attachments[], receivedAt }
```

### InboxService Functions (Already Implemented)

| Function | Location | What It Does |
|----------|----------|-------------|
| `fetchManifest(pinata, manifestCid)` | InboxService.ts:34 | Downloads manifest from IPFS, returns `{ version, emails: [{cid, ts}] }` |
| `getNewEmailCids(manifest, cachedCids)` | InboxService.ts:54 | Filters manifest for new (uncached) email CIDs |
| `fetchAndDecryptEmail(pinata, cid, privateKey)` | InboxService.ts:64 | Downloads + decrypts single email from IPFS |
| `readInboxManifestCid()` | InboxService.ts:96 | Reads manifest CID from VaultRegistry via indexer |
| `readEmailCount()` | InboxService.ts:103 | Reads email count from VaultRegistry |

### Email Cache (Already Implemented)

`EmailCacheService.ts` provides local caching:
```
emailCache:{cid} → CachedEmail { cid, from, to, subject, bodyPreview, receivedAt, isRead, cachedAt }
emailCacheIndex → string[] of all cached CIDs
emailManifestCache → { manifestCid, emailCids[], lastChecked }
```

**Gap:** Cache stores metadata only (`bodyPreview` = first 100 chars). Full body requires re-fetch from IPFS or expanding the cache to store full `DecryptedEmail`.

### Email Alarm + Badge (Already Blockchain)

`EmailAlarmHandler.ts` polls `readEmailCount()` from the contract every 3 minutes and shows a badge. This is already fully blockchain — no changes needed.

### Sender Parsing Helper (Needed)

Blockchain emails have a combined `from` field (e.g., `"John Doe <john@example.com>"`). Need a parser:
```typescript
function parseSender(from: string): { display: string; address: string } {
  const match = from.match(/^(.+?)\s*<(.+?)>$/);
  return match
    ? { display: match[1].trim(), address: match[2] }
    : { display: from, address: from };
}
```

### Key Files

| File | Action |
|------|--------|
| `apps/browser-extension/src/entrypoints/popup/pages/emails/InboxList.tsx` | READ — existing blockchain list, already works |
| `apps/browser-extension/src/entrypoints/popup/pages/emails/EmailsList.tsx` | DEPRECATE — server-dependent |
| `apps/browser-extension/src/entrypoints/popup/pages/emails/EmailDetails.tsx` | DEPRECATE — server-dependent |
| NEW: `apps/browser-extension/src/entrypoints/popup/pages/emails/InboxDetail.tsx` | CREATE — blockchain email detail view |
| `apps/browser-extension/src/services/InboxService.ts` | READ — blockchain email service |
| `apps/browser-extension/src/services/EmailCacheService.ts` | READ/MODIFY — may need to cache full body |
| `apps/browser-extension/src/services/EmailDecryptionService.ts` | READ — X25519 decryption |
| `apps/browser-extension/src/entrypoints/popup/components/EmailPreview.tsx` | MODIFY — remove webApi path |
| `apps/browser-extension/src/entrypoints/popup/App.tsx` | MODIFY — update routes |
| `apps/browser-extension/src/hooks/useEmailSubscription.ts` | READ — already blockchain, no changes |
| `apps/browser-extension/src/entrypoints/background/EmailAlarmHandler.ts` | READ — already blockchain, no changes |

### What NOT To Do

- Do NOT try to make `EmailsList.tsx` work with blockchain data — it's built around server types. Use `InboxList.tsx` which already works.
- Do NOT create adapter types to make blockchain emails look like server emails — use native blockchain types.
- Do NOT implement manifest-level deletion (on-chain update) — soft delete from cache is sufficient for MVP.
- Do NOT modify `EmailDecryptionService.ts` or `InboxService.ts` — they're working correctly.

### References

- [Source: Architect audit — B3: Email operations completely centralized on server]
- [Source: InboxList.tsx — existing blockchain email list implementation]
- [Source: InboxService.ts — blockchain email fetching + decryption]
- [Source: EmailCacheService.ts — local email cache with CID keys]
- [Source: Story 5.7 — Email viewing in vault]

## Dev Agent Record

### Agent Model Used
### Debug Log References
### Completion Notes List
### File List
