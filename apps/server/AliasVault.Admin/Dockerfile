FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS base
WORKDIR /app
EXPOSE 3002

FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG TARGETARCH
ARG BUILD_CONFIGURATION=Release
WORKDIR /src

# Copy all project files
COPY apps/server .

# Build and publish the application
WORKDIR "/src/AliasVault.Admin"
RUN dotnet publish "./AliasVault.Admin.csproj" \
    -c "$BUILD_CONFIGURATION" \
    -a "$TARGETARCH" \
    -o /app/publish \
    /p:UseAppHost=false

FROM base AS final

# OCI Image Labels
LABEL org.opencontainers.image.source="https://github.com/aliasvault/aliasvault"
LABEL org.opencontainers.image.vendor="AliasVault"
LABEL org.opencontainers.image.licenses="AGPL-3.0"
LABEL org.opencontainers.image.title="AliasVault Admin"
LABEL org.opencontainers.image.description="Admin portal for AliasVault. Part of multi-container setup and can be deployed via install.sh (see docs.aliasvault.net)"

WORKDIR /app
COPY --from=build /app/publish .

ENV ASPNETCORE_URLS=http://+:3002
ENV ASPNETCORE_PATHBASE=/admin
ENTRYPOINT ["dotnet", "AliasVault.Admin.dll"]
