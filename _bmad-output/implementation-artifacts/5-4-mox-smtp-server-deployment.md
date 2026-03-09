# Story 5.4: Mox SMTP Server Deployment

Status: done

## Story

As a DevOps engineer,
I want Mox configured to forward emails to the bridge with a webhook adapter that transforms Mox's native payload format,
so that `@alias.id` emails are received via SMTP, transformed, and processed by the bridge pipeline.

## Acceptance Criteria

1. Mox Docker container deployable via `docker compose` from `services/mox/`
2. `mox.conf` configures SMTP listener on ports 25/587, TLS via ACME (Let's Encrypt), admin interface on localhost-only
3. `domains.conf` configures `alias.id` domain with `IncomingWebhook` pointing to bridge
4. Mox's `IncomingWebhook` sends to bridge with `Authorization: Bearer ${BRIDGE_WEBHOOK_SECRET}`
5. Bridge receives Mox-native webhook payload and transforms to internal `IncomingEmail` format via new `/mox-webhook` route
6. Mox webhook adapter maps: `From[0].Address` → `from`, `To[0].Address` → `to`, `Subject` → `subject`, `Text` (or `HTML` fallback) → `body`
7. Attachments: if `Structure.Parts` contains non-text parts, fetch via Mox webapi `MessagePartGet(MsgID, PartPath)` and convert to `{ name, contentType, base64 }` format
8. Docker Compose file wires `mox` and `smtp-bridge` services with shared network
9. DNS records documented: MX, SPF, DKIM, DMARC for `alias.id` domain
10. TLS certificate provisioned via ACME (Let's Encrypt) for SMTP STARTTLS
11. E2E test script: send email via SMTP to `test@alias.id`, verify webhook received and adapter transforms correctly
12. Health check: Mox container exposes port 25 liveness check
13. `.env.example` documents all required environment variables for both Mox and bridge

## Tasks / Subtasks

- [x] Task 1: Mox configuration files (AC: #2, #3, #4)
  - [x] 1.1 Create `services/mox/` directory structure
  - [x] 1.2 Create `services/mox/mox.conf` — SMTP listener (ports 25/587), TLS ACME config, admin on localhost:8080, IMAP/IMAPS disabled (security: prevent plaintext email access bypassing bridge), hostname setting
  - [x] 1.3 Create `services/mox/domains.conf.template` — `alias.id` domain, `aliasvault` account with `IncomingWebhook` (URL + Authorization), catch-all Destinations. Uses `${BRIDGE_WEBHOOK_SECRET}` placeholder (see Task 3 entrypoint for `sed` substitution)
  - [x] 1.4 Create `services/mox/.env.example` — all Mox + bridge environment variables

- [x] Task 2: Mox webhook adapter in bridge (AC: #5, #6, #7)
  - [x] 2.1 Extract `webhookAuth()` from `routes/email.ts` into new `middleware/auth.ts` — export it so both routers can import. Update `email.ts` to import from new location.
  - [x] 2.2 Extract email processing pipeline from `routes/email.ts` POST handler (lines 80-129) into shared function `processIncomingEmail(ctx, email: IncomingEmail): Promise<{ cid: string }>` in new `services/emailPipeline.ts`. Both `/receive-email` and `/mox-webhook` call this function after validation/transform.
  - [x] 2.3 Create `services/smtp-bridge/src/types/moxWebhook.ts` — Mox webhook payload type definitions (`MoxWebhookPayload`, `MoxNameAddress`, `MoxStructurePart`, `MoxMeta`)
  - [x] 2.4 Create `services/smtp-bridge/src/routes/moxWebhook.ts` — `createMoxWebhookRouter(ctx): Router` factory. `POST /mox-webhook` with `webhookAuth` middleware, payload transform, calls `processIncomingEmail(ctx, transformed)`
  - [x] 2.5 Register route in `app.ts`: `app.use(createMoxWebhookRouter(ctx))` — matches existing `createEmailRouter` pattern
  - [x] 2.6 Add Mox webapi client for attachment fetching: `MessagePartGet(MsgID, PartPath)` when `Structure.Parts` has non-text MIME parts (MVP: log warning and skip attachments)
  - [x] 2.7 Add `MOX_WEBAPI_URL` and `MOX_WEBAPI_PASSWORD` as optional environment variables to `config/env.ts`

- [x] Task 3: Docker Compose integration (AC: #1, #8, #12)
  - [x] 3.1 Create `services/mox/docker-compose.mox.yml` with Mox service (image: `r.xmox.nl/mox:latest`, host networking, volumes for config/data)
  - [x] 3.2 Create `services/mox/entrypoint.sh` — runs `sed` to replace `${BRIDGE_WEBHOOK_SECRET}` in `domains.conf.template` → `domains.conf`, then `exec mox serve`. Uses `sed` because `envsubst` is NOT available in the Mox Alpine image (only `tzdata` is installed). This is required because Mox sconf does NOT support env var interpolation natively.
  - [x] 3.3 Add `smtp-bridge` service definition referencing existing `services/smtp-bridge/`
  - [x] 3.4 Wire shared network: since Mox uses host networking, bridge is reachable at `localhost:3000`. Set `IncomingWebhook.URL` to `http://localhost:3000/mox-webhook`
  - [x] 3.5 Add health check: `echo QUIT | nc -w 2 localhost 25 | grep -q 220` for Mox container. Mox Alpine image has NO `ss` or `netstat` — use busybox `nc` TCP probe instead.
  - [x] 3.6 Document quickstart initialization: `mox quickstart [-hostname mail.alias.id] admin@alias.id` must run first to generate base configs and DKIM keys. Syntax: `mox quickstart [-skipdial] [-existing-webserver] [-hostname host] user@domain [user|uid]`

- [x] Task 4: DNS records documentation (AC: #9)
  - [x] 4.1 Create `services/mox/DNS-RECORDS.md` — MX, SPF, DKIM, DMARC records for `alias.id`
  - [x] 4.2 Document `mox quickstart` DNS output format — records are generated by quickstart command
  - [x] 4.3 Document DKIM key rotation procedure
  - [x] 4.4 Document DMARC escalation plan: `p=none` (MVP) → `p=quarantine` (30 days) → `p=reject` (90 days)

- [x] Task 5: TLS/ACME configuration (AC: #10)
  - [x] 5.1 Configure ACME provider in `mox.conf` (Let's Encrypt `DirectoryURL`, contact email)
  - [x] 5.2 Verify Mox auto-renews certificates via ACME
  - [x] 5.3 Document fallback: manual TLS cert provisioning via `KeyCerts` if ACME unavailable

- [x] Task 6: Tests (AC: #11)
  - [x] 6.1 Unit tests for Mox webhook adapter: transform payload, handle missing fields, HTML fallback, attachment extraction
  - [x] 6.2 Integration test: mock Mox webhook payload → `/mox-webhook` → verify internal pipeline receives correct `IncomingEmail`
  - [x] 6.3 Create `services/mox/test-email.sh` — E2E script using `swaks` or `curl` to send test email and verify webhook delivery

- [x] Task 7: Documentation and .env.example (AC: #13)
  - [x] 7.1 Update `services/mox/.env.example` with all variables
  - [x] 7.2 Create `services/mox/README.md` — quickstart guide for local dev and production deployment

## Dev Notes

### Architecture Overview

Story 5.4 bridges the gap between Mox (a production-grade Go SMTP server) and the SMTP bridge service (Story 5.3). Mox handles raw SMTP protocol, TLS, spam filtering, and DNS-level email configuration. The bridge handles blockchain-specific logic (alias lookup, encryption, IPFS, contract notification).

```
Internet → MX record → Mox (ports 25/587)
  → IncomingWebhook POST → Bridge /mox-webhook
  → Transform Mox payload → Internal IncomingEmail
  → Existing pipeline: alias lookup → encrypt → IPFS → notifyNewMail
```

### CRITICAL: Mox Webhook Payload Format vs Bridge IncomingEmail

Mox's `IncomingWebhook` sends a **different JSON format** than the bridge's `IncomingEmail` interface. A webhook adapter is required.

**Mox sends (webhook.Incoming):**
```json
{
  "Version": 0,
  "From": [{"Name": "", "Address": "sender@example.com"}],
  "To": [{"Name": "", "Address": "alias@alias.id"}],
  "CC": [],
  "Subject": "Hello",
  "MessageID": "<abc@mox.example>",
  "Date": "2026-03-08T00:00:00Z",
  "Text": "Email body text\n",
  "HTML": "<p>Email body</p>",
  "Structure": {
    "ContentType": "multipart/mixed",
    "Parts": [
      {"ContentType": "text/plain", "DecodedSize": 15, "Parts": []},
      {"ContentType": "image/png", "Filename": "photo.png", "DecodedSize": 45000, "ContentDisposition": "attachment", "Parts": []}
    ]
  },
  "Meta": {
    "MsgID": 201,
    "MailFrom": "sender@example.com",
    "RcptTo": "alias@alias.id",
    "DKIMVerifiedDomains": ["example.com"],
    "RemoteIP": "203.0.113.1",
    "Received": "2026-03-08T00:00:03Z",
    "MailboxName": "Inbox",
    "Automated": false
  }
}
```

**Bridge expects (IncomingEmail):**
```json
{
  "to": "alias@alias.id",
  "from": "sender@example.com",
  "subject": "Hello",
  "body": "Email body text",
  "attachments": [{"name": "photo.png", "contentType": "image/png", "base64": "..."}]
}
```

**Transformation rules:**
| Mox field | Bridge field | Transform |
|-----------|-------------|-----------|
| `From[0].Address` ?? `Meta.MailFrom` | `from` | Extract first address, fallback to envelope sender |
| `To[0].Address` ?? `Meta.RcptTo` | `to` | Extract first address, fallback to envelope recipient |
| `Subject` | `subject` | Direct copy |
| `Text` (or `HTML` fallback) | `body` | Prefer `Text`, fall back to `HTML`, empty string if neither |
| `Structure.Parts` (non-text) | `attachments` | MVP: log warning, skip. Future: fetch via Mox webapi `MessagePartGet(Meta.MsgID, partPath)`, base64-encode |

### Mox Webhook Adapter Implementation

```typescript
// services/smtp-bridge/src/routes/moxWebhook.ts
import { Router } from 'express';
import type { BridgeContext } from '../types/context.js';
import type { IncomingEmail, EmailAttachment } from '../types/email.js';

interface MoxNameAddress {
  Name: string;
  Address: string;
}

interface MoxStructurePart {
  ContentType: string;
  ContentDisposition: string;
  Filename: string;
  DecodedSize: number;
  Parts: MoxStructurePart[];
}

interface MoxWebhookPayload {
  Version: number;
  From: MoxNameAddress[];
  To: MoxNameAddress[];
  Subject: string;
  Text: string;
  HTML: string;
  Structure: MoxStructurePart;
  Meta: {
    MsgID: number;
    MailFrom: string;
    RcptTo: string;
    Received: string;
  };
}

function isAttachmentPart(part: MoxStructurePart): boolean {
  return part.ContentDisposition === 'attachment' ||
    (!part.ContentType.startsWith('text/') &&
     !part.ContentType.startsWith('multipart/'));
}

// Transform Mox payload → IncomingEmail
function transformMoxPayload(mox: MoxWebhookPayload): IncomingEmail {
  if (hasAttachmentParts(mox.Structure)) {
    console.warn(`[mox-webhook] Email ${mox.Meta.MsgID} has attachments — skipping (MVP)`);
  }
  return {
    from: mox.From[0]?.Address ?? mox.Meta.MailFrom,
    to: mox.To[0]?.Address ?? mox.Meta.RcptTo,
    subject: mox.Subject,
    body: mox.Text || mox.HTML || '',
    // MVP: attachments skipped — see Task 2.6
  };
}

function hasAttachmentParts(structure: MoxStructurePart): boolean {
  if (isAttachmentPart(structure)) return true;
  return structure.Parts?.some(hasAttachmentParts) ?? false;
}

// Factory function — matches createEmailRouter(ctx) pattern in app.ts
export function createMoxWebhookRouter(ctx: BridgeContext): Router {
  const router = Router();
  router.post('/mox-webhook', webhookAuth(ctx), async (req, res) => {
    const moxPayload = req.body as MoxWebhookPayload;
    // Validate required Mox fields
    if (!moxPayload.Meta?.MsgID || (!moxPayload.To?.length && !moxPayload.Meta?.RcptTo)) {
      res.status(400).json({ error: 'Invalid Mox webhook payload' });
      return;
    }
    const email = transformMoxPayload(moxPayload);
    const result = await processIncomingEmail(ctx, email);
    res.status(200).json(result);
  });
  return router;
}
// webhookAuth imported from middleware/auth.ts
// processIncomingEmail imported from services/emailPipeline.ts
```

### Attachment Fetching via Mox Webapi

Mox webhook payloads include `Text` and `HTML` inline (truncated to 1MB), but attachments are NOT inline. To get attachments, call Mox's webapi:

```
GET http://localhost:80/webapi/v0/MessagePartGet?MsgID=201&PartPath=1
Authorization: Basic <admin-credentials>
```

Returns raw bytes of the specified MIME part. The `PartPath` is the zero-indexed path through `Structure.Parts` (e.g., `1` for the second top-level part, `0.1` for the second sub-part of the first part).

**MVP approach:** Skip attachment fetching for MVP. Log a warning if attachments detected. Add attachment support as a follow-up enhancement.

### Mox Docker Configuration

**Image:** `r.xmox.nl/mox:latest`

**CRITICAL: Host networking required.** Mox needs access to real machine IPs and incoming connection IPs for spam filtering (SPF, DNSBL). Standard Docker bridge networking breaks this.

```yaml
# services/mox/docker-compose.mox.yml
services:
  mox:
    image: r.xmox.nl/mox:latest
    entrypoint: ["/bin/sh", "/mox/config/entrypoint.sh"]
    environment:
      - MOX_DOCKER=yes
      - BRIDGE_WEBHOOK_SECRET=${BRIDGE_WEBHOOK_SECRET}
    network_mode: 'host'
    volumes:
      - ./config:/mox/config:z
      - ./data:/mox/data:z
    working_dir: /mox
    restart: on-failure
    healthcheck:
      test: ["CMD", "sh", "-c", "echo QUIT | nc -w 2 localhost 25 | grep -q 220"]
      interval: 5s
      timeout: 3s
      retries: 10

  smtp-bridge:
    build:
      context: ../smtp-bridge
      dockerfile: Dockerfile
    network_mode: 'host'
    env_file:
      - .env
    depends_on:
      mox:
        condition: service_healthy
    restart: on-failure
```

**Note on host networking:** Both Mox and the bridge use `network_mode: 'host'`. Mox requires it for spam filtering (SPF, DNSBL need real IPs). The bridge runs on port 3000 (ensure no port conflicts). `IncomingWebhook.URL` in `domains.conf.template` uses `http://localhost:3000/mox-webhook`.

### Mox Configuration Files

**mox.conf** (sconf format — tabs for indentation):
```
# Static configuration — requires restart to reload
Hostname: mail.alias.id

TLS:
	ACME:
		letsencrypt:
			DirectoryURL: https://acme-v02.api.letsencrypt.org/directory
			ContactEmail: admin@alias.id

Listeners:
	public:
		IPs:
			- 0.0.0.0
		SMTP:
			Enabled: true
			Port: 25
			RequireSTARTTLS: true
		Submission:
			Enabled: true
			Port: 587
			NoRequireSTARTTLS: false
		IMAP:
			Enabled: false
		IMAPS:
			Enabled: false
		TLS:
			ACME: letsencrypt

AdminHTTPS:
	Enabled: false
AdminHTTP:
	Enabled: true
	Port: 8080
```

**IMAP explicitly disabled.** AliasVault routes all email through the bridge pipeline (encrypt → IPFS → contract notification). Leaving IMAP enabled would allow direct plaintext access to emails stored in Mox's internal mailbox, bypassing the encryption layer entirely. This is a security requirement.

**domains.conf.template** (sconf format — processed by `entrypoint.sh` via `sed` before Mox starts):

**CRITICAL: Mox sconf does NOT support `${VAR}` interpolation.** The config file must be templated at container startup. `entrypoint.sh` runs `sed` substitution on `domains.conf.template` then `exec mox serve`. (`envsubst` is NOT available — Mox Alpine image only installs `tzdata`.)

```
Domains:
	alias.id:
		DKIM:
			Selectors:
				dkim1:
					HashEffective: sha256
					Canonicalization:
						HeaderRelaxed: true
						BodyRelaxed: true
					DontSealHeaders: false
					Expiration: 0s
					PrivateKeyFile: dkim1.alias.id.key
			Sign:
				- dkim1

Accounts:
	aliasvault:
		Domain: alias.id
		Destinations:
			@alias.id:
				Mailbox: Inbox
		IncomingWebhook:
			URL: http://localhost:3000/mox-webhook
			Authorization: Bearer ${BRIDGE_WEBHOOK_SECRET}
```

**entrypoint.sh:**
```bash
#!/bin/sh
set -e
# sed is used because envsubst/gettext is NOT installed in the Mox Alpine image
sed "s|\${BRIDGE_WEBHOOK_SECRET}|${BRIDGE_WEBHOOK_SECRET}|g" \
  /mox/config/domains.conf.template > /mox/config/domains.conf
exec mox serve
```

### Mox Quickstart (IMPORTANT)

Before deploying, you MUST run `mox quickstart` to generate initial config files and DKIM keys:

```bash
# Inside the Mox container or locally
docker run --rm -v ./config:/mox/config -v ./data:/mox/data \
  -e MOX_DOCKER=yes -w /mox --network host r.xmox.nl/mox:latest \
  mox quickstart -hostname mail.alias.id admin@alias.id

# This generates:
# - config/mox.conf (base — we overlay with our version)
# - config/domains.conf (base — we overlay with our version)
# - config/dkim1.alias.id.key (DKIM private key)
# - Prints required DNS records to stdout
```

After quickstart, overlay the generated configs with our customized versions (add `IncomingWebhook`, adjust listener settings).

### DNS Records (Generated by `mox quickstart`)

Mox prints the exact DNS records during quickstart. Document these in `DNS-RECORDS.md`:

| Type | Name | Value | Purpose |
|------|------|-------|---------|
| MX | `alias.id` | `10 mail.alias.id.` | Route email to Mox server |
| A | `mail.alias.id` | `<server-ip>` | Mox server IP |
| TXT | `alias.id` | `v=spf1 a mx ip4:<server-ip> -all` | SPF: authorize senders |
| TXT | `dkim1._domainkey.alias.id` | `v=DKIM1; k=rsa; p=<pubkey>` | DKIM: email signing |
| TXT | `_dmarc.alias.id` | `v=DMARC1; p=none; rua=mailto:dmarc@alias.id` | DMARC: monitoring (escalate to `quarantine` after 30d, `reject` after 90d) |
| CNAME | `_mta-sts.alias.id` | `mail.alias.id` | MTA-STS |
| TXT | `_smtp._tls.alias.id` | `v=TLSRPTv1; rua=mailto:tlsrpt@alias.id` | TLS reporting |

### Environment Variables (.env.example)

```bash
# Mox
MOX_HOSTNAME=mail.alias.id
ACME_CONTACT_EMAIL=admin@alias.id

# Bridge Webhook (shared secret between Mox and bridge)
BRIDGE_WEBHOOK_SECRET=<random-secret-token>

# Mox Webapi (for attachment fetching — MVP: optional, attachments skipped)
# WebAPI shares port 80 with admin by default. Configure WebAPIHTTP listener in mox.conf
# if you need a dedicated port. With host networking, port 80 is used.
MOX_WEBAPI_URL=http://localhost:80/webapi/v0
MOX_WEBAPI_PASSWORD=<mox-admin-password>

# Mox Prometheus metrics (exposed on port 8010 by default — scrape for observability)
# MOX_METRICS_PORT=8010

# Bridge (existing — see Story 5.3 .env)
INDEXER_URL=https://indexer.preview.midnight.network/api/v3/graphql
INDEXER_WS_URL=wss://indexer.preview.midnight.network/api/v3/graphql/ws
PROOF_SERVER_URL=http://localhost:6300
NODE_URL=http://localhost:9944
WALLET_SEED=<64-char-hex-seed>
RELAY_SECRET_KEY=<64-char-hex-relay-key>
PINATA_JWT=<jwt-token>
PINATA_GATEWAY=<gateway-domain>
ALIAS_REGISTRY_ADDRESS=<deployed-address>
PORT=3000
```

### Reuse Existing Code

| What | Where | How |
|------|-------|-----|
| Webhook auth middleware | `services/smtp-bridge/src/routes/email.ts` → extract to `middleware/auth.ts` | Extract `webhookAuth()` to shared module, import in both routers |
| Email pipeline | `services/smtp-bridge/src/routes/email.ts` lines 80-129 → extract to `services/emailPipeline.ts` | Extract `processIncomingEmail(ctx, email)` — alias lookup → encrypt → IPFS → notify → return `{ cid }` |
| IncomingEmail interface | `services/smtp-bridge/src/types/email.ts` | Transform target format — no changes needed |
| Bridge env config | `services/smtp-bridge/src/config/env.ts` | Add `moxWebapiUrl`, `moxWebapiPassword` as optional fields |
| Metrics counters | `services/smtp-bridge/src/metrics.ts` | `emailsReceived`, `encryptionErrors` already exported — pipeline reuse picks these up |

### DO NOT

- Do NOT use Docker bridge networking for Mox — it MUST use host networking for spam filtering (SPF, DNSBL need real IPs)
- Do NOT hardcode DKIM keys — they are generated by `mox quickstart` and stored in `config/`
- Do NOT modify the existing `/receive-email` endpoint — add a new `/mox-webhook` route
- Do NOT inline attachments for MVP — log warning and skip. Attachment fetching via webapi is a follow-up
- Do NOT use `mox/mox:latest` as image — the correct registry is `r.xmox.nl/mox:latest`
- Do NOT skip the `MOX_DOCKER=yes` environment variable — without it, quickstart tries to write systemd files
- Do NOT use YAML for Mox config files — they use **sconf format** (similar but not identical; uses tabs for indentation)
- Do NOT put `${VAR}` placeholders directly in `domains.conf` — sconf has NO env var interpolation. Use `domains.conf.template` + `sed` in `entrypoint.sh`
- Do NOT use `envsubst` in `entrypoint.sh` — the Mox Docker image (`alpine:latest` + `tzdata` only) does NOT include `gettext`. Use `sed` instead.
- Do NOT leave IMAP/IMAPS enabled — Mox stores emails in its internal mailbox. IMAP access bypasses the bridge encryption pipeline and exposes plaintext emails. Explicitly disable in `mox.conf`.
- Do NOT set DMARC `p=reject` for a new domain — start with `p=none` for monitoring, escalate after 30-90 days
- Do NOT increase `express.json({ limit: '5mb' })` in `app.ts` — Mox truncates inline Text/HTML to 1MB each; webhook payloads will be well under 5MB

### Project Structure Notes

```
services/mox/                      # NEW — Mox deployment config
  docker-compose.mox.yml           # Docker Compose for Mox + bridge
  entrypoint.sh                    # sed templating for domains.conf (envsubst not available in Mox image)
  .env.example                     # All required environment variables
  DNS-RECORDS.md                   # DNS record documentation
  README.md                        # Deployment quickstart guide
  config/                          # Mox config (generated + overlaid)
    mox.conf                       # Static config (SMTP, TLS, admin)
    domains.conf.template          # Domain + account config template (sed substitution at startup)
    # dkim1.alias.id.key          # Generated by mox quickstart (gitignored)
    # domains.conf                # Generated at runtime by entrypoint.sh (gitignored)

services/smtp-bridge/              # MODIFIED — add Mox webhook adapter + refactor
  src/
    middleware/
      auth.ts                     # NEW — extracted webhookAuth() from routes/email.ts
    services/
      emailPipeline.ts            # NEW — extracted processIncomingEmail() from routes/email.ts
    routes/
      email.ts                    # MODIFIED — import webhookAuth from middleware, pipeline from services
      moxWebhook.ts               # NEW — Mox webhook adapter route (createMoxWebhookRouter)
    types/
      moxWebhook.ts               # NEW — Mox webhook payload types
    config/
      env.ts                      # MODIFIED — add moxWebapiUrl, moxWebapiPassword (optional)
    app.ts                        # MODIFIED — register createMoxWebhookRouter(ctx)
  src/__tests__/
    moxWebhook.test.ts            # NEW — adapter unit + integration tests
```

`services/mox/` is NOT in `pnpm-workspace.yaml` — it's a pure infrastructure directory with no Node.js code. Only the bridge modifications (`services/smtp-bridge/`) are workspace-managed.

### Previous Story Learnings

**From Story 5.3 (SMTP Bridge — done):**
- Bridge webhook expects `Authorization: Bearer <token>` — Mox's `IncomingWebhook.Authorization` field provides exactly this
- Bridge's `POST /receive-email` validates `{ to, from, subject, body }` as required fields
- Rate limiting is per-alias based on `to` address local part extraction
- `webhookAuth()` middleware in `routes/email.ts` can be reused for the new `/mox-webhook` route
- Bridge runs on port 3000 (configurable via `PORT` env var)
- 45 tests passing — do NOT break existing tests

**From Story 5.3 code review:**
- Rule 26 (contract wiring): Bridge wires `setQueryFn()`/`setNotifyFn()` in `index.ts` — new route does not need contract wiring, it just feeds into existing pipeline
- Webhook auth was added as H2 fix — `BRIDGE_WEBHOOK_SECRET` is already a required env var

### Git Intelligence

Recent commits show Story 5.0-5.3 complete. Story 5.3 (SMTP bridge) is the immediate predecessor and the service this story extends. The bridge codebase is stable with 45 passing tests.

### Testing Strategy

- **Unit tests for adapter**: Mock Mox webhook payloads → verify correct `IncomingEmail` transformation
  - Test: From/To extraction from `NameAddress[]` array
  - Test: Text body preference over HTML
  - Test: HTML fallback when Text is empty
  - Test: Missing optional fields (CC, BCC, attachments)
  - Test: Attachment detection in Structure.Parts (logs warning for MVP)
- **Integration test**: POST Mox-format JSON to `/mox-webhook` → verify full pipeline executes (reuse mock patterns from `receiveEmail.integration.test.ts`)
- **E2E script** (`test-email.sh`): Use `swaks` (SMTP test tool) to send real email to Mox → verify webhook delivery to bridge
- **Framework**: `vitest` (consistent with bridge)
- **DO NOT test Mox config correctness in code tests** — Mox config is validated by `mox quickstart` and Mox's own startup

### References

- [Source: docs/architecture/adr-001-smtp-infrastructure.md] — Mox chosen over C# SmtpServer, webhook config syntax
- [Source: _bmad-output/architecture.md#SMTP-Bridge-Service-Architecture] — Docker Compose layout, deployment pattern. **NOTE: Architecture Section 5 is outdated** — uses wrong image name (`mox/mox:latest`), wrong networking (bridge instead of host), wrong volume path, and assumes webhook payload matches bridge format. This story corrects all of these. Update architecture doc post-implementation.
- [Source: services/smtp-bridge/src/routes/email.ts] — Existing webhook endpoint, `webhookAuth()` middleware, `IncomingEmail` processing pipeline
- [Source: services/smtp-bridge/src/types/email.ts] — `IncomingEmail`, `EmailAttachment` interfaces
- [Source: services/smtp-bridge/src/config/env.ts] — Environment variable loader
- [Source: services/smtp-bridge/src/app.ts] — Express app configuration
- [Source: https://www.xmox.nl/config/] — Mox configuration reference (sconf format)
- [Source: https://pkg.go.dev/github.com/mjl-/mox/webapi] — Mox webhook.Incoming payload format, webapi methods
- [Source: https://github.com/mjl-/mox/blob/main/docker-compose.yml] — Official Mox Docker Compose reference
- [Source: https://www.xmox.nl/install/] — Mox installation and quickstart guide
- [Source: https://www.xmox.nl/commands/] — Mox command reference (quickstart syntax: `mox quickstart [-hostname host] user@domain`)
- [Source: https://github.com/mjl-/mox/blob/main/Dockerfile] — Mox Dockerfile: `alpine:latest` + `tzdata` only. No envsubst, no ss, no netstat. CMD: `mox serve`

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

None — clean implementation, no blocking issues.

### Completion Notes List

- **Task 1:** Created Mox configuration files — `mox.conf` (SMTP 25/587, TLS ACME, IMAP disabled, admin localhost:8080), `domains.conf.template` (alias.id domain, IncomingWebhook with sed-templated secret), `.env.example`.
- **Task 2:** Refactored bridge for code reuse — extracted `webhookAuth()` to `middleware/auth.ts`, extracted email processing pipeline to `services/emailPipeline.ts` with `PipelineError` class. Created Mox webhook types (`MoxWebhookPayload`, etc.) and `createMoxWebhookRouter` with `transformMoxPayload`. MVP: attachments detected and logged, not fetched. Added `moxWebapiUrl`/`moxWebapiPassword` as optional env vars.
- **Task 3:** Docker Compose with host networking for both Mox and bridge. `entrypoint.sh` uses `sed` (no `envsubst` in Alpine). Health check via `nc` TCP probe on port 25.
- **Task 4:** DNS-RECORDS.md with MX, SPF, DKIM, DMARC, MTA-STS, TLS reporting. DKIM rotation procedure. DMARC escalation plan (none → quarantine → reject).
- **Task 5:** ACME configured in mox.conf. Manual TLS fallback documented in README.
- **Task 6:** 18 new tests — 10 unit tests for `transformMoxPayload` (from/to extraction, text/HTML preference, HTML fallback, empty body, Meta fallbacks, attachment detection), 8 integration tests for `/mox-webhook` route (auth, validation, pipeline, error cases). E2E script using swaks.
- **Task 7:** README with quickstart guide, architecture diagram, security notes. .gitignore for runtime files.
- **Tests:** 63 total (45 existing + 18 new), all passing. Zero regressions.

### Change Log

- 2026-03-08: Story 5.4 implemented — Mox SMTP deployment config, webhook adapter, Docker Compose, DNS docs, 18 tests
- 2026-03-09: Code review applied — C1 (entrypoint.sh volume mount), H1 (missing Dockerfile), M1 (secret validation fail-fast), M3→L (nullish MsgID check), L2 (from/to post-transform validation). M2 (rate limiting) dismissed — internal endpoint. L1 (test dedup) dismissed — refactoring concern.

### File List

**New files:**
- `services/mox/config/mox.conf` — Mox static configuration (SMTP, TLS, admin)
- `services/mox/config/domains.conf.template` — Domain/account config template (sed substitution)
- `services/mox/config/entrypoint.sh` — Container startup script (sed templating + secret validation)
- `services/mox/.env.example` — Environment variable documentation
- `services/mox/.gitignore` — Ignore runtime-generated files
- `services/mox/docker-compose.mox.yml` — Docker Compose for Mox + bridge
- `services/mox/DNS-RECORDS.md` — DNS records documentation
- `services/mox/README.md` — Deployment quickstart guide
- `services/mox/test-email.sh` — E2E test script
- `services/smtp-bridge/Dockerfile` — Multi-stage Docker build for bridge service
- `services/smtp-bridge/src/middleware/auth.ts` — Extracted webhookAuth middleware
- `services/smtp-bridge/src/services/emailPipeline.ts` — Extracted email processing pipeline
- `services/smtp-bridge/src/types/moxWebhook.ts` — Mox webhook payload types
- `services/smtp-bridge/src/routes/moxWebhook.ts` — Mox webhook adapter route
- `services/smtp-bridge/src/__tests__/moxWebhook.test.ts` — Webhook adapter tests (18 tests)

**Modified files:**
- `services/smtp-bridge/src/routes/email.ts` — Import webhookAuth from middleware, use processIncomingEmail from pipeline
- `services/smtp-bridge/src/config/env.ts` — Added moxWebapiUrl, moxWebapiPassword (optional)
- `services/smtp-bridge/src/app.ts` — Register createMoxWebhookRouter
- `services/mox/docker-compose.mox.yml` — Fixed build context to workspace root for pnpm workspace deps
