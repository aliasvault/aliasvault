---
layout: default
title: Troubleshooting
parent: Install Script
redirect_from:
  - /installation/troubleshooting
  - /installation/troubleshooting.html
nav_order: 5
---

# Troubleshooting

This guide covers common issues and troubleshooting steps for AliasVault encountered during installation, updates or general maintenance.

{: .toc }
* TOC
{:toc}

---

## Check Docker Container Status
For any issues you might encounter, the first step is to check the Docker containers health. This will give you a quick insight into the status of the individual containers which will help you identify the root cause of the issue.

1. List all running containers and their status (execute from the AliasVault installation directory):
```bash
docker compose ps
```

2. Check the logs of a specific container.
```
docker compose logs [container-name-here]]
```
> Possible container names: `api`, `postgres`, `client`, `admin`, `reverse-proxy`, `smtp`, `task-runner`

3. In order to restart a specific container, run the following command:
```bash
docker compose restart [container-name-here]
```

4. In order to restart the whole AliasVault stack, do not use docker compose directly, but run the following command instead. This makes sure the correct `docker-compose.yml` file is being used:
```bash
./install.sh restart
```

---

## Check AliasVault Text Logs
All AliasVault services log information and errors to text files. These files are located in the `logs` directory. You can check the logs of a specific service by running the following command:

```bash
cat logs/[service-name-here].txt
```

---

## Common Issues
Below are some common issues you might encounter and how to troubleshoot them.

### 1. Database Connection Issues

**Symptoms:**
- API, Admin, or SMTP services failing to start
- Database connection errors in logs

**Steps:**
1. Check if PostgreSQL container is running:
```bash
docker compose ps
```

2. Check the logs of the PostgreSQL container:
```bash
docker compose logs postgres
```

### 2. TLS/SSL Certificate Issues

**Symptoms:**
- Browser shows TLS/SSL errors

**Steps:**
1. Check the certbot container logs if TLS/SSL certificates are being correctly renewed:
```bash
docker compose logs certbot
```

2. Check the logs of the reverse-proxy container:
```bash
docker compose logs reverse-proxy
```

3. In case the SSL certificates are being correctly renewed, but the browser still shows TLS/SSL errors, try to restart AliasVault manually in order to force the NGINX container to reload the TLS/SSL certificates:
```bash
./install.sh restart
```

### 3. No emails being received
If you are not receiving emails on your aliases, check the following:
- Verify DNS records are correctly configured
- Ensure ports 25 and 587 are accessible
- Check your server's firewall settings
- Verify that your ISP/hosting provider allows SMTP traffic

Refer to the [installation guide](./#3-email-server-setup) for more information on how to configure your DNS records and ports.


### 4. Forgot AliasVault Admin Password
If you have lost your admin password, you can reset it by running the install script with the `reset-admin-password` option. This will generate a new random password and update the .env file with it. After that it will restart the AliasVault containers to apply the changes.

```bash
./install.sh reset-admin-password
```

---

## Other Issues
If you encounter any other issues not mentioned here and need help, please join our Discord server or create an issue on the GitHub repository and we will be happy to help you out.

Find all contact information on the contact page of our website: [https://www.aliasvault.net/contact](https://www.aliasvault.net/contact)