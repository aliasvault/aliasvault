---
layout: default
title: Database Operations
parent: Advanced
grand_parent: Install Script
nav_order: 4
---

# Database Operations
This page explains how to import/export on the AliasVault server database via the `./install.sh` script.

## Database Export
In order to backup the AliasVault server database (which includes all encrypted user vaults as well), you can use the `install.sh` script. This streams a compressed export of the database to the file you redirect to, while the services keep running.

```bash
$ ./install.sh db-export > backup.sql.gz
```

### Fallback: export directly with Docker
If `./install.sh db-export` fails for any reason, you can also export the database directly with Docker, bypassing the install script entirely:

```bash
$ docker compose exec postgres pg_dump -U aliasvault aliasvault > backup.sql
```

To produce a compressed backup, pipe it through `gzip`:

```bash
$ docker compose exec postgres pg_dump -U aliasvault aliasvault | gzip > backup.sql.gz
```

## Database Import

To restore a previously exported database, you can use the `install.sh` script. This script will stop the dependent services, drop the database, import the database from a file, and then restart the services.

```bash
$ ./install.sh db-import < backup.sql.gz
```

### Fallback: import directly with Docker
If `./install.sh db-import` hangs or fails, you can restore the database directly with Docker. This drops the existing database, recreates it, and imports the backup.

{: .warning }
This will permanently delete the existing database before restoring. Make sure your backup file is valid first.

For a gzipped backup (`backup.sql.gz`):

```bash
$ docker compose stop api admin task-runner smtp && \
  docker compose exec postgres psql -U aliasvault postgres -c "DROP DATABASE IF EXISTS aliasvault;" && \
  docker compose exec postgres psql -U aliasvault postgres -c "CREATE DATABASE aliasvault OWNER aliasvault;" && \
  gunzip < backup.sql.gz | docker compose exec -T postgres psql -U aliasvault aliasvault && \
  docker compose restart api admin task-runner smtp reverse-proxy
```
