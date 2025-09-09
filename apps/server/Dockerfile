FROM nginx:alpine

# OCI Image Labels
LABEL org.opencontainers.image.source="https://github.com/aliasvault/aliasvault"
LABEL org.opencontainers.image.vendor="AliasVault"
LABEL org.opencontainers.image.licenses="AGPL-3.0"
LABEL org.opencontainers.image.title="AliasVault Reverse Proxy"
LABEL org.opencontainers.image.description="Nginx reverse proxy for AliasVault. Part of multi-container setup and can be deployed via install.sh (see docs.aliasvault.net)"

# Install OpenSSL and inotify-tools for certificate watching
RUN apk add --no-cache openssl inotify-tools

# Copy configuration and entrypoint script
COPY apps/server/nginx.conf /etc/nginx/nginx.conf
COPY apps/server/status.html /usr/share/nginx/html/status.html
COPY apps/server/entrypoint.sh /docker-entrypoint.sh

# Create SSL directory
RUN mkdir -p /etc/nginx/ssl && chmod 755 /etc/nginx/ssl \
    && chmod +x /docker-entrypoint.sh

EXPOSE 80 443
ENTRYPOINT ["/docker-entrypoint.sh"]
