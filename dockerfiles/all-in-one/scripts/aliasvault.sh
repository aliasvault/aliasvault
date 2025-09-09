#!/bin/bash

# Simple AliasVault command dispatcher wrapper which allows
# running AliasVault commands from the Docker container CLI
# like `aliasvault reset-admin-password`.

case "$1" in
    reset-admin-password)
        shift
        exec /usr/local/bin/reset-admin-password.sh "$@"
        ;;
    hash-password)
        shift
        exec /usr/local/bin/aliasvault-cli/AliasVault.InstallCli hash-password "$@"
        ;;
    help|--help|-h|"")
        echo "AliasVault Commands"
        echo ""
        echo "Usage: aliasvault <command> [options]"
        echo ""
        echo "Commands:"
        echo "  reset-admin-password   Reset admin password"
        echo "  hash-password          Hash a password"
        echo "  help                   Show this help"
        echo ""
        echo "Examples:"
        echo "  aliasvault reset-admin-password -y"
        echo "  aliasvault hash-password 'mypassword'"
        ;;
    *)
        echo "Unknown command: $1"
        echo "Run 'aliasvault help' for usage"
        exit 1
        ;;
esac
