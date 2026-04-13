---
layout: default
title: Troubleshooting
parent: Docker Compose
nav_order: 3
---

# Troubleshooting

This guide covers common issues and troubleshooting steps for AliasVault encountered during installation, updates or general maintenance.

{: .toc }
* TOC
{:toc}

---

## Check Docker Container Status

For any issues you might encounter, the first step is to check the Docker container health. This will give you a quick insight into the status of the container which will help you identify the root cause of the issue.

**1. Check the Docker container running status:**

```bash
docker compose ps
```

**2. Check the Docker container logs:**

```bash
docker compose logs
```

**3. Try restarting the Docker container:**

```bash
docker compose restart
```

---

## Check AliasVault Text Logs

All AliasVault services log information and errors to text files. These files are located in the `logs` directory within your AliasVault installation folder.

**View logs for a specific service:**

```bash
cat logs/[service-name].txt
```

**View PostgreSQL logs:**

```bash
cat logs/postgres/postgres.log
```

If PostgreSQL failed during initialization, also check:

```bash
cat logs/postgres/initdb.log
```

---

## Common Issues

Below are some common issues you might encounter and how to troubleshoot them.

### 1. PostgreSQL fails to start

**Symptoms:**
- Container fails to start or keeps restarting
- Error messages about database connection failures
- Services unable to connect to the database

**Steps:**

1. Check the PostgreSQL logs for error details:
```bash
cat logs/postgres/postgres.log
```

2. If PostgreSQL failed during initialization, check the init logs:
```bash
cat logs/postgres/initdb.log
```

3. **Permission errors:** If you see permission-related errors, ensure the `database` folder has correct permissions for the user running the Docker container.

4. **Corrupted database:** If the database appears corrupted, you may need to reinitialize it. **Warning:** This will delete all data:

```bash
# Stop containers first
docker compose down

# Remove the postgres data directory
sudo rm -rf database/postgres/

# Restart containers (will reinitialize the database)
docker compose up -d
```

### 2. No emails being received

**Symptoms:**
- Aliases not receiving any emails
- Emails to aliases bounce or timeout

**Steps:**

1. Verify DNS records are correctly configured
2. Ensure ports 25 and 587 are accessible from the internet
3. Check your server's firewall settings
4. Verify that your ISP/hosting provider allows SMTP traffic and does not block port 25

Refer to the [installation guide](./#3-email-server-setup) for more information on how to configure your DNS records and ports.

### 3. Admin app not working via your own reverse proxy

**Symptoms:**
- Errors after logging into the Admin panel
- Page loads but becomes unresponsive
- WebSocket connection errors in browser console

**Solution:**

If you're accessing the Admin page through your own reverse proxy, ensure the Upgrade header is allowed and forwarded. This is required because the Admin app uses WebSockets for client-server communication.

For nginx, add the following to your configuration:

```nginx
# Add WebSocket support for Blazor server
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_read_timeout 86400;
```

### 4. Forgot AliasVault admin password

**Solution:**

You can reset the admin password by running the `aliasvault reset-admin-password` command. This will generate a new random password and update the secret.

1. SSH into the aliasvault container:
```bash
docker compose exec -it aliasvault /bin/bash
```

2. Run the reset-admin-password script:
```bash
aliasvault reset-admin-password
```

3. Note the password displayed, then exit the SSH session (`Ctrl+C` or type `exit`) and restart the container:
```bash
docker compose restart
```

4. You can now log in to the admin panel (`/admin`) with the new password.

---

## Other Issues

If you encounter any other issues not mentioned here and need help, please join our Discord server or create an issue on the GitHub repository and we will be happy to help you out.

Find all contact information on the contact page of our website: [https://www.aliasvault.net/contact](https://www.aliasvault.net/contact)