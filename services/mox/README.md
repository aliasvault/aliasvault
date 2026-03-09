# Mox SMTP Server — AliasVault

Production-grade SMTP server for receiving `@alias.id` emails. Mox handles SMTP protocol, TLS, spam filtering, and forwards emails to the SMTP bridge via webhook.

## Architecture

```
Internet → MX record → Mox (ports 25/587)
  → IncomingWebhook POST → Bridge /mox-webhook
  → Transform Mox payload → Internal IncomingEmail
  → Pipeline: alias lookup → encrypt → IPFS → notifyNewMail
```

## Quick Start

### 1. Initialize Mox

Run `mox quickstart` to generate DKIM keys and base configs:

```bash
docker run --rm -v ./config:/mox/config -v ./data:/mox/data \
  -e MOX_DOCKER=yes -w /mox --network host r.xmox.nl/mox:latest \
  mox quickstart -hostname mail.alias.id admin@alias.id
```

This generates DKIM keys and prints required DNS records to stdout.

### 2. Configure DNS

Add the DNS records printed by quickstart. See [DNS-RECORDS.md](DNS-RECORDS.md) for details.

### 3. Set Environment Variables

```bash
cp .env.example .env
# Edit .env with your values
```

### 4. Start Services

```bash
docker compose -f docker-compose.mox.yml up -d
```

This starts both Mox and the SMTP bridge. The bridge starts after Mox's health check passes.

### 5. Test

```bash
./test-email.sh
```

## Configuration Files

| File | Purpose |
|------|---------|
| `config/mox.conf` | SMTP listener, TLS/ACME, admin interface |
| `config/domains.conf.template` | Domain, DKIM, webhook config (templated) |
| `entrypoint.sh` | `sed` substitution at container startup |
| `docker-compose.mox.yml` | Docker Compose for Mox + bridge |
| `.env.example` | Required environment variables |

## Host Networking

Both Mox and the bridge use `network_mode: 'host'`. Mox requires real IPs for spam filtering (SPF, DNSBL). The bridge runs on port 3000.

## TLS Certificates

TLS is provisioned via ACME (Let's Encrypt) automatically. Mox handles certificate renewal.

### Manual TLS Fallback

If ACME is unavailable (e.g., no public HTTP access for challenge), configure manual certificates in `mox.conf`:

```
Listeners:
	public:
		TLS:
			KeyCerts:
				fallback:
					CertFile: /mox/config/cert.pem
					KeyFile: /mox/config/key.pem
```

Remove the `ACME: letsencrypt` line when using manual certificates.

## Security Notes

- IMAP/IMAPS are explicitly disabled — all email routes through the encrypted bridge pipeline
- DMARC starts at `p=none` (monitoring only) — escalate per [DNS-RECORDS.md](DNS-RECORDS.md)
- Webhook auth uses `Bearer` token shared between Mox and bridge via `BRIDGE_WEBHOOK_SECRET`
