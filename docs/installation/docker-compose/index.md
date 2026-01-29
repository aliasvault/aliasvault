---
layout: default
title: Docker Compose
parent: Self-host Install
redirect_from:
  - /installation/advanced/manual-setup
  - /installation/advanced/manual-setup.html
nav_order: 2
---

# Self-host using Docker Compose (single container)
The following guide will walk you through the steps to install AliasVault via the All-In-One Docker container. This container uses `s6-overlay` to combine all AliasVault's services into one image for convenience. The only downside compared to the `install.sh` installer is that this version does NOT come with SSL/TLS support, so you'll have to make the container available through your own SSL/TLS proxy.

{: .important-title }
> Requirements:
> - Docker (20.10+) and Docker Compose (2.0+) installed on your system
>  - See instructions: [https://docs.docker.com/engine/install/](https://docs.docker.com/engine/install/)
> - You have existing SSL/TLS proxy infrastructure (Traefik, Nginx, HAProxy, Cloudflare Tunnel)
> - Knowledge of working with direct Docker commands
> - Knowledge of .yml and .env files

## 1. Basic installation
1. Create a new folder where you want to store AliasVault's data and configuration folders.
```bash
mkdir aliasvault
cd aliasvault
```
2. Create a new `docker-compose.yml` file with the following contents. Note: the directories specified in `volumes:` will be auto-created in the current folder on container first start.

```yaml
services:
  aliasvault:
    image: ghcr.io/aliasvault/aliasvault:latest
    container_name: aliasvault
    restart: unless-stopped

    ports:
      - "80:80"
      - "443:443"
      - "25:25"
      - "587:587"

    volumes:
      - ./database:/database
      - ./logs:/logs
      - ./secrets:/secrets

    environment:
      HOSTNAME: "localhost"
      PUBLIC_REGISTRATION_ENABLED: "true"
      IP_LOGGING_ENABLED: "true"
      FORCE_HTTPS_REDIRECT: "false"
      SUPPORT_EMAIL: ""
      PRIVATE_EMAIL_DOMAINS: ""
```
3. Run `docker-compose up -d` to start the container.
4. After the container has started, AliasVault should now be running. You can access it at:

    - Admin Panel: http://localhost/admin
        - **Username:** admin
        - **Password:** [*Read instructions on page*]

    - Client Website: http://localhost/
        - Create your own account from here

    - API: http://localhost/api
        - Used for configuring the browser extension and mobile app to connect to your server

---

## 2. SSL/TLS configuration
To use AliasVault securely, HTTPS is required in the following situations:
- When accessing the web app from any address other than `localhost` (due to browser security restrictions)
- When using the mobile apps, which require the API URL to have a valid TLS certificate; otherwise, the app will not connect

You must set up and configure your own TLS/SSL infrastructure (such as Traefik, Nginx, HAProxy, or Cloudflare Tunnel) to make the AliasVault container accessible over HTTPS with a valid SSL/TLS certificate. For example: `https://aliasvault.yourdomain.com`.

### Troubleshooting
#### Enabling WebSockets
If you're accessing the Admin page through a reverse proxy and encounter errors after login, check that the Upgrade header is allowed and forwarded. This is required because the Admin app is built with .NET Blazor Server, which uses WebSockets for client-server communication. For example, when using nginx:

```nginx
  # Add WebSocket support for Blazor server
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 86400;
```

---

## 3. Email Server Setup

AliasVault includes a built-in email server that allows you to generate email aliases on-the-fly for every website you use, and receive the emails straight in AliasVault.

{: .note }
If you skip this step, AliasVault will default to use public email domains offered by SpamOK. While this still works for creating aliases, it has privacy limitations. For complete privacy and control, we recommend setting up your own domain.
[Learn more about the differences between private and public email domains](../../misc/private-vs-public-email.md).

### Requirements
- A **public IPv4 address** with ports 25 and 587 forwarded to your AliasVault server
- Open ports **25** and **587** on your server firewall for email SMTP traffic (*NOTE: some residential IP's block this, check with your ISP*).

#### Verifying Port Access

While the AliasVault docker containers are running, use `telnet` to confirm your public IP allows access to the ports:

```bash
# Test standard SMTP port
telnet <your-server-public-ip> 25

# Test secure SMTP port
telnet <your-server-public-ip> 587
```

### DNS configuration
Choose your configuration: primary domain vs subdomain. AliasVault can be configured under:

- **A primary (top-level) domain**
  Example: `your-aliasvault.net`. This allows you to receive email on `%alias%@your-aliasvault.net`.

- **A subdomain of your existing domain**
  Example: `aliasvault.example.net`. This allows you to receive email on `%alias%@aliasvault.example.net`. Email sent to your main domain remains unaffected and will continue arriving in your usual inbox.

---

#### a) Setup using a primary domain

Configure the following DNS records **on your primary domain** (e.g. `your-aliasvault.net`):

| Name | Type | Priority | Content                   | TTL |
|------|------|----------|---------------------------|-----|
| mail | A    |          | `<your-server-public-ip>` | 3600 |
| @    | MX   | 10       | `mail.your-aliasvault.net`| 3600 |

> Replace `<your-server-public-ip>` with your actual server IP.

##### Example

- `mail.your-aliasvault.net` points to your server IP.
- Email to `@your-aliasvault.net` will be handled by your AliasVault server.

---

#### b) Setup using a subdomain

Configure the following DNS records **on your subdomain setup** (for example, `aliasvault.example.com`):

| Name                     | Type | Priority | Content                       | TTL |
|---------------------------|------|----------|-------------------------------|-----|
| mail.aliasvault           | A    |          | `<your-server-public-ip>`     | 3600 |
| aliasvault    | MX   | 10       | `mail.aliasvault.example.com` | 3600 |

> 🔹 Explanation:
> - `mail.aliasvault` creates a DNS A record for `mail.aliasvault.example.com` pointing to your server IP.
> - The MX record on `aliasvault.example` tells senders to send their mail addressed to `%@aliasvault.example.com` to `mail.aliasvault.example.com`.

> Replace `<your-server-public-ip>` with your actual server’s IP address.

##### Example

- `mail.aliasvault.example.com` points to your server IP.
- Emails to `user@aliasvault.example.com` will be handled by your AliasVault server.

This keeps the email configuration of your primary domain (`example.com`) completely separate, so you can keep receiving email on your normal email addresses and have unique AliasVault addresses too.

---

### AliasVault server email domain configuration
After setting up your DNS, you have to configure AliasVault to let it know which email domains it should support. Update the `docker-compose.yml` file:

```bash
# ...
    environment:
      PRIVATE_EMAIL_DOMAINS: "yourdomain1.com,yourdomain2.com"
# ...
```

After updating the docker-compose.yml file, restart the Docker Compose stack:
```bash
# To apply new environment variables, containers must be recreated.
docker compose down
docker compose up -d
```

Afterwards, when you login to the AliasVault web app, you should now be able to create an alias with your configured private domain and be able to receive email on it.

{: .note }
Important: DNS propagation can take up to 24-48 hours. During this time, email delivery might be inconsistent.

If you encounter any issues, feel free to join the [Discord chat](https://discord.gg/DsaXMTEtpF) to get help from other users and maintainers.
