---
layout: default
title: Self-host Install
nav_order: 2
---

# Self-host Install

AliasVault can be self-hosted on your own servers using two different installation methods. Both use Docker, but they differ in how much is automated versus how much you manage yourself.

## Which Installation Method to Choose?

### 🚀 **Option 1: Install Script**
The installer script is a **fully managed solution** that handles everything for you. Simply run it on a clean VM/LXC with Docker installed, and it will set up all required containers, configure SSL certificates and provide CLI helpers for easy updates and maintenance.

### 🛠️ **Option 2: Docker Compose**
If you prefer manual setup and **have existing SSL infrastructure**, use the all-in-one Docker image via Docker Compose. It works with your existing SSL proxy (Traefik, HAProxy, Caddy, etc.) and gives you full control over the configuration. Note: because this install method does not include a CLI, future updates may require some manual migrations.

|                          | **Option 1: Install Script (multi-container)** | **Option 2: Docker Compose (single container)** |
|--------------------------|---------------------------------------------------|-----------------------------------------------|
| **Best for**             | ☁️ VPS/VM/Proxmox, cloud hosts, DigitalOcean, AWS/Azure | 🏠 NAS/Synology/Unraid, Raspberry Pi, home servers |
| **Internet accessible**  | Direct internet access with ports 80/443         | Behind existing infrastructure                |
| **TLS/SSL**              | Built-in reverse proxy + Let's Encrypt (automatic) | Bring your own (Traefik, Nginx, HAProxy, Caddy) |
| **Containers**           | Multiple containers (client, api, postgres, task runner, smtp, admin, reverse proxy) | Single bundled container (all-in-one)         |
| **Configuration**        | Automatic docker-compose.yml setup               | Standard Docker commands                      |
| **Updates**              | `install.sh` assisted updates & migrations                | `docker pull` (manual); occasional manual migrations |
| **Admin actions**        | `install.sh` helpers for admin password reset              | SSH into container for certain tasks (e.g. password reset) |
| **Setup style**          | Managed, opinionated, production-ready defaults  | Fits into existing homelab/stack tools (Portainer compatible) |
| **Build from source**    | Supported                             | Pre-built container only                      |
| **Choose if…**           | You want auto SSL and a managed stack            | You already have TLS and prefer manual control |
|                          | [**Self-host via Install Script →**](./script){: .btn .btn-primary } | [**Self-host via Docker →**](./docker-compose){: .btn .btn-primary } |

### Quick Decision Guide

**Go with the Install Script if:**
- ✅ You have a fresh VM or VPS dedicated to AliasVault
- ✅ You want automatic SSL setup without hassle
- ✅ You prefer managed updates and maintenance
- ✅ You're new to Docker or want the simplest setup

**Go with Docker Compose if:**
- ✅ You're already running other Docker containers on this host
- ✅ You have existing SSL infrastructure (reverse proxy)
- ✅ You want to integrate with your homelab tools (Portainer, etc.)
- ✅ You prefer manual control over the configuration


---

## Frequently Asked Questions

<details style="margin-bottom: 10px;">
<summary style="background-color: #4a5568; color: #ffffff; padding: 10px; border-radius: 5px; cursor: pointer;">What's the difference between multi-container and single container?</summary>
<div style="background-color: #2d3748; color: #ffffff; padding: 15px; border-left: 3px solid #4299e1;" markdown="1">

| **Multi-container (Installer Script)** | **Single container (Manual Setup)** |
|----------------------------------------|-------------------------------------|
| Separates services into individual containers | All services bundled in one container |
| Easier to scale individual components | Simpler to manage with Docker commands |
| Uses docker-compose for orchestration | Lower resource overhead |
| Better for production deployments | Better for home labs and personal use |

</div>
</details>

<details style="margin-bottom: 10px;">
<summary style="background-color: #4a5568; color: #ffffff; padding: 10px; border-radius: 5px; cursor: pointer;">Do I need to handle SSL/TLS certificates myself?</summary>
<div style="background-color: #2d3748; color: #ffffff; padding: 15px; border-left: 3px solid #4299e1;" markdown="1">

- **Installer Script**: No, it includes automatic Let's Encrypt certificates
- **Manual Setup**: Yes, you need your own reverse proxy for HTTPS

</div>
</details>

<details style="margin-bottom: 10px;">
<summary style="background-color: #4a5568; color: #ffffff; padding: 10px; border-radius: 5px; cursor: pointer;">How do updates work?</summary>
<div style="background-color: #2d3748; color: #ffffff; padding: 15px; border-left: 3px solid #4299e1;" markdown="1">

| Method | Update Process |
|--------|---------------|
| **Installer Script** | Run `./install.sh update` for automated updates and migrations |
| **Manual Setup** | Use `docker pull` to get the latest image; manual migrations may be required |

</div>
</details>

<details style="margin-bottom: 10px;">
<summary style="background-color: #4a5568; color: #ffffff; padding: 10px; border-radius: 5px; cursor: pointer;">Can I migrate between installation methods?</summary>
<div style="background-color: #2d3748; color: #ffffff; padding: 15px; border-left: 3px solid #4299e1;" markdown="1">

Yes! Both methods use the same bind mount directories (`/database`, `/certificates`, `/logs`, `/secrets`), making migration straightforward. Simply stop/uninstall via one method and follow the installation steps for the other - your data will be preserved.

</div>
</details>

<details style="margin-bottom: 10px;">
<summary style="background-color: #4a5568; color: #ffffff; padding: 10px; border-radius: 5px; cursor: pointer;">What are the system requirements?</summary>
<div style="background-color: #2d3748; color: #ffffff; padding: 15px; border-left: 3px solid #4299e1;" markdown="1">

**Minimum requirements:**
- 64-bit Linux OS (Ubuntu or RHEL-based recommended)
- 1 vCPU, 1GB RAM, 16GB disk
- Docker CE (≥ 20.10) and Docker Compose (≥ 2.0)

**Network requirements:**
- Ports 80 and 443 available
- Optional: Ports 25 and 587 for private email domains

</div>
</details>

<details style="margin-bottom: 10px;">
<summary style="background-color: #4a5568; color: #ffffff; padding: 10px; border-radius: 5px; cursor: pointer;">Can I build from source?</summary>
<div style="background-color: #2d3748; color: #ffffff; padding: 15px; border-left: 3px solid #4299e1;" markdown="1">

- **Installer Script**: Yes, optional build from source is supported
- **Manual Setup**: No, uses pre-built container images only

</div>
</details>
