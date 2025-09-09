---
layout: default
title: Build from Source
parent: Advanced
grand_parent: Install Script
nav_order: 3
---

# Build from Source
Instead of using the pre-built Docker images, you can also build the images from source yourself. This allows you to build a specific version of AliasVault and/or to make changes to the source code.

Building from source requires more resources:
- Minimum 4GB RAM (more RAM will speed up build time)
- At least 1 vCPU
- 40GB+ disk space (for dependencies and build artifacts)
- Docker installed
- Git installed

## Steps
1. Clone the repository
```bash
$ git clone https://github.com/aliasvault/aliasvault.git
$ cd aliasvault
```
2. Make the build script executable and run it. This will create the .env file, build the Docker images locally from source, and start the AliasVault containers. Follow the on-screen prompts to configure AliasVault.
```bash
$ chmod +x install.sh
$ ./install.sh build
```
> **Note:** The complete build process can take a while depending on your hardware (5-15 minutes).

3.  After the script completes, you can access AliasVault at:
  - Client: `https://localhost`
  - Admin: `https://localhost/admin`
