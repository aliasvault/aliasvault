FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
ARG TARGETARCH
ARG BUILD_CONFIGURATION=Release
WORKDIR /src

# Copy all project files
COPY apps/server .

# Build and publish the application
WORKDIR "/src/Services/AliasVault.TaskRunner"
RUN dotnet publish "./AliasVault.TaskRunner.csproj" \
    -c "$BUILD_CONFIGURATION" \
    -a "$TARGETARCH" \
    -o /app/publish \
    /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/runtime:10.0-alpine AS final

# OCI Image Labels
LABEL org.opencontainers.image.source="https://github.com/aliasvault/aliasvault"
LABEL org.opencontainers.image.vendor="AliasVault"
LABEL org.opencontainers.image.licenses="AGPL-3.0"
LABEL org.opencontainers.image.title="AliasVault TaskRunner"
LABEL org.opencontainers.image.description="Background task runner for AliasVault. Part of multi-container setup and can be deployed via install.sh (see docs.aliasvault.net)"

# Install Kerberos libraries to prevent .NET 10 GSSAPI warnings
RUN apk add --no-cache krb5-libs

WORKDIR /app
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "AliasVault.TaskRunner.dll"]
