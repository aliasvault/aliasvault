---
layout: default
title: Admin access
parent: Advanced
grand_parent: Install Script
nav_order: 5
---

# Admin access

By default the admin panel at `/admin` is reachable from the public internet, alongside the regular client app. This is intentional and safe to leave as-is for most installations:

- Sign-in requires the admin password you set during installation (and optional 2FA).
- The admin account is protected against brute force: after 10 failed sign-in attempts the account is locked for 30 minutes.

If you'd still rather not expose `/admin` to the open internet — for example if your AliasVault server is only meant to be reached from a home network or VPN — you can restrict it by client IP at the reverse-proxy layer.

## How it works

When a request to `/admin` comes from an IP that is **not** on the allowlist, the reverse proxy quietly forwards it to the regular client app instead of returning a 403/404. From the outside, `/admin` looks identical to any other path on the public surface. There's no signal that an admin panel exists at that URL.

Requests from allowlisted IPs reach the admin panel as normal.

## Configure

Run the install script — it walks you through the options, validates your input, and offers to restart the containers for you:

```bash
$ ./install.sh configure-admin-access
```

You'll be prompted to choose one of:

| Option | Effect |
|---|---|
| No restriction (default) | `/admin` is reachable from anywhere. |
| Private networks only | Only loopback and RFC1918 addresses are allowed (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`). |
| Custom CIDRs/IPs | Only the listed ranges are allowed (loopback is always allowed). |

## Behind another reverse proxy

If AliasVault is itself running behind another reverse proxy (Cloudflare, Traefik, an upstream nginx, etc.), the allowlist is matched against the client IP forwarded via `X-Forwarded-For`. Make sure your upstream proxy is setting that header correctly, otherwise every request will appear to come from the proxy's own address.
