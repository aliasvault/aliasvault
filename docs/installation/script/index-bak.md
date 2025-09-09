---
layout: default
title: Installer Script (multi-container)
parent: Self-host Installs
nav_order: 1
has_children: true
---

# Installer Script (multi-container)

The installer script provides a managed, production-ready deployment of AliasVault using multiple Docker containers. This method includes automatic SSL certificates, built-in reverse proxy, and CLI-based management tools.

{: .important }
> **Best for:** VPS, cloud hosting (AWS, Azure, DigitalOcean), dedicated servers with direct internet access

1. **New Installation?** Start with the [Installation Guide](./installation)
2. **Upgrading?** Check the [Update Guide](./update/)
3. **Need Help?** Visit [Troubleshooting](./troubleshooting) or join our [Discord](https://discord.gg/DsaXMTEtpF)

## 📚 Documentation

<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin: 20px 0;">

<div style="background: #4a5568; border: 1px solid #d1d5da; border-radius: 8px; padding: 20px;">
<h3 style="margin-top: 0;">🚀 Getting Started</h3>
<p>Initial installation and configuration</p>
<ul style="list-style: none; padding: 0;">
<li>📖 <a href="./installation">Installation Guide</a></li>
<li>🔒 <a href="./installation#tls-ssl-configuration">SSL/TLS Setup</a></li>
<li>📧 <a href="./installation#email-server-setup">Email Configuration</a></li>
<li>👤 <a href="./installation#configure-account-registration">Registration Settings</a></li>
</ul>
</div>

<div style="background: #4a5568; border: 1px solid #d1d5da; border-radius: 8px; padding: 20px;">
<h3 style="margin-top: 0;">🔄 Updates & Maintenance</h3>
<p>Keep your instance up-to-date</p>
<ul style="list-style: none; padding: 0;">
<li>📖 <a href="./update/">Update Guide</a></li>
<li>💾 <a href="./advanced/database">Database Backup</a></li>
<li>🗑️ <a href="./advanced/uninstall">Uninstall Guide</a></li>
</ul>
</div>

<div style="background: #4a5568; border: 1px solid #d1d5da; border-radius: 8px; padding: 20px;">
<h3 style="margin-top: 0;">❓ Help & Support</h3>
<p>Troubleshooting and assistance</p>
<ul style="list-style: none; padding: 0;">
<li>🐛 <a href="./troubleshooting">Troubleshooting Guide</a></li>
<li>💬 <a href="https://discord.gg/DsaXMTEtpF">Discord Community</a></li>
<li>📝 <a href="https://github.com/aliasvault/aliasvault/issues">Report Issues</a></li>
</ul>
</div>

</div>

---

## Architecture Overview

The installer script deploys AliasVault as a multi-container application:

| Container | Purpose |
|-----------|---------|
| **reverse-proxy** | Nginx reverse proxy with SSL termination |
| **client** | Web interface (Blazor WebAssembly) |
| **api** | REST API backend |
| **admin** | Admin portal |
| **postgres** | PostgreSQL database |
| **smtp** | Email server for aliases |
| **task-runner** | Background jobs and maintenance |

All containers are managed via `./install.sh` (which uses `docker compose` in the background) and configured through a centralized `.env` file.
