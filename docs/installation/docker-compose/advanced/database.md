---
layout: default
title: Database Operations
parent: Advanced
grand_parent: Docker Compose
nav_order: 4
---

# Database Operations
This page explains how to import/export on the AliasVault server database via Docker commands.

## Database Export
In order to backup the AliasVault server database (which includes all encrypted user vaults as well), you can use the following command. Run this command from the directory where your AliasVault `docker-compose.yml` is located.

```bash
$ docker compose exec aliasvault pg_dump -U aliasvault aliasvault > backup.sql
```

## Database Import

To restore a previously exported database, you can use the following snippet. Run these commands from the directory where your AliasVault `docker-compose.yml` is located.

```bash
# Drop database first (warning: this can't be undone!)
docker compose exec -T aliasvault psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS aliasvault WITH (FORCE);"

# Create new empty database
docker compose exec -T aliasvault psql -U postgres -d postgres -c "CREATE DATABASE aliasvault OWNER aliasvault;"

# Import backup
docker compose exec -T aliasvault psql -U aliasvault aliasvault < backup.sql
```
