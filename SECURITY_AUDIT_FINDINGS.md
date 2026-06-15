# AliasVault — Security Audit Findings & Hardening Plan

**Date:** 2026-06-15
**Branch audited:** `2177-implement-browser-extension-passkey-passive-autofill` (working tree)
**Scope:** API/Admin server (C#), Blazor WebAssembly web client, browser extension (Chrome/Firefox/Edge/Safari), mobile apps (iOS Swift + Android Kotlin), shared crypto core (Rust/TS/C#), and deployment infra (nginx/install.sh).
**Method:** Six parallel component audits focused on common password-manager vulnerability classes, calibrated against the `SECURITY.md` threat model (Class 1 = crosses the encryption/access-control boundary; Class 2 = device-compromise / local hardening; Class 3 = low-impact/no exploit path).

---

## Executive summary

**The core zero-knowledge architecture holds.** No audit found a Class 1 vulnerability that lets an attacker decrypt another user's vault or bypass authentication under the project's threat model. The cryptographic primitives (AES-256-GCM with per-message CSPRNG IVs, RSA-OAEP-2048/SHA-256, SRP-6a over the RFC 5054 2048-bit group with constant-time proof comparison, Argon2id KDF), the SRP/JWT/refresh-token flows, the "Login with Mobile" QR flow, vault/email tenant scoping, and the WebAuthn passkey origin-binding model were all reviewed and found sound — several with genuine defense-in-depth.

The findings worth acting on cluster into a small number of **confirmed issues** and a larger set of **defense-in-depth hardening**. The two items closest to the security boundary are server-trust issues inherent to a zero-knowledge design:

| # | Severity | Class | Area | Finding |
|---|----------|-------|------|---------|
| C1 | **High** | 1 (SSRF) | API | Favicon fetch DNS-rebinding TOCTOU — validated IP ≠ connected IP |
| C2 | **High** | 2 | API | Spoofable `X-Forwarded-For` defeats registration blocklist + rate-limit |
| C3 | **Medium** | 1 | Web client | Server-supplied Argon2 params applied with no minimum-bound check |
| C4 | **Medium** | 1 | API | Attachment filename/MIME stored server-side in plaintext (ZK leak) |
| C5 | **Medium** | 2 | Admin | Admin password rotation does not invalidate existing sessions |
| C6 | **Medium** | 1 (clickjacking) | Extension | `ClickValidator` bypassable; row-level fills skip it entirely |
| C7 | **Medium** | 2 | Mobile | Auth tokens stored in plaintext prefs/UserDefaults (both platforms) |
| C8 | **Low** | 2 | Mobile (iOS) | PIN blob lacks crypto gate → offline brute-force bypasses attempt limit |

Everything else is Low/Info hardening, catalogued per component below.

---

## Priority 1 — Confirmed, fix first

### C1. [High · Class 1 SSRF] Favicon fetch DNS-rebinding TOCTOU
- **Component:** API → `Utilities/AliasVault.FaviconExtractor/FaviconExtractor.cs` (`IsValidUri` ~`:454-481`/`:465`; handler `:377`; request `:510`; redirects `FollowRedirectsAsync` ~`:489`). Reached from `AliasVault.Api/Controllers/FaviconController.cs:56,102`.
- **Problem:** `IsValidUri` resolves DNS and rejects private/loopback/link-local/CGNAT IPs, but the subsequent `HttpClient`/`HttpClientHandler` performs its **own independent** DNS resolution at connect time. The validated address is never the connected address. Redirect re-validation has the identical gap.
- **Impact:** An authenticated user submits a host with a low-TTL DNS record that resolves "public" during validation and `169.254.169.254` / `127.0.0.1` / `10.x` at connect time. Server issues the request to internal infrastructure (cloud metadata, internal services). Image re-encoding blunts body exfiltration, but reachability/latency forms an internal port-scan oracle. Per `SECURITY.md` §3.1.3 this is the Class 1 SSRF boundary.
- **Fix:** Replace `HttpClientHandler` with `SocketsHttpHandler` whose `ConnectCallback` resolves the host **once**, validates every returned `IPAddress` with `IPAddressValidator.IsPublicIPAddress`, and connects to that exact pinned IP (set TLS host = original hostname for SNI/cert). Apply the same pinned-connect when following redirects. This closes both the initial and redirect windows and makes the IPv6 NAT64/6to4 gap (H-API-2) moot.

### C2. [High · Class 2] Spoofable X-Forwarded-For defeats registration blocklist & rate-limit
- **Component:** `Utilities/AliasVault.Auth/IpAddress/IpAddressUtility.cs:83-91` (`ExtractRawIpString`); consumed at `AliasVault.Api/Controllers/AuthController.cs:442-452`; no `UseForwardedHeaders` in `AliasVault.Api/Program.cs`.
- **Problem:** `ExtractRawIpString` trusts the client-supplied `X-Forwarded-For` and takes the leftmost (attacker-controlled) entry with no trusted-proxy allowlist. This IP feeds the registration blocklist, the per-IP registration rate-limiter, and email shadow-block evaluation.
- **Impact:** `X-Forwarded-For: 203.0.113.<random>` on each `/v1/Auth/register` evades both the blocklist and the rate limiter (each forged IP anonymizes to a fresh `/24`, count stays ~0). Enables mass registration / blocklist & shadow-block evasion.
- **Fix:** Configure `ForwardedHeadersOptions` with explicit `KnownProxies`/`KnownNetworks`, call `UseForwardedHeaders`, and read `Connection.RemoteIpAddress`. Never take `Split(',')[0]` from an untrusted header; honor XFF only when the immediate peer is a trusted proxy. (nginx already renders `set_real_ip_from` from `TRUSTED_PROXIES` — mirror that trust boundary in the app.)

### C3. [Medium · Class 1] Server-supplied Argon2id parameters applied without minimum bounds
- **Component:** `Utilities/Cryptography/AliasVault.Cryptography.Client/Encryption.cs:53-90`; consumed in `AliasVault.Client/Services/Auth/AuthService.cs:308-319`.
- **Problem:** KDF parameters (`MemorySize`, `Iterations`, `DegreeOfParallelism`) and salt are taken verbatim from the server's `LoginInitiateResponse.EncryptionSettings` and passed straight into `new Argon2id(...)` with no floor check. In a zero-knowledge model the server is in the threat surface.
- **Impact:** A malicious/compromised server (or MITM substituting the `/v1/Auth/login` response) returns `{"Iterations":1,"MemorySize":8}` to a targeted victim. The client derives the key at near-zero work factor; the captured vault becomes cheaply crackable offline — a "KDF flaw weakening confidentiality" Class 1 boundary crossing.
- **Fix:** Enforce client-side minimum bounds before constructing Argon2 — reject/clamp anything below AliasVault defaults (`MemorySize >= 19456`, `Iterations >= 2`, sane parallelism) and refuse unknown `encryptionType`. Treat server KDF settings as untrusted.

### C4. [Medium · Class 1] Attachment filename & MIME type stored server-side in plaintext
- **Component:** `Utilities/Cryptography/AliasVault.Cryptography.Server/EmailEncryption.cs:50-54`; model `Databases/AliasServerDb/EmailAttachment.cs:30,35`; returned plaintext at `AliasVault.Api/Controllers/Email/EmailController.cs:69,139`.
- **Problem:** `EncryptEmail` encrypts every body field and the attachment **bytes**, but not `Filename`/`MimeType`. These are stored and returned in cleartext.
- **Impact:** Attachment filenames routinely carry sensitive content (`Invoice_JohnDoe_BankOfX.pdf`, `passport_scan_2026.jpg`). A server compromise or DB dump exposes this plaintext for every received email, contradicting the ZK guarantee even though bodies/bytes are protected.
- **Fix:** Encrypt `Filename` (and optionally `MimeType`) with the same per-email symmetric key in `EncryptEmail`; decrypt client-side, mirroring the body-field handling.

### C5. [Medium · Class 2] Admin password rotation does not invalidate existing sessions
- **Component:** `AliasVault.Admin/StartupTasks.cs:72-87`; stamp check in `Auth/Providers/RevalidatingAuthenticationStateProvider.cs:50-65`.
- **Problem:** Rotating `ADMIN_PASSWORD_HASH` overwrites `PasswordHash` and calls `UpdateAsync` but never regenerates the Identity `SecurityStamp`. Data-protection keys persist across restarts, so pre-existing admin cookies survive the rotation operators perform precisely to revoke access.
- **Impact:** An attacker holding a valid admin cookie remains authenticated after the operator resets the admin password and restarts to lock them out.
- **Fix:** `await userManager.UpdateSecurityStampAsync(adminUser)` (or set a new `SecurityStamp`) in the rotation branch before `UpdateAsync`.

### C6. [Medium · Class 1 clickjacking] Extension autofill click-validation is bypassable
- **Component:** `browser-extension/src/utils/security/ClickValidator.ts:52-132`; icon click `contentScript/Form.ts:303`; row/TOTP fills via `addReliableClickHandler` (`Form.ts`, `createTotpItem:623`) bypass `validateClick` entirely.
- **Problem:** The only anti-clickjacking defense checks `documentElement`/`body` computed `opacity < 0.9` and CSS `filter`. It ignores the AliasVault popup's own geometry/visibility, any ancestor wrapper between BODY and the popup, and cross-origin iframe overlays. Row-level fills don't route through it at all.
- **Impact:** A page wraps content in `<div style="opacity:0.01">` (BODY/HTML stay 1.0) or makes only the shadow host transparent, then lures a click onto the fill affordance — credential fills despite the "protection."
- **Fix:** At fill time validate the popup element's and all ancestors' computed `opacity`/`visibility`/`pointer-events`, confirm `document.elementFromPoint(clientX,clientY)` resolves into the shadow root, and require a recent genuine `focusin`/keyboard interaction with the target field. Route row-level fills through the same gate.

### C7. [Medium · Class 2] Mobile auth tokens stored in plaintext (both platforms)
- **Component:** iOS `ios/VaultStoreKit/Services/WebApiService.swift:105-122` (UserDefaults app-group); Android `android/.../webapi/WebApiService.kt:44,148-151` (`MODE_PRIVATE` SharedPreferences, not `EncryptedSharedPreferences`).
- **Problem:** Access + refresh tokens are written without crypto protection at rest, unlike the vault key (keychain/Keystore-wrapped + biometric).
- **Impact:** Class 2 — these are bearer tokens to a ZK server (they do **not** decrypt the vault) and reading them needs device compromise; cloud-backup vector is already mitigated (`isExcludedFromBackup` on iOS, `allowBackup=false` + data-extraction-rules on Android). Still, a rooted/forensically-imaged device yields API access as the user.
- **Fix:** Store tokens in Keychain (`kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly`) / Android Keystore-wrapped (`EncryptedSharedPreferences` or the existing `KEYSTORE_ALIAS_DATA_ENCRYPTION` pattern, `setUnlockedDeviceRequired(true)`).

### C8. [Low · Class 2] iOS PIN blob lacks crypto gate → offline brute-force bypasses attempt limit
- **Component:** `ios/VaultStoreKit/VaultStore+Pin.swift:190-219,266-307` (vs. correctly-protected Android `android/.../vaultstore/VaultPin.kt:300-353`).
- **Problem:** Both platforms wrap the vault key with Argon2id(PIN, 64 MB, t=3). **Android** additionally AES-GCM-encrypts the PIN blob + salt + attempt counter under a non-exportable Keystore key (`setUnlockedDeviceRequired(true)`) — an attacker can't even see the salt to brute-force. **iOS** stores the PIN blob, salt, and attempt counter in the Keychain with only `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` and **no `SecAccessControl`/biometric**; the 4-attempt lockout is pure Swift app logic.
- **Impact:** An attacker who reads the keychain item (jailbroken/forensic; the autofill extension shares the access group) gets salt+ciphertext and brute-forces a 4–6-digit PIN offline (~100–200 ms/guess → minutes–hours), bypassing the software attempt limit. Class 2 (needs device compromise).
- **Fix:** Wrap the iOS PIN blob with a `SecAccessControl` (`.devicePasscode`/Secure Enclave key) so salt+ciphertext can't be read for offline attack, and enforce the attempt limit cryptographically — mirroring the Android Keystore approach.

---

## Priority 2 — Hardening by component

### API / Server (C#)
- **H-API-1 [Low·1] Email-delete reflects `ex.Message` to client** — `Email/EmailController.cs:107` returns `$"...: {ex.Message}"` (only such path in the API). Return a generic message; log server-side only.
- **H-API-2 [Low·3] SSRF IP validator misses IPv6 NAT64/6to4** — `FaviconExtractor/IPAddressValidator.cs:42-46,120-140` lacks `64:ff9b::/96` and `2002::/16`. Add them (moot once C1's pinned-connect lands).
- **H-API-3 [Low·3] Blind-SSRF timing oracle** — `FaviconExtractor.cs:387` connect-vs-timeout latency is observable. Normalize timing/returns; tighten timeout+redirect+retry budget after C1.
- **H-API-4 [Low·3] Default DB password committed** — `AliasVault.Api/appsettings.json` ships `Password=password`. Prod uses `SecretReader` (no JWT fallback — good), but use a placeholder to avoid accidental shipping.
- **H-API-5 [Low·3] `IncludeErrorDetails = true` on JWT bearer** — `Program.cs:126` leaks token-validation failure reasons in `WWW-Authenticate`. Disable in production.
- **H-API-6 [Low·3] AES-GCM decrypt trims trailing NULs** — `Cryptography.Server/Encryption.cs:112` `TrimEnd('\0')` is unnecessary (GCM unpadded) and corrupts plaintext ending in NUL. Remove.
- **H-API-7 [Low·2] No role enforcement on Admin** — `Admin/Main/Pages/MainBase.cs:25` uses auth-only `[Authorize]`; the `Admin` role is never required. Enforce `[Authorize(Roles="Admin")]` or remove the unused scaffolding.
- **H-API-8 [Low·3] Shadow-block epoch fallback is implicit** — `IpBlockListService.cs:58` hides all email when `ShadowBlockedAt` is null. Always set the timestamp; document the epoch fallback.

> **Verified clean (assurance):** SQL injection (only `FromSqlRaw` at `EmailBoxController.cs:176` is fully parameterized), SRP (cached ephemeral, constant-time proofs, no salt reuse), user enumeration (deterministic fake salt/verifier + matching response shape on login), JWT (HS256 pinned, issuer/audience/lifetime validated, `ClockSkew=0`, no key fallback), refresh tokens (32-byte CSPRNG, single-use, 30 s reuse window, device-scoped), mobile-login QR flow (RSA-wrapped symmetric key, one-time-use, 10-min expiry), vault IDOR (all reads/writes scoped to `user.Id`, monotonic revision), email scoping (`UserEmailClaim` + RSA-to-recipient encryption before insert), XXE/deserialization/path-traversal/open-redirect (none present), secret logging (none; IPs anonymized).

### Web client (Blazor WASM)
- **H-WEB-1 [Low·4] CSP provides no XSS mitigation** — nginx sets only `Content-Security-Policy "frame-ancestors 'self'"` (`nginx-443.conf:85`, `nginx-80-443.conf:66`); no `default-src`/`script-src`/`connect-src`/`object-src`/`base-uri`. Any future injection sink runs unimpeded with no exfil restriction on `localStorage` tokens. Add e.g. `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'self'; connect-src 'self' <api-origin>; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'`.
- **H-WEB-2 [Low·1] Encryption key not zeroized; no inactivity auto-lock** — `AuthService.cs:43,371-374` `RemoveEncryptionKey` rebinds rather than `Array.Clear`-ing; only manual lock/logout drop the key (no idle timer). Zero the buffer; add a configurable inactivity auto-lock that clears the key + in-memory DB and routes to `/unlock`; consider lock on `visibilitychange`.
- **H-WEB-3 [Low·5] Email sanitizer permits remote content; iframe sandbox allows popup escape** — `ConversionUtility.cs:48,66,89` allows `img src`/inline `style` to remote origins (tracking pixels, CSS exfil of read-receipt/IP/UA); `EmailModal.razor:144`/`EmailPreview.razor:77` use `sandbox="allow-popups allow-popups-to-escape-sandbox"`. Block remote content behind an explicit "load remote images" toggle; drop `allow-popups-to-escape-sandbox`.
- **H-WEB-4 [Info·3] Logo bytes can render as `data:image/svg+xml`** — `LogoConverter.cs:23-47` via `<img>` (no script execution today). Watch if ever moved to `<object>`/`srcdoc`/CSS; restrict sniffed type to raster, or rely on the new CSP.

> **Verified clean:** AES-GCM (fresh 12-byte IV per op, GCM tag enforced), RSA-OAEP-2048/SHA-256, SRP (RFC 5054 2048-bit, `A/B mod N != 0`, constant-time M1/M2), credential URL rendering (`javascript:`/`data:` gated by `http(s)://` prefix), all `MarkupString` sinks (developer/static content only), in-memory-only decrypted SQLite vault (no plaintext key/vault in localStorage/IndexedDB), WebAuthn-PRF unlock (32-byte CSPRNG salt, key stored only AES-GCM-wrapped), email iframe omits `allow-scripts`.

### Browser extension
- **H-EXT-1 [Low·1] Site-disable list matched by exact hostname** — `content.ts:670-685` / `LocalPreferencesService.ts:143-146`: disabling `example.com` leaves `login.example.com` unprotected. Match the registrable domain (reuse `RustCore.extractRootDomain`) or offer "disable whole domain."
- **H-EXT-2 [Low·9] Save-prompt duplicate matcher uses bidirectional suffix match** — `background/VaultMessageHandler.ts:1537` `normalizedDomain.endsWith(itemDomain)` makes `co.uk` "match" `evil.co.uk` (affects save-prompt suppression only, not autofill candidate selection). Route through the Rust matcher; drop the reverse direction.
- **H-EXT-3 [Low·5] `web_accessible_resources` enable presence fingerprinting** — `wxt.config.ts:69-77` exposes `webauthn.js`+wasm to `<all_urls>`; injected script also sets `window.__aliasVault*` markers. Inherent to passkey interception; consider Chrome `use_dynamic_url` and dropping global markers.
- **H-EXT-4 [Low·1] Fills proceed into hidden/off-screen fields** — `contentScript/Form.ts:99-119`: `isFieldVisible` only governs icon teardown, not the fill. Skip visually-hidden/0-area/off-viewport targets at fill time.
- **H-EXT-5 [Low·2] Keyboard-command fill re-resolves target by `id`/`name`** — `Form.ts:244-245` + `content.ts:613-635` round-trip through a string identifier (DOM-clobbering soft target; mitigated by `validateInputField`). Fill against the actually-focused element instead.

> **Verified clean:** No `externally_connectable`/`onMessageExternal`/background `window` message listener (web pages can't invoke vault APIs); WebAuthn origin re-derived from trusted `sender` and `rpId` validated via registrable-suffix check; autofill keyed off browser-supplied frame URL (cross-origin iframe only gets its own origin's creds); content-script `innerHTML` sinks use static templates or `escapeHtml`; encryption key in `chrome.storage.session` (in-memory) with only the encrypted blob in `local:`; extension-pages CSP = `script-src 'self' 'wasm-unsafe-eval'` (no `unsafe-eval`/remote).

### Passkeys / WebAuthn (cross-platform)
- **H-PK-1 [Low·3] UV flag asserted without an independent verification signal** — ext `PasskeyAuthenticator.ts:206-211` (caller `PasskeyAssertionService.ts:143` hardcodes `uvPerformed:true`); also `PasskeyAuthenticator.swift:199-204`, `.kt:208-213`. On the extension the UV bit reflects "vault unlocked," not "user verified for this signing op" (a single row click can produce a UV-set assertion). Drive `uvPerformed` from an actual verification gesture, or set UP-only and leave UV clear when none occurred. (Mobile is honest — gated behind OS biometric unlock.)
- **H-PK-2 [Low·3] PRF (hmac-secret) released under UP-only on conditional assertions** — `PasskeyAssertionService.ts:142-157`, `PasskeyAuthenticator.ts:258-270`. PRF underlies RP-side encryption keys and should be released only after user verification; here it's click-gated. Secret derivation is correct and never sent to the RP — only the gating is loose. Tie PRF release to the UV fix (H-PK-1).
- **H-PK-3 [Low·3] Android clientDataJSON built via unescaped string interpolation** — `PasskeyFormFragment.kt:896-898`, `PasskeyAuthenticationActivity.kt:293-294`. Currently safe (inputs are sanitized origin/base64url), but fragile vs. iOS/TS structured serializers. Use `JSONObject().put(...)`.
- **H-PK-4 [Info·3] `getPublicKeyAlgorithm()` hardcoded to ES256** — `webauthn.ts:236-246` returns `-7` even for RS256 registrations (COSE key itself is correct, so attestation parsing is unaffected). Return the actual algorithm.

> **Verified clean (assurance):** The two highest-risk WebAuthn properties are correct with defense-in-depth — (1) RP ID validated against the **browser-trusted** caller origin in both content script and background (page-supplied origin discarded), registrable-suffix `rpId` check, final `passkey.RpId == request.rpId ?? hostname` bind; (2) **no silent assertion** — conditional requests are parked, released only by an explicit click handler; hidden/prefetch tabs skipped; cross-origin iframes forced to native fallback. Challenge reflected verbatim (never substituted); signCount always 0; ECDSA raw→DER correct (round-trip tested); private keys never leave the vault; attestation (none/packed self) built correctly; allowCredentials filtered by GUID after rpId scoping; iOS/Android use real OS-mediated biometric gates.

### Mobile apps (iOS + Android)
- **H-MOB-1 [Low·2] Android trusts user-installed CAs + global cleartext, no pinning** — `res/xml/network_security_config.xml` (`base-config cleartextTrafficPermitted="true"`, `<certificates src="user"/>`), `AndroidManifest.xml:15` `usesCleartextTraffic="true"`, `WebApiService.kt:257` no pinning. Drop `src="user"` from base-config; scope cleartext to a debug/localhost `domain-config`; pin the default `app.aliasvault.net`. (iOS ATS is correctly configured.)
- **H-MOB-2 [Low·2] KDF params/metadata stored unencrypted** — iOS `VaultStore+Crypto.swift:97-104` (UserDefaults), Android `AndroidStorageProvider.kt` (`key_derivation_params`, `metadata`, `username`). Salt isn't secret, but exposing it + params lowers offline-attack cost if the DB is also exfiltrated. Move to encrypted storage.
- **H-MOB-3 [Low/Info·2] Android password autofill trusts app-supplied `webDomain`/package (no DAL for password path)** — `autofill/utils/FieldFinder.kt:67-88`, `AutofillService.kt:158-162`. This is the inherent Android Autofill trust model (matching itself is boundary-safe via the Rust `domains_match` with `.ends_with(".domain")` checks; no silent fill). Extend the existing `OriginVerifier` (real assetlinks.json + signing-cert verification, already used for passkeys) to the password path and surface the resolved target app/domain in the picker row (`AutofillDatasetBuilder.kt:49-54`).
- **H-MOB-4 [Low·2] No screenshot/app-switcher redaction** — no `FLAG_SECURE` on Android unlock/autofill activities; no iOS background-snapshot cover. Add `FLAG_SECURE` to unlock/vault activities and an iOS `sceneDidEnterBackground` cover view.
- **H-MOB-5 [Info·2] In-memory key not zeroed; no Android StrongBox; iOS clipboard `localOnly` caller-controlled** — null-not-zero on GC (both); add `setIsStrongBoxBacked` where available; confirm the JS layer always passes `localOnly` for password copies (`VaultManager.swift:419-453`) to prevent universal-clipboard sync.
- **H-MOB-6 [Info·3] `aliasvault://` custom scheme hijackable; duplicate manifest scheme entry** — another app can register the same non-universal scheme; `AndroidManifest.xml:103,105` duplicates `net.aliasvault.app` (cosmetic). Prefer App Links / verified deep links for sensitive flows.

> **Verified clean:** Encryption-key gate is genuinely cryptographic on both platforms (iOS Keychain `WhenPasscodeSetThisDeviceOnly` + `.biometryCurrentSet` + `LAContext` via Secure Enclave; Android Keystore AES-GCM with `setUserAuthenticationRequired` + `setInvalidatedByBiometricEnrollment` + per-op `BiometricPrompt.CryptoObject`); iOS rejects `provideCredentialWithoutUserInteraction` (no silent QuickType fill) and uses per-URL identities; Android passkey `OriginVerifier` does real assetlinks.json + cert-fingerprint verification; no secrets logged; clipboard auto-clears with sensitive flags; no WebView/`addJavascriptInterface`; exported components limited to system-permission-protected autofill/credential services + launcher; production `__debug__` deep links gated behind `!__DEV__`.

### Deployment / infrastructure
- **H-INF-1 [Low·3] No HSTS header** — `nginx-443.conf` sets Referrer-Policy/X-Content-Type/X-Frame-Options/CORP/CSP but no `Strict-Transport-Security`. Add `Strict-Transport-Security "max-age=63072000; includeSubDomains"` (consider preload) on the 443 server block. Relevant for a password manager to prevent SSL-strip on the login origin.
- **H-INF-2 [Info·3] CORS `AllowAnyOrigin`** — `Program.cs:150` `AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader()`. Acceptable because the API is JWT-bearer (no cookies, no `AllowCredentials`, so no ambient-credential leakage) and must serve extension/app origins — documented as intentional; revisit if cookie auth is ever introduced.
- **Verified good:** JWT key `openssl rand -base64 32` (256-bit), secrets written to `chmod 600` files under `chmod 700 secrets/`, admin IP allowlist with an indistinguishable client-app fallback (no `/admin` existence oracle), gzip excludes nothing sensitive, ACME challenge path scoped.

---

## Suggested remediation order

1. **C1** (SSRF pinned-connect) and **C2** (XFF trust) — server-side, clear exploit paths, ship together.
2. **C3** (Argon2 minimum bounds) and **C4** (encrypt attachment filenames) — close the two zero-knowledge-boundary gaps.
3. **C5** (admin SecurityStamp on rotation), **C6** (extension clickjacking gate), **C7** (mobile token storage).
4. **C8** + the Class 2 mobile hardening (H-MOB-1, H-MOB-4), then **H-WEB-1/2/3** (CSP, auto-lock, email remote content) and **H-INF-1** (HSTS).
5. WebAuthn honesty items (**H-PK-1/2/3**) and the remaining Low/Info backlog.

## Notes on classification
Severities follow `SECURITY.md`: only C1/C3/C4 cross (or threaten) the encryption/access-control boundary without device compromise and are Class 1; C2/C5/C7/C8 and most mobile items are Class 2 (require spoofable-infra or device compromise) — defense-in-depth, not CVE-track per the project's own model, but still worth fixing. Several sub-audit severities were calibrated **down** after reading the code (mobile token "Class 1" → 2; PIN "critical" → Low/Class 2; Android autofill "critical" → Low/Info) because the underlying matchers and key gates proved sound.
