# All-in-One Docker Image

This folder contains a Dockerfile that bundles all AliasVault services into a single container. This all-in-one docker image is published to Docker registries as `aliasvault/aliasvault`, where the multi-docker container images are published as their individual parts like `aliasvault/client`, `aliasvault/api`, `aliasvault/postgres` etc.

### Quick Start - Build and Run Locally

#### 1. Build the Image

```bash
# Build the all-in-one image (from repo root)
docker build -f dockerfiles/all-in-one/Dockerfile -t aliasvault-allinone:local .
```

#### 2. Run the Container

```bash
# Basic run
docker run -d \
  --name aliasvault \
  -p 80:80 \
  -v ./database:/database \
  -v ./logs:/logs \
  -v ./secrets:/secrets \
  aliasvault-allinone:local
```

#### 3. Access Services

- **Client**: http://localhost
- **Admin**: http://localhost/admin
- **API**: http://localhost/api

### Test & Debug

```bash
# View container logs
docker logs aliasvault

# Access container shell
docker exec -it aliasvault /bin/bash
```
