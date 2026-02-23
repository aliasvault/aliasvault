#!/bin/bash

# Script to generate release notes between two tags using GitHub API
# Usage:
#   ./generate-release-notes.sh --new NEW_TAG --previous PREVIOUS_TAG
#   ./generate-release-notes.sh --new NEW_TAG --prev PREVIOUS_TAG
#   ./generate-release-notes.sh (interactive mode)

# Parse command-line arguments
NEW_TAG=""
PREVIOUS_TAG=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --new)
            NEW_TAG="$2"
            shift 2
            ;;
        --previous|--prev)
            PREVIOUS_TAG="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: ./generate-release-notes.sh --new NEW_TAG --previous PREVIOUS_TAG"
            echo "   or: ./generate-release-notes.sh (interactive mode)"
            exit 1
            ;;
    esac
done

# Prompt for the new tag if not provided
if [ -z "$NEW_TAG" ]; then
    read -p "Enter new tag name (that you will create later manually): " NEW_TAG
    if [ -z "$NEW_TAG" ]; then
        echo "Error: New tag name is required"
        exit 1
    fi
fi

# Prompt for the previous tag if not provided
if [ -z "$PREVIOUS_TAG" ]; then
    read -p "Enter previous tag name: " PREVIOUS_TAG
    if [ -z "$PREVIOUS_TAG" ]; then
        echo "Error: Previous tag name is required"
        exit 1
    fi
fi

echo ""
echo "Generating release notes from $PREVIOUS_TAG to $NEW_TAG..."
echo ""

gh api repos/aliasvault/aliasvault/releases/generate-notes \
  -f tag_name="$NEW_TAG" \
  -f previous_tag_name="$PREVIOUS_TAG" \
  -f target_commitish=main \
  --jq .body
