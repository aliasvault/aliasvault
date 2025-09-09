---
layout: default
title: Update
parent: Docker Compose
nav_order: 1
---

# Updating AliasVault
{: .no_toc }

<details open markdown="block">
  <summary>
    Table of contents
  </summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

## Before You Begin
You can see the latest available version of AliasVault on [GitHub](https://github.com/aliasvault/aliasvault/releases).

{: .warning }
Before updating, it's recommended to backup your database and other important data. You can do this by making
a copy of the `database` and `certificates` directories.

## Standard Update Process
For most version updates, you can use the standard update process. The container will automatically handle database migrations on startup:

1. Navigate to your AliasVault directory:
```bash
cd /path/to/your/aliasvault
```

2. Pull the latest Docker image:
```bash
docker compose pull
```

3. Restart the container with the new image:
```bash
docker compose down && docker compose up -d
```

## Version-Specific Upgrade Guides
While database migrations are automated, some releases may require manual file/config migration steps. Always check this page before updating to ensure you don't miss any required manual steps.

> Currently there are no version-specific manual migration steps required for the single container setup. Check back here when updating to ensure you haven't missed any new requirements.

## Additional Update Options

### Installing a Specific Version
If you need to install a specific version instead of the latest, you can do the following. Note: downgrading to a previous version is not officially supported and may lead to unexpected issues, as database schema changes may prevent older versions from working correctly.

1. Edit your `docker-compose.yml` file
2. Change the image tag from `:latest` to a specific version:
```yaml
# ...
image: ghcr.io/aliasvault/aliasvault:0.23.0  # Replace with desired version
# ... rest of configuration
```
3. Pull and restart:
```bash
docker compose pull
docker compose down && docker compose up -d
```
