FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
ARG TARGETARCH
ARG BUILD_CONFIGURATION=Release
WORKDIR /src

# Copy all project files
COPY apps/server .

# Build and publish the application
WORKDIR "/src/AliasVault.Api"
RUN dotnet publish "./AliasVault.Api.csproj" \
    -c "$BUILD_CONFIGURATION" \
    -a "$TARGETARCH" \
    -o /app/publish \
    /p:UseAppHost=false

# Final stage
FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine AS final

# OCI Image Labels
LABEL org.opencontainers.image.source="https://github.com/aliasvault/aliasvault"
LABEL org.opencontainers.image.vendor="AliasVault"
LABEL org.opencontainers.image.licenses="AGPL-3.0"
LABEL org.opencontainers.image.title="AliasVault API"
LABEL org.opencontainers.image.description="REST API backend for AliasVault. Part of multi-container setup and can be deployed via install.sh (see docs.aliasvault.net)"

WORKDIR /app
COPY --from=build /app/publish .

ENV ASPNETCORE_URLS=http://+:3001
ENV ASPNETCORE_PATHBASE=/api
ENTRYPOINT ["dotnet", "AliasVault.Api.dll"]
