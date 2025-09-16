#!/bin/sh

# Create SSL directory if it doesn't exist
mkdir -p /etc/nginx/ssl

# Select the appropriate nginx configuration based on FORCE_HTTPS_REDIRECT
# Default to true (nginx-443.conf) for backward compatibility
# Only disable redirect if explicitly set to "false"
if [ "${FORCE_HTTPS_REDIRECT:-true}" = "false" ]; then
    echo "Using nginx-80-443.conf (HTTP and HTTPS without redirect)"
    cp /etc/nginx/nginx-80-443.conf /etc/nginx/nginx.conf
else
    echo "Using nginx-443.conf (HTTP to HTTPS redirect enabled - default)"
    cp /etc/nginx/nginx-443.conf /etc/nginx/nginx.conf
fi

# Function to check if certificate needs regeneration
needs_cert_regeneration() {
    # If cert doesn't exist, need to generate
    if [ ! -f /etc/nginx/ssl/cert.pem ] || [ ! -f /etc/nginx/ssl/key.pem ]; then
        return 0
    fi

    # Check if we have a hostname marker file
    if [ -f /etc/nginx/ssl/.hostname_marker ]; then
        STORED_HOSTNAME=$(cat /etc/nginx/ssl/.hostname_marker)
        if [ "$STORED_HOSTNAME" != "${HOSTNAME:-localhost}" ]; then
            echo "Hostname changed from '$STORED_HOSTNAME' to '${HOSTNAME:-localhost}', regenerating certificate..."
            return 0
        fi
    else
        # No marker file, regenerate to be safe
        return 0
    fi

    return 1
}

# Function to check if a string is an IP address (IPv4 or IPv6)
is_ip_address() {
    local value="$1"

    # Check for IPv4 pattern
    if echo "$value" | grep -qE '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
        # Validate each octet is <= 255
        local valid=1
        # Use a simple approach to split the IP address
        local o1=$(echo "$value" | cut -d. -f1)
        local o2=$(echo "$value" | cut -d. -f2)
        local o3=$(echo "$value" | cut -d. -f3)
        local o4=$(echo "$value" | cut -d. -f4)
        for octet in "$o1" "$o2" "$o3" "$o4"; do
            if [ "$octet" -gt 255 ]; then
                valid=0
                break
            fi
        done
        if [ "$valid" -eq 1 ]; then
            return 0  # It's a valid IPv4
        fi
    fi

    # Check for IPv6 pattern (simplified check)
    if echo "$value" | grep -qE '^([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}$|^::1$|^::$'; then
        return 0  # It's likely IPv6
    fi

    return 1  # Not an IP address
}

# Generate self-signed SSL certificate if not exists or hostname changed
if needs_cert_regeneration; then
    echo "Generating new SSL certificate (10 years validity)..."

    HOSTNAME_VALUE="${HOSTNAME:-localhost}"

    if [ "$HOSTNAME_VALUE" = "localhost" ] || [ -z "$HOSTNAME_VALUE" ]; then
        # Default localhost-only configuration
        openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
            -keyout /etc/nginx/ssl/key.pem \
            -out /etc/nginx/ssl/cert.pem \
            -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
    else
        # Determine if the hostname is an IP address or a DNS name
        if is_ip_address "$HOSTNAME_VALUE"; then
            # It's an IP address - use IP: prefix in SAN
            SAN_ENTRY="IP:${HOSTNAME_VALUE}"
            echo "Detected IP address: ${HOSTNAME_VALUE}"
        else
            # It's a DNS name - use DNS: prefix in SAN
            SAN_ENTRY="DNS:${HOSTNAME_VALUE}"
            echo "Detected hostname: ${HOSTNAME_VALUE}"
        fi

        # Generate certificate with the appropriate SAN entry
        openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
            -keyout /etc/nginx/ssl/key.pem \
            -out /etc/nginx/ssl/cert.pem \
            -subj "/C=US/ST=State/L=City/O=AliasVault/CN=${HOSTNAME_VALUE}" \
            -addext "subjectAltName=${SAN_ENTRY},DNS:localhost,IP:127.0.0.1"
    fi

    # Set proper permissions
    chmod 644 /etc/nginx/ssl/cert.pem
    chmod 600 /etc/nginx/ssl/key.pem

    # Store current hostname for change detection
    echo "${HOSTNAME:-localhost}" > /etc/nginx/ssl/.hostname_marker
    chmod 644 /etc/nginx/ssl/.hostname_marker
fi

# Create the appropriate SSL configuration based on LETSENCRYPT_ENABLED
if [ "${LETSENCRYPT_ENABLED}" = "true" ]; then
    cat > /etc/nginx/ssl.conf << EOF
    ssl_certificate /etc/nginx/ssl-letsencrypt/live/${HOSTNAME}/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl-letsencrypt/live/${HOSTNAME}/privkey.pem;
EOF
else
    cat > /etc/nginx/ssl.conf << EOF
    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
EOF
fi

# Start nginx and check if it started successfully
nginx
if [ $? -ne 0 ]; then
    echo "Failed to start nginx, exiting..."
    exit 1
fi

# Start certificate watcher if Let's Encrypt is enabled
if [ "${LETSENCRYPT_ENABLED}" = "true" ]; then
    echo "Starting certificate watcher for automatic nginx reload..."

    # Watch for changes and reload nginx
    while true; do
        # Watch the entire Let's Encrypt live directory for any certificate changes
        inotifywait -e modify,create,delete,move -r /etc/nginx/ssl-letsencrypt 2>/dev/null

        # Wait a moment for all certificate files to be written
        sleep 2

        echo "Certificate change detected, reloading nginx..."
        nginx -s reload 2>&1
    done &
fi

# Keep the container running and monitor nginx
while true; do
    if ! pgrep nginx > /dev/null; then
        echo "Nginx is not running, exiting..."
        exit 1
    fi
    sleep 10
done
