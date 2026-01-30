FROM mcr.microsoft.com/dotnet/runtime:10.0-alpine AS base
WORKDIR /app

FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
ARG TARGETARCH
ARG BUILD_CONFIGURATION=Release
WORKDIR /src

# Copy all project files
COPY apps/server .

# Build and publish the application
WORKDIR "/src/Services/AliasVault.SmtpService"
RUN dotnet publish "./AliasVault.SmtpService.csproj" -c "$BUILD_CONFIGURATION" \
    -a "$TARGETARCH" \
    -o /app/publish \
    /p:UseAppHost=false

FROM base AS final

# OCI Image Labels
LABEL org.opencontainers.image.source="https://github.com/aliasvault/aliasvault"
LABEL org.opencontainers.image.vendor="AliasVault"
LABEL org.opencontainers.image.licenses="AGPL-3.0"
LABEL org.opencontainers.image.title="AliasVault SMTP Service"
LABEL org.opencontainers.image.description="SMTP service for email alias functionality in AliasVault. Part of multi-container setup and can be deployed via install.sh (see docs.aliasvault.net)"

WORKDIR /app
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "AliasVault.SmtpService.dll"]
