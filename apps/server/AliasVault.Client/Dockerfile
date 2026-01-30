FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS base
WORKDIR /app

# ============================================
# Stage: Build core libraries
# ============================================
# Use BUILDPLATFORM to run on native arch (amd64) instead of emulating arm64.
# WASM output is platform-independent, so we only need to build once.
FROM --platform=$BUILDPLATFORM rust:1-slim-bookworm AS core-builder

# Install Node.js and wasm-pack (Rust already included in base image)
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rustup target add wasm32-unknown-unknown && \
    cargo install wasm-pack --locked && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /src

# Copy core library source files
COPY core/ ./core/

# Build core libraries (only browser target needed for Blazor WASM client)
RUN cd ./core && \
    chmod +x build-and-distribute.sh && \
    ./build-and-distribute.sh --browser

# ============================================
# Stage: Build .NET application
# ============================================
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:9.0 AS build
ARG TARGETARCH
ARG BUILD_CONFIGURATION=Release
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1
ENV MSBUILDDEBUGPATH=/src/msbuild-logs
WORKDIR /src

# Create the debug directory
RUN mkdir -p /src/msbuild-logs

# Install Python (required by WebAssembly tools) and Node.js (required by JS bundler)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install the WebAssembly tools with correct dotnet version auto-detected from apps/server folder.
WORKDIR /src/apps/server
RUN dotnet workload install wasm-tools

# Copy all project files
COPY apps/server /src

# Copy built core libraries from core-builder stage
COPY --from=core-builder /src/core/ /src-core/

# Copy Rust WASM output to wwwroot/wasm/
RUN mkdir -p /src/AliasVault.Client/wwwroot/wasm && \
    cp /src-core/rust/dist/wasm/aliasvault_core_bg.wasm /src/AliasVault.Client/wwwroot/wasm/ && \
    cp /src-core/rust/dist/wasm/aliasvault_core.js /src/AliasVault.Client/wwwroot/wasm/

# Copy TypeScript core packages (identity-generator, password-generator, vault) to wwwroot/js/dist/core/
RUN mkdir -p /src/AliasVault.Client/wwwroot/js/dist/core/identity-generator && \
    mkdir -p /src/AliasVault.Client/wwwroot/js/dist/core/password-generator && \
    mkdir -p /src/AliasVault.Client/wwwroot/js/dist/core/vault && \
    cp -r /src-core/typescript/identity-generator/dist/* /src/AliasVault.Client/wwwroot/js/dist/core/identity-generator/ && \
    cp -r /src-core/typescript/password-generator/dist/* /src/AliasVault.Client/wwwroot/js/dist/core/password-generator/ && \
    cp -r /src-core/vault/dist/* /src/AliasVault.Client/wwwroot/js/dist/core/vault/

# Build the Client project
WORKDIR "/src/AliasVault.Client"
RUN dotnet build "AliasVault.Client.csproj" \
    -c "$BUILD_CONFIGURATION" \
    -o /app/build \
    -a "$TARGETARCH"

# Publish the Client project
FROM build AS publish
ARG BUILD_CONFIGURATION=Release
ARG TARGETARCH
RUN dotnet publish "AliasVault.Client.csproj" \
    -c "$BUILD_CONFIGURATION" \
    -a "$TARGETARCH" \
    --no-restore \
    -o /app/publish \
    /p:UseAppHost=false \
    /p:WasmNativeStrip=false \
    /p:EmccInitialHeapSize=268435456

# Final stage
FROM nginx:1.24.0 AS final

# OCI Image Labels
LABEL org.opencontainers.image.source="https://github.com/aliasvault/aliasvault"
LABEL org.opencontainers.image.vendor="AliasVault"
LABEL org.opencontainers.image.licenses="AGPL-3.0"
LABEL org.opencontainers.image.title="AliasVault Client"
LABEL org.opencontainers.image.description="Blazor WebAssembly client UI for AliasVault. Part of multi-container setup and can be deployed via install.sh (see docs.aliasvault.net)"

WORKDIR /usr/share/nginx/html
COPY --from=publish /app/publish/wwwroot .
COPY /apps/server/AliasVault.Client/nginx.conf /etc/nginx/nginx.conf
COPY /apps/server/AliasVault.Client/entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh

EXPOSE 3000
ENV ASPNETCORE_URLS=http://+:3000
ENTRYPOINT ["/app/entrypoint.sh"]
