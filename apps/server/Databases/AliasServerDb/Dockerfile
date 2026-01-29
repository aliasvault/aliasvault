FROM postgres:16-alpine

# OCI Image Labels
LABEL org.opencontainers.image.source="https://github.com/aliasvault/aliasvault"
LABEL org.opencontainers.image.vendor="AliasVault"
LABEL org.opencontainers.image.licenses="AGPL-3.0"
LABEL org.opencontainers.image.title="AliasVault PostgreSQL"
LABEL org.opencontainers.image.description="PostgreSQL database for AliasVault. Part of multi-container setup and can be deployed via install.sh (see docs.aliasvault.net)"

# Install pigz for parallel compression during database exports
RUN apk add --no-cache pigz

# Add custom PostgreSQL configuration
COPY apps/server/Databases/AliasServerDb/postgresql.conf /etc/postgresql/postgresql.conf

# Define database name and username
ENV POSTGRES_DB=aliasvault
ENV POSTGRES_USER=aliasvault

CMD ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]