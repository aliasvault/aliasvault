#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
CONFIRM_RESET=false
PASSWORD_LENGTH=16

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -y|--yes)
            CONFIRM_RESET=true
            shift
            ;;
        -l|--length)
            PASSWORD_LENGTH="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Reset the admin password with a randomly generated password"
            echo ""
            echo "OPTIONS:"
            echo "  -y, --yes           Skip confirmation prompt"
            echo "  -l, --length NUM    Password length (default: 16)"
            echo "  -h, --help          Show this help message"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Use -h or --help for usage information"
            exit 1
            ;;
    esac
done

# Function to generate a secure random password
generate_password() {
    local length=$1
    # Generate password with uppercase, lowercase, numbers, and special characters
    # Using /dev/urandom for cryptographically secure randomness
    local password=$(tr -dc 'A-Za-z0-9!@#$%^&*()_+=-' < /dev/urandom | head -c "$length")
    echo "$password"
}

# Function to hash the password using the aliasvault-cli
hash_password() {
    local password=$1
    local hash

    # Check if aliasvault-cli.sh exists
    if [ ! -f /usr/local/bin/aliasvault-cli.sh ] && [ ! -L /usr/local/bin/aliasvault-cli.sh ]; then
        echo -e "${RED}Error: aliasvault-cli.sh not found${NC}" >&2
        return 1
    fi

    # Hash the password
    hash=$(/usr/local/bin/aliasvault-cli.sh hash-password "$password" 2>/dev/null)

    if [ $? -ne 0 ] || [ -z "$hash" ]; then
        echo -e "${RED}Error: Failed to hash password${NC}" >&2
        return 1
    fi

    echo "$hash"
}

# Function to update the admin password hash file
update_hash_file() {
    local hash=$1
    local hash_file="/secrets/admin_password_hash"

    # Create /secrets directory if it doesn't exist
    if [ ! -d "/secrets" ]; then
        mkdir -p /secrets
        if [ $? -ne 0 ]; then
            echo -e "${RED}Error: Failed to create /secrets directory${NC}" >&2
            return 1
        fi
    fi

    # Get current timestamp in ISO8601 format (UTC)
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    # Write hash and timestamp to file
    cat > "$hash_file" <<EOF
$hash|$timestamp
EOF

    if [ $? -ne 0 ]; then
        echo -e "${RED}Error: Failed to write hash to $hash_file${NC}" >&2
        return 1
    fi

    # Set appropriate permissions (readable by the application, not world-readable)
    chmod 600 "$hash_file"

    echo -e "${GREEN}Password hash updated successfully${NC}"
    echo -e "Hash file: $hash_file"
    echo -e "Updated at: $timestamp"

    return 0
}

# Main execution
main() {
    echo -e "${YELLOW}=== AliasVault Admin Password Reset ===${NC}"
    echo ""

    # Check if running in Docker container
    if [ ! -f /.dockerenv ] && [ ! -f /run/.containerenv ]; then
        echo -e "${YELLOW}Warning: This script appears to be running outside of a Docker container${NC}"
        echo -e "${YELLOW}The password hash file will be created at: /secrets/admin_password_hash${NC}"
        echo ""
    fi

    # Confirmation prompt
    if [ "$CONFIRM_RESET" = false ]; then
        echo -e "${YELLOW}This will reset the admin password with a new randomly generated password.${NC}"
        echo -e "${YELLOW}The current admin password (if any) will be permanently overwritten.${NC}"
        echo ""
        read -p "Are you sure you want to reset the admin password? (yes/no): " confirm

        if [[ ! "$confirm" =~ ^[Yy]([Ee][Ss])?$ ]]; then
            echo -e "${RED}Password reset cancelled${NC}"
            exit 0
        fi
    fi

    echo ""
    echo "Generating new password..."

    # Generate random password
    NEW_PASSWORD=$(generate_password "$PASSWORD_LENGTH")

    if [ -z "$NEW_PASSWORD" ]; then
        echo -e "${RED}Error: Failed to generate password${NC}"
        exit 1
    fi

    # Hash the password
    PASSWORD_HASH=$(hash_password "$NEW_PASSWORD")

    if [ $? -ne 0 ] || [ -z "$PASSWORD_HASH" ]; then
        echo -e "${RED}Error: Failed to hash password${NC}"
        exit 1
    fi

    # Update the hash file
    update_hash_file "$PASSWORD_HASH"

    if [ $? -ne 0 ]; then
        echo -e "${RED}Error: Failed to update password hash file${NC}"
        exit 1
    fi

    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}Admin password reset successful!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo -e "${YELLOW}New Admin Credentials:${NC}"
    echo -e "Username: ${GREEN}admin${NC}"
    echo -e "Password: ${GREEN}$NEW_PASSWORD${NC}"
    echo ""
    echo -e "${YELLOW}IMPORTANT:${NC}"
    echo -e "1. Save this password securely - it will not be shown again"
    echo -e "2. The password hash has been saved to /secrets/admin_password_hash"
    echo -e "3. Restart the Docker container for the new password to take effect"
    echo ""

    exit 0
}

# Run main function
main
