# Multi-stage build for AliasVault single container deployment

# ============================================
# Stage 1: Build .NET applications
# ============================================
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS dotnet-builder

# Install Python (required for WASM compilation)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /src

# Copy all source files
COPY apps/server/ ./apps/server/
COPY shared/ ./shared/

# Install required .NET workloads and restore packages once for the entire solution
WORKDIR /src/apps/server

# Install workloads and restore packages once for the entire solution
RUN dotnet workload install wasm-tools && \
    dotnet restore aliasvault.sln

# Build each application in separate layers to avoid lock contention

# Build API
RUN dotnet publish AliasVault.Api/AliasVault.Api.csproj \
        -c Release -o /app/api --no-restore

# Build Client (contains WASM which can be slow)
RUN dotnet publish AliasVault.Client/AliasVault.Client.csproj \
        -c Release -o /app/client --no-restore

# Build Admin
RUN dotnet publish AliasVault.Admin/AliasVault.Admin.csproj \
        -c Release -o /app/admin --no-restore

# Build SMTP Service
RUN dotnet publish Services/AliasVault.SmtpService/AliasVault.SmtpService.csproj \
        -c Release -o /app/smtp --no-restore

# Build Task Runner
RUN dotnet publish Services/AliasVault.TaskRunner/AliasVault.TaskRunner.csproj \
        -c Release -o /app/taskrunner --no-restore

# Build Install CLI
RUN dotnet publish Utilities/AliasVault.InstallCli/AliasVault.InstallCli.csproj \
        -c Release -o /app/installcli --no-restore

# Clean up .NET debug files and unnecessary files
RUN find /app -name "*.pdb" -delete && \
    find /app -name "*.xml" -not -name "*.deps.json" -delete && \
    find /app -name "*.Development.json" -delete && \
    find /app -name "web.config" -delete

# ============================================
# Stage 2: Download s6-overlay separately
# ============================================
FROM alpine:3.19 AS s6-downloader
ARG S6_OVERLAY_VERSION=3.2.0.2
RUN wget https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz && \
    wget https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-x86_64.tar.xz

# ============================================
# Stage 3: Final runtime image
# ============================================
FROM mcr.microsoft.com/dotnet/aspnet:10.0-bookworm-slim

# OCI Image Labels
LABEL org.opencontainers.image.source="https://github.com/aliasvault/aliasvault"
LABEL org.opencontainers.image.vendor="AliasVault"
LABEL org.opencontainers.image.licenses="AGPL-3.0"
LABEL org.opencontainers.image.title="AliasVault All-in-One"
LABEL org.opencontainers.image.description="Self-contained AliasVault server including web app, with all services bundled using s6-overlay. Single container solution for easy deployment (see docs.aliasvault.net)."

# Copy s6-overlay from downloader stage
COPY --from=s6-downloader /*.tar.xz /tmp/

# Install everything in one layer with optimizations
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        wget \
        ca-certificates \
        gnupg \
        lsb-release && \
    wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql-archive-keyring.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/postgresql-archive-keyring.gpg] http://apt.postgresql.org/pub/repos/apt/ $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        nginx-light \
        postgresql-16 \
        postgresql-client-16 \
        openssl \
        curl \
        xz-utils \
        netcat-openbsd \
        gettext-base \
        locales && \
    apt-mark hold postgresql-16 postgresql-client-16 && \
    # Create postgres user and configure locale
    useradd -r -s /bin/bash -d /var/lib/postgresql postgres 2>/dev/null || true && \
    sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && \
    locale-gen && \
    # Extract s6-overlay
    tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz && \
    tar -C / -Jxpf /tmp/s6-overlay-x86_64.tar.xz && \
    rm /tmp/s6-overlay-*.tar.xz && \
    # Clean up package manager files ONLY (preserve all PostgreSQL files)
    apt-get clean && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/* \
           /usr/share/doc/* \
           /usr/share/man/* \
           /usr/share/info/* \
           /var/cache/apt/* && \
    # Create all required directories
    mkdir -p \
        /app/api \
        /app/client \
        /app/admin \
        /app/smtp \
        /app/taskrunner \
        /app/installcli \
        /database \
        /logs/postgres \
        /var/run/postgresql \
        /etc/s6-overlay/s6-rc.d/user/contents.d

# Copy built applications and all configuration files from builder stage
COPY --from=dotnet-builder /app /app

# Copy all scripts from scripts directory to /usr/local/bin
COPY dockerfiles/all-in-one/scripts/ /usr/local/bin/
COPY apps/server/AliasVault.Client/nginx.conf /app/client/nginx.conf
COPY dockerfiles/all-in-one/config/nginx-80-443.conf /etc/nginx/nginx-80-443.conf
COPY dockerfiles/all-in-one/config/nginx-443.conf /etc/nginx/nginx-443.conf
COPY apps/server/status.html /usr/share/nginx/html/status.html
COPY dockerfiles/all-in-one/s6-scripts /etc/s6-overlay/s6-rc.d/

# Copy InstallCLI to /usr/local/bin and configure everything
RUN cp -r /app/installcli /usr/local/bin/aliasvault-cli && \
    chmod +x /usr/local/bin/aliasvault-cli/AliasVault.InstallCli && \
    ln -s /usr/local/bin/aliasvault-cli/AliasVault.InstallCli /usr/local/bin/aliasvault-cli.sh && \
    # Make all scripts executable and create symlinks without .sh extension
    for script in /usr/local/bin/*.sh; do \
        if [ -f "$script" ]; then \
            chmod +x "$script" && \
            basename="$(basename "$script" .sh)" && \
            ln -sf "$script" "/usr/local/bin/$basename"; \
        fi; \
    done && \
    find /etc/s6-overlay/s6-rc.d -type f \( -name "run" -o -name "up" -o -name "script" \) -exec chmod +x {} \; && \
    cd /etc/s6-overlay/s6-rc.d/user/contents.d && \
    touch init postgres api client admin smtp taskrunner nginx notification && \
    # Remove InstallCLI from /app since we copied it to /usr/local/bin
    rm -rf /app/installcli

# Set environment variables
ENV ALIASVAULT_VERBOSITY=0 \
    PUBLIC_REGISTRATION_ENABLED=true \
    IP_LOGGING_ENABLED=true \
    SUPPORT_EMAIL="" \
    PRIVATE_EMAIL_DOMAINS="" \
    HOSTNAME=localhost \
    POSTGRES_HOST=localhost \
    POSTGRES_PORT=5432 \
    POSTGRES_USER=aliasvault \
    POSTGRES_DATABASE=aliasvault \
    FORCE_HTTPS_REDIRECT=false \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0 \
    S6_VERBOSITY=0

EXPOSE 80 443 25 587
VOLUME ["/database", "/logs", "/secrets"]
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD curl -f http://localhost/api || exit 1
ENTRYPOINT ["/init"]