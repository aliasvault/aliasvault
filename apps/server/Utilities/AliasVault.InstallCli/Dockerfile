FROM mcr.microsoft.com/dotnet/runtime:10.0-alpine AS base
WORKDIR /app

FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
ARG TARGETARCH
ARG BUILD_CONFIGURATION=Release
WORKDIR /apps/server

# Copy the entire source code
COPY . .

# Build and publish in one step
RUN dotnet publish "apps/server/Utilities/AliasVault.InstallCli/AliasVault.InstallCli.csproj" \
    -c "$BUILD_CONFIGURATION" \
    -a "$TARGETARCH" \
    -o /app/publish \
    /p:UseAppHost=false

FROM base AS final

# OCI Image Labels
LABEL org.opencontainers.image.source="https://github.com/aliasvault/aliasvault"
LABEL org.opencontainers.image.vendor="AliasVault"
LABEL org.opencontainers.image.licenses="AGPL-3.0"
LABEL org.opencontainers.image.title="AliasVault Install CLI"
LABEL org.opencontainers.image.description="Installation and configuration CLI for AliasVault. Used by install.sh for setup and configuration, not deployed as part of the application stack"

WORKDIR /app
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "AliasVault.InstallCli.dll"]
