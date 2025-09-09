---
layout: default
title: Database operations
parent: Development
grand_parent: Miscellaneous
nav_order: 3
---

# Database operations
This article contains tips for how to work with the AliasVault PostgreSQL database in both production and development environments.

## Using install.sh helper methods (recommended)
The `install.sh` script contains helper methods that makes it easy to export and import databases with a simple single command.


### Export database
```bash
# Export from normal database container (port 5432, production)
./install.sh db-export > aliasvault-db-export.sql.gz

# Export from dev database container (port 5433, development)
./install.sh db-export --dev > aliasvault-db-export.sql.gz
```

### Import database
```bash
# Import to normal database container (port 5432, production)
./install.sh db-import < aliasvault-db-export.sql.gz

# Import to dev database container (port 5433, development)
./install.sh db-import --dev < aliasvault-db-export.sql.gz
```

> Tip: you can also use the optional parameters `--yes` (to skip confirmation prompt) and `--verbose` (to get more output on what the operation is doing).

---

## Using docker commands
Instead of using the `install.sh script, you can also use manual Docker commands.

### Backup database to file
To backup the database to a file, you can use the following command:

```bash
docker compose exec postgres pg_dump -U aliasvault aliasvault | gzip > aliasvault.sql.gz
```

### Import database from file
To drop the existing database and restore the database from a file, you can use the following command:

{: .warning }
Executing this command will drop the existing database and restore the database from the file. Make sure to have a backup of the existing database before running this command.

```bash
docker compose exec postgres psql -U aliasvault postgres -c "DROP DATABASE aliasvault;" && \
docker compose exec postgres psql -U aliasvault postgres -c "CREATE DATABASE aliasvault;" && \
gunzip < aliasvault.sql.gz | docker compose exec -iT postgres psql -U aliasvault aliasvault
```

### Change master password
By default during initial installation the PostgreSQL master password is set to a random string that is stored in the `./secrets/postgres_password` secret file.

If you wish to change the master password, you can do so by running the following command:

1. Open a terminal and navigate to the root of the AliasVault repository.
2. Run the following command to connect to the PostgreSQL container:
    ```bash
    docker compose exec -it postgres psql -U aliasvault -d aliasvault
    ```
3. Once connected to the database, you can change the master password by running the following command:
    ```sql
    ALTER USER aliasvault WITH PASSWORD 'new_password';
    ```
4. Press Enter to confirm the changes.
5. Exit the PostgreSQL shell by running `\q`.
6. Manually update the `./secrets/postgres_password` secret file contents with the new password.
7. Restart the AliasVault containers by running the following command:
    ```bash
    docker compose restart
    ```
