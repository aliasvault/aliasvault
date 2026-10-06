# ============================================
# Stage: Build core libraries
# ============================================
# Use BUILDPLATFORM to run on native arch instead of emulating arm64. WASM output is platform-independent.
FROM --platform=$BUILDPLATFORM rust:1-slim-trixie AS core-builder

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates clang llvm && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rustup target add wasm32-unknown-unknown && \
    cargo install wasm-pack --locked && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY core/ ./core/
RUN cd ./core && \
    chmod +x build-and-distribute.sh && \
    ./build-and-distribute.sh --web

# ============================================
# Stage: Build the web app
# ============================================
FROM --platform=$BUILDPLATFORM node:20-bookworm-slim AS build
WORKDIR /src

COPY --from=core-builder /src/core/ ./core/
COPY apps/web/ ./apps/web/

WORKDIR /src/apps/web
RUN npm ci --no-audit --no-fund && npm run build

# ============================================
# Stage: Serve with nginx
# ============================================
FROM nginx:1.31.0 AS final

LABEL org.opencontainers.image.source="https://github.com/aliasvault/aliasvault"
LABEL org.opencontainers.image.vendor="AliasVault"
LABEL org.opencontainers.image.licenses="AGPL-3.0"
LABEL org.opencontainers.image.title="AliasVault Client"
LABEL org.opencontainers.image.description="React web client UI for AliasVault. Part of multi-container setup and can be deployed via install.sh (see docs.aliasvault.com)"

WORKDIR /usr/share/nginx/html
COPY --from=build /src/apps/web/dist .
COPY apps/web/nginx.conf /etc/nginx/nginx.conf
COPY apps/web/entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/app/entrypoint.sh"]
