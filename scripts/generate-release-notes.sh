#!/bin/bash

# Script to generate release notes between two tags using GitHub API
# Usage:
#   ./generate-release-notes.sh --new NEW_TAG --previous PREVIOUS_TAG
#   ./generate-release-notes.sh --new NEW_TAG --prev PREVIOUS_TAG
#   ./generate-release-notes.sh (interactive mode)

# Color codes
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

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
    echo -en "${CYAN}Enter new tag name (that you will create later manually): ${RESET}"
    read NEW_TAG
    if [ -z "$NEW_TAG" ]; then
        echo -e "${RED}Error: New tag name is required${RESET}"
        exit 1
    fi
fi

# Prompt for the previous tag if not provided
if [ -z "$PREVIOUS_TAG" ]; then
    echo -en "${CYAN}Enter previous tag name: ${RESET}"
    read PREVIOUS_TAG
    if [ -z "$PREVIOUS_TAG" ]; then
        echo -e "${RED}Error: Previous tag name is required${RESET}"
        exit 1
    fi
fi

echo ""
echo -e "${BLUE}Generating release notes from $PREVIOUS_TAG to $NEW_TAG...${RESET}"
echo ""

# Define release branch name
RELEASE_BRANCH="release/$NEW_TAG"

# Check if release branch exists on remote
if git ls-remote --heads origin "$RELEASE_BRANCH" | grep -q "$RELEASE_BRANCH"; then
    echo -e "${GREEN}Using release branch: $RELEASE_BRANCH${RESET}"
    TARGET_BRANCH="$RELEASE_BRANCH"
else
    echo -e "${YELLOW}Release branch $RELEASE_BRANCH does not exist yet, using main branch for notes generation${RESET}"
    TARGET_BRANCH="main"
fi

# Generate release notes
RELEASE_NOTES=$(gh api repos/aliasvault/aliasvault/releases/generate-notes \
  -f tag_name="$NEW_TAG" \
  -f previous_tag_name="$PREVIOUS_TAG" \
  -f target_commitish="$TARGET_BRANCH" \
  --jq .body)

# Display the generated notes with visual separator
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${CYAN}Generated Release Notes:${RESET}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo "$RELEASE_NOTES"
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

# Check if release already exists
EXISTING_RELEASE=$(gh release view "$NEW_TAG" 2>/dev/null || echo "")

if [ -z "$EXISTING_RELEASE" ]; then
    echo -e "${YELLOW}Release $NEW_TAG does not exist yet.${RESET}"
    echo -en "${CYAN}Do you want to create a draft release? (y/n): ${RESET}"
    read CREATE_DRAFT

    if [[ "$CREATE_DRAFT" =~ ^[Yy]$ ]]; then
        echo ""

        # Check again if release branch exists for creating the release
        if git ls-remote --heads origin "$RELEASE_BRANCH" | grep -q "$RELEASE_BRANCH"; then
            echo -e "${BLUE}Creating draft release $NEW_TAG from branch $RELEASE_BRANCH...${RESET}"
            RELEASE_TARGET="$RELEASE_BRANCH"
        else
            echo -e "${YELLOW}Warning: Release branch $RELEASE_BRANCH does not exist.${RESET}"
            echo -e "${BLUE}Creating draft release $NEW_TAG from main branch...${RESET}"
            RELEASE_TARGET="main"
        fi

        gh release create "$NEW_TAG" \
          --draft \
          --title "$NEW_TAG" \
          --notes "$RELEASE_NOTES" \
          --target "$RELEASE_TARGET"

        if [ $? -eq 0 ]; then
            echo ""
            echo -e "${GREEN}✓ Draft release created successfully!${RESET}"
            if [ "$RELEASE_TARGET" = "main" ]; then
                echo ""
                echo -e "${YELLOW}Note: Release was created from main branch. You can change the target branch later in the GitHub UI.${RESET}"
            fi
        else
            echo ""
            echo -e "${RED}✗ Failed to create draft release${RESET}"
            exit 1
        fi
    else
        echo -e "${YELLOW}Skipping draft release creation.${RESET}"
    fi
else
    echo -e "${YELLOW}Release $NEW_TAG already exists. Skipping creation.${RESET}"
fi
