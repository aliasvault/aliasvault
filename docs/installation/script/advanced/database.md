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
In order to backup the AliasVault server database (which includes all encrypted user vaults as well), you can use the `install.sh` script. This script will stop all services, export the database to a file, and then restart the services.

```bash
$ ./install.sh db-export > backup.sql.gz
```

## Database Import

To restore a previously exported database, you can use the `install.sh` script. This script will stop all services, drop the database, import the database from a file, and then restart the services.

```bash
$ ./install.sh db-import < backup.sql.gz
```
