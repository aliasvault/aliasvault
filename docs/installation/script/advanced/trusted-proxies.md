---
layout: default
title: Trusted proxies
parent: Advanced
grand_parent: Install Script
nav_order: 6
---

# Trusted proxies

When AliasVault sits behind another reverse proxy (HAProxy, Traefik, Cloudflare, an upstream nginx, etc.), the built-in nginx reads the real client IP from the `X-Forwarded-For` header so that audit logs and the IP allowlist see the actual client rather than the upstream proxy.

To prevent header spoofing, nginx only honors `X-Forwarded-For` when the request comes from an explicitly trusted upstream. The `TRUSTED_PROXIES` environment variable controls that list.

## How it works

For every incoming request, nginx checks the direct peer's IP against `TRUSTED_PROXIES`:

- If the peer IP matches a trusted entry, nginx replaces `$remote_addr` with the value from `X-Forwarded-For`.
- If it doesn't match, the header is ignored and the direct peer IP is used.

`real_ip_recursive` is enabled, so when a chain of trusted proxies is configured nginx walks the `X-Forwarded-For` list right-to-left until it finds the first untrusted address.

## Configure

Run the install script which walks you through the options, validates your input, and offers to restart the containers for you:

```bash
$ ./install.sh configure-trusted-proxies
```

You'll be prompted to choose one of:

| Option | Effect |
|---|---|
| Default | Trust all RFC1918 ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`). |
| Custom CIDRs/IPs | Trust only the listed proxies (recommended when you know your upstream proxy address). |
| None | Trust no upstream proxies. `X-Forwarded-For` is always ignored and the direct peer IP is logged. |

## Why narrow this down

The default of all RFC1918 ranges is convenient. Most setups place AliasVault and its upstream proxy in the same private network. But it does mean that **any** request originating from a private IP can spoof `X-Forwarded-For` and appear in the logs as a different client. If you have other workloads on the same private network, set `TRUSTED_PROXIES` to your specific upstream proxy address(es) so only that proxy is trusted to set the header.
