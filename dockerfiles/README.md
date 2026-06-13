# AliasVault Dockerfiles

This folder contains alternative Docker configurations for AliasVault deployment scenarios beyond the standard multi-container setup.

## Files

### `docker-compose.all-in-one.yml`
This is a all-in-one single-container build of the AliasVault server stack for easy self-hosting, using s6-overlay to run multiple services (database, API, web, smtp, task runner) in one container.

This build is primarily intended for platforms with **limited management** such like NAS devices, Unraid, or other **small home-use scenarios** where simplicity is preferred over flexibility. All configuration is abstracted away as much as possible. You only need to start this one container and most settings will be auto-initialized for you during the container startup.

> **Note:** For more advanced setups and production purposes, we recommend using the default multi-container configuration available via [`../docker-compose.yml`](../docker-compose.yml).

### `docker-compose.build.yml`
Used to locally build Docker images from source instead of retrieving pre-built images from GitHub Container Registry. Automatically used when running `./install.sh build`.

### `docker-compose.dev.yml`
Contains containers for aiding in local development of AliasVault. Provides a separate PostgreSQL instance for development (port 5109 by default), managed via `./scripts/dev.sh`.

## Usage

- **Standard deployment**: `./install.sh install` (uses multi-container setup and ../docker-compose.yml)
- **Build from source**: `./install.sh build` (uses docker-compose.build.yml)
- **Development database**: `./scripts/dev.sh db-start` (and `db-stop`)
- **Single container**: Deploy with `docker-compose.all-in-one.yml`