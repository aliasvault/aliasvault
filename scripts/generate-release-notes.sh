#!/bin/bash

# Script to generate release notes between two tags using GitHub API

# Prompt for the new tag to create
read -p "Enter new tag name (that you will create later manually): " NEW_TAG
if [ -z "$NEW_TAG" ]; then
    echo "Error: New tag name is required"
    exit 1
fi

# Prompt for the previous tag
read -p "Enter previous tag name: " PREVIOUS_TAG
if [ -z "$PREVIOUS_TAG" ]; then
    echo "Error: Previous tag name is required"
    exit 1
fi

echo ""
echo "Generating release notes from $PREVIOUS_TAG to $NEW_TAG..."
echo ""

gh api repos/aliasvault/aliasvault/releases/generate-notes \
  -f tag_name="$NEW_TAG" \
  -f previous_tag_name="$PREVIOUS_TAG" \
  -f target_commitish=main \
  --jq .body
