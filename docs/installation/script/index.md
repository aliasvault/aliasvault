---
layout: default
title: Install Script
parent: Self-host Install
redirect_from:
  - /installation/install
  - /installation/install.html
nav_order: 1
---

# Self-host using Install Script (multi-container)
The following guide will walk you through the steps to install AliasVault on your own server using the AliasVault installer script: `install.sh`. This script will pull pre-built Docker Images and do all the configuration for you while using `docker compose` in the background.

<details open markdown="block">
  <summary>
    Table of contents
  </summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

{: .important-title }
> Requirements:
> - 64-bit Linux VM with root access (Ubuntu or RHEL-based recommended)
> - Minimum: 1 vCPU, 1GB RAM, 16GB disk
> - Docker (CE ≥ 20.10) and Docker Compose (≥ 2.0)
> → Installation guide: [Docker Docs](https://docs.docker.com/engine/install/)
> - Able to forward ports 80, 443 (with optional 25/587 for private email domains)

---

## 1. Basic Installation
1. Download the install script to a directory of your choice. All AliasVault files and directories will be created in this directory.
```bash
# Download the install script
curl -L -o install.sh https://github.com/aliasvault/aliasvault/releases/latest/download/install.sh
```

2. Make the install script executable.
```bash
chmod +x install.sh
```

3. Run the installation wizard.
```bash
./install.sh install
```
> **Note**: AliasVault binds to ports 80 and 443 by default. If you want to change the default AliasVault ports you can do so in the `.env` file. Afterwards re-run the `./install.sh install` command to restart the containers with the new port settings.

4. After the script completes, you can access AliasVault at:
  - Client: `https://localhost`
  - Admin: `https://localhost/admin`

---

## 2. TLS/SSL configuration
The default installation will create a self-signed TLS/SSL certificate and configure Nginx to use it. This is sufficient for local deployments using only the web-app, however the mobile apps (iOS and Android) require a valid (external) SSL certificate to be able to connect.

To generate a valid external TLS/SSL certificate for AliasVault, you can use Let's Encrypt via a built-in helper tool. In order to make this work you will need the following:

- A public IPv4 address assigned to your server
- Port 80 and 443 on your server must be open and accessible from the internet
- A registered domain name with an A record pointing to your server's public IP address (e.g. mydomain.com)

### Enable Let's Encrypt SSL

1. Run the install script with the `configure-ssl` option
```bash
./install.sh configure-ssl
```
2. Follow the prompts to configure Let's Encrypt.

### Reverting to self-signed TLS/SSL
If at any point you would like to revert to the self-signed TLS/SSL certificate, run the install script again with the `configure-ssl` option
and then in the prompt choose option 2.

---

## 3. Email Server Setup

AliasVault includes a built-in email server that allows you to generate email aliases on-the-fly for every website you use, and receive + read the emails straight in AliasVault.

{: .note }
If you skip this step, AliasVault will default to use public email domains offered by SpamOK. While this still works for creating aliases, it has privacy limitations. For complete privacy and control, we recommend setting up your own domain. [Learn more about the differences between private and public email domains](../../misc/private-vs-public-email.md).

### Requirements
- A **public IPv4 address** with ports 25 and 587 forwarded to your AliasVault server
- Open ports **25** and **587** on your server firewall for email SMTP traffic (*NOTE: some residential IP's block this, check with your ISP*).

#### Verifying Port Access

While the AliasVault docker container is running, use `telnet` to confirm your public IP allows access to the ports:

```bash
# Test standard SMTP port
telnet <your-server-public-ip> 25

# Test secure SMTP port
telnet <your-server-public-ip> 587
```

If successful, you'll see a connection establishment message. Press Ctrl+C to exit the telnet session.

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
After setting up your DNS, continue with configuring AliasVault to let it know which email domains it should support.

1. Run the email configuration script:
  ```bash
  ./install.sh configure-email
  ````
2. Follow the interactive prompts to:
    - Configure your domain(s)
    - Restart required services

3. Once configured, you can:
   - Create new aliases in the AliasVault client
   - Use your custom domain(s) for email addresses
     - Note: you can configure the default domain for new aliases in the AliasVault client in Menu > Settings > Email Settings > Default Email Domain
   - Start receiving emails on your aliases

{: .note }
Important: DNS propagation can take up to 24-48 hours. During this time, email delivery might be inconsistent.

If you encounter any issues, feel free to join the [Discord chat](https://discord.gg/DsaXMTEtpF) to get help from other users and maintainers.

### Optional: SMTP TLS (STARTTLS)

By default, SMTP TLS is disabled. This does NOT significantly impact email deliverability: most email providers will still deliver to your server. However, if you want to enable TLS for SMTP connections:

1. Manually obtain a TLS certificate for your mail hostname (e.g., `mail.example.com`) - (there is no install script helper for this yet)
2. Combine the certificate and private key into a single `.pem` file
3. Place the `.pem` file in the `./certificates/smtp/` directory
4. Edit your `.env` file and set `SMTP_TLS_ENABLED=true`
5. Restart the SMTP service: `./install.sh restart smtp`

{: .note }
If you have multiple mail domains, use a single certificate with Subject Alternative Names (SANs) covering all domains. If TLS is enabled but no valid certificate is found, the service will log a warning (visible in admin panel > general logs) and continue in non-TLS mode.

---

## 4. Configure Account Registration

By default, AliasVault is configured to allow public registration of new accounts. This means that anyone can create a new account on your server.

If you want to disable public registration, you can do so by running the install script with the `configure-registration` option and then choosing option 2.

```bash
./install.sh configure-registration
```

{: .note }
Disabling public registration means the ability to create new accounts in the AliasVault client is disabled for everyone, including administrators. Accounts cannot be created outside of the client because of the end-to-end encryption employed by AliasVault. So make sure you have created your own account(s) before disabling public registration.

---

## 5. Configure IP logging

By default, AliasVault is configured to log (anonymized) IP addressses for all authentication attempts. This is used to monitor and combat potential abuse. However for privacy reasons the last octet of the IP address is anonymized, e.g. the IP address `127.0.0.1` is logged as `127.0.0.xxx`. This is to prevent an IP address directly being linked to an individual person or household.

If you want to entirely disable IP logging, you can do so by running the install script with the `configure-ip-logging` option and then choosing option 2.

```bash
./install.sh configure-ip-logging
```

{: .note }
Disabling IP logging means the ability to monitor and track abusive users on your AliasVault server is disabled.

---

## 6. Troubleshooting

### Verbose output
If you need more detailed output from the install script, you can run it with the `--verbose` option. This will print more information to the console.
```bash
./install.sh install --verbose
```

### Troubleshooting guide
For more detailed troubleshooting information, please refer to the [troubleshooting guide](./troubleshooting.md).
