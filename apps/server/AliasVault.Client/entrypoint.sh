#!/bin/sh
# Set the default values
DEFAULT_PRIVATE_EMAIL_DOMAINS=""
DEFAULT_HIDDEN_PRIVATE_EMAIL_DOMAINS=""
DEFAULT_SUPPORT_EMAIL=""
DEFAULT_PUBLIC_REGISTRATION_ENABLED="true"

# Use the provided environment variables if they exist, otherwise use defaults
PRIVATE_EMAIL_DOMAINS=${PRIVATE_EMAIL_DOMAINS:-$DEFAULT_PRIVATE_EMAIL_DOMAINS}
HIDDEN_PRIVATE_EMAIL_DOMAINS=${HIDDEN_PRIVATE_EMAIL_DOMAINS:-$DEFAULT_HIDDEN_PRIVATE_EMAIL_DOMAINS}
SUPPORT_EMAIL=${SUPPORT_EMAIL:-$DEFAULT_SUPPORT_EMAIL}
PUBLIC_REGISTRATION_ENABLED=${PUBLIC_REGISTRATION_ENABLED:-$DEFAULT_PUBLIC_REGISTRATION_ENABLED}

# Create SSL directory if it doesn't exist
mkdir -p /etc/nginx/ssl

# Generate self-signed SSL certificate if not exists
if [ ! -f /etc/nginx/ssl/nginx.crt ] || [ ! -f /etc/nginx/ssl/nginx.key ]; then
    echo "Generating new SSL certificate (10 years validity)..."
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout /etc/nginx/ssl/nginx.key \
        -out /etc/nginx/ssl/nginx.crt \
        -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"

    # Set proper permissions
    chmod 644 /etc/nginx/ssl/nginx.crt
    chmod 600 /etc/nginx/ssl/nginx.key
fi

# Remove the default API URL as it's only used for local dev/debugging.
# The app will use a relative URL instead (base url + "/api/" which is the default for the Docker setup).
sed -i "s|\"ApiUrl\": \"http://localhost:5092\",||g" /usr/share/nginx/html/appsettings.json

# Handle empty PRIVATE_EMAIL_DOMAINS by defaulting to empty array
if [ -z "$PRIVATE_EMAIL_DOMAINS" ]; then
    json_array="[]"
else
    # Convert comma-separated list to JSON array
    json_array=$(echo $PRIVATE_EMAIL_DOMAINS | awk '{split($0,a,","); printf "["; for(i=1;i<=length(a);i++) {printf "\"%s\"", a[i]; if(i<length(a)) printf ","} printf "]"}')
fi

# Handle empty HIDDEN_PRIVATE_EMAIL_DOMAINS by defaulting to empty array
if [ -z "$HIDDEN_PRIVATE_EMAIL_DOMAINS" ]; then
    hidden_json_array="[]"
else
    # Convert comma-separated list to JSON array
    hidden_json_array=$(echo $HIDDEN_PRIVATE_EMAIL_DOMAINS | awk '{split($0,a,","); printf "["; for(i=1;i<=length(a);i++) {printf "\"%s\"", a[i]; if(i<length(a)) printf ","} printf "]"}')
fi

# Use sed to update the PrivateEmailDomains field in appsettings.json
sed -i.bak "s|\"PrivateEmailDomains\": \[.*\]|\"PrivateEmailDomains\": $json_array|" /usr/share/nginx/html/appsettings.json

# Add HiddenPrivateEmailDomains field if it doesn't exist, or update it if it does
if grep -q "HiddenPrivateEmailDomains" /usr/share/nginx/html/appsettings.json; then
    sed -i "s|\"HiddenPrivateEmailDomains\": \[.*\]|\"HiddenPrivateEmailDomains\": $hidden_json_array|" /usr/share/nginx/html/appsettings.json
else
    # Insert HiddenPrivateEmailDomains after PrivateEmailDomains
    sed -i "s|\"PrivateEmailDomains\": $json_array|\"PrivateEmailDomains\": $json_array,\n    \"HiddenPrivateEmailDomains\": $hidden_json_array|" /usr/share/nginx/html/appsettings.json
fi

# Update support email in appsettings.json
if [ ! -z "$SUPPORT_EMAIL" ]; then
    sed -i "s|\"SupportEmail\": \".*\"|\"SupportEmail\": \"$SUPPORT_EMAIL\"|g" /usr/share/nginx/html/appsettings.json
else
    sed -i "s|\"SupportEmail\": \".*\"|\"SupportEmail\": \"\"|g" /usr/share/nginx/html/appsettings.json
fi

# Update public registration enabled in appsettings.json
sed -i "s|\"PublicRegistrationEnabled\": \".*\"|\"PublicRegistrationEnabled\": \"$PUBLIC_REGISTRATION_ENABLED\"|g" /usr/share/nginx/html/appsettings.json

# Start the application
nginx -g "daemon off;"
