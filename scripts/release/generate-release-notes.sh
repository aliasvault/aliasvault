#!/bin/bash

# Script to generate release notes between two tags using GitHub API
# Usage:
#   ./generate-release-notes.sh --new NEW_TAG --previous PREVIOUS_TAG
#   ./generate-release-notes.sh --new NEW_TAG --prev PREVIOUS_TAG
#   ./generate-release-notes.sh (interactive mode)
#   ./generate-release-notes.sh --no-credits (skip adding reporter attribution to PR lines)

# Color codes
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

# Repository the release notes are generated for
REPO_OWNER="aliasvault"
REPO_NAME="aliasvault"

# Parse command-line arguments
NEW_TAG=""
PREVIOUS_TAG=""
ADD_CREDITS=true

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
        --no-credits)
            ADD_CREDITS=false
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: ./generate-release-notes.sh --new NEW_TAG --previous PREVIOUS_TAG [--no-credits]"
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

# Query a batch of PRs for the authors of the issues they close. Prints one
# "<pr number><tab><space separated logins>" line per PR that has reporters.
query_reporters() {
    local fields="$1"
    local query response

    query="query { repository(owner: \"$REPO_OWNER\", name: \"$REPO_NAME\") {$fields
  } }"

    # gh exits non-zero on partial GraphQL errors
    response=$(gh api graphql -f query="$query" 2>/dev/null)
    [ -z "$response" ] && return 0

    printf '%s' "$response" | jq -r '
        (.data.repository // {})
        | to_entries[]
        | .value
        | select(. != null)
        | . as $pr
        | [ .closingIssuesReferences.nodes[]? | .author.login? // empty ]
        | map(select(. != ($pr.author.login // "")))
        | unique
        | select(length > 0)
        | "\($pr.number)\t\(join(" "))"
    ' 2>/dev/null
}

# Append "(reported by @user)" to every PR line in the release notes, based on the issues each PR closes.
add_reporter_credits() {
    local notes="$1"
    local pr_numbers map_file fields count pr

    pr_numbers=$(printf '%s\n' "$notes" | grep -oE '/pull/[0-9]+' | grep -oE '[0-9]+' | sort -un)
    if [ -z "$pr_numbers" ]; then
        printf '%s' "$notes"
        return 0
    fi

    map_file=$(mktemp "${TMPDIR:-/tmp}/release-reporters.XXXXXX")
    fields=""
    count=0

    for pr in $pr_numbers; do
        fields="$fields
    p${pr}: pullRequest(number: ${pr}) { number author { login } closingIssuesReferences(first: 10) { nodes { author { login } } } }"
        count=$((count + 1))

        # Keep each GraphQL query within a sane size
        if [ "$count" -ge 50 ]; then
            query_reporters "$fields" >> "$map_file"
            fields=""
            count=0
        fi
    done

    if [ -n "$fields" ]; then
        query_reporters "$fields" >> "$map_file"
    fi

    printf '%s\n' "$notes" | awk -v mapfile="$map_file" '
        BEGIN {
            FS = "\t"
            while ((getline line < mapfile) > 0) {
                split(line, parts, "\t")
                if (parts[1] != "") reporters[parts[1]] = parts[2]
            }
            close(mapfile)
        }
        # Skip the "New Contributors" section
        /^#+ New Contributors/ { skip = 1 }
        {
            if (!skip && match($0, /\/pull\/[0-9]+[ \t]*$/)) {
                num = substr($0, RSTART + 6, RLENGTH - 6)
                gsub(/[ \t]/, "", num)
                if (num in reporters) {
                    sub(/[ \t]+$/, "")
                    total = split(reporters[num], logins, " ")
                    credit = "@" logins[1]
                    for (i = 2; i <= total; i++) {
                        credit = credit (i == total ? " and @" : ", @") logins[i]
                    }
                    $0 = $0 " (reported by " credit ")"
                }
            }
            print
        }
    '

    rm -f "$map_file"
}

# Generate release notes
RELEASE_NOTES=$(gh api "repos/$REPO_OWNER/$REPO_NAME/releases/generate-notes" \
  -f tag_name="$NEW_TAG" \
  -f previous_tag_name="$PREVIOUS_TAG" \
  -f target_commitish="$TARGET_BRANCH" \
  --jq .body)

if [ -z "$RELEASE_NOTES" ]; then
    echo -e "${RED}Error: Failed to generate release notes${RESET}"
    exit 1
fi

# Enrich the notes with reporter attribution from linked issues
if [ "$ADD_CREDITS" = true ]; then
    echo -e "${BLUE}Looking up issue reporters for linked pull requests...${RESET}"
    ENRICHED_NOTES=$(add_reporter_credits "$RELEASE_NOTES")

    if [ -n "$ENRICHED_NOTES" ]; then
        RELEASE_NOTES="$ENRICHED_NOTES"
        CREDITS_ADDED=$(printf '%s\n' "$RELEASE_NOTES" | grep -c "(reported by " | tr -d ' ')
        echo -e "${GREEN}Added reporter attribution to $CREDITS_ADDED pull request(s)${RESET}"
    else
        echo -e "${YELLOW}Warning: Could not resolve issue reporters, using notes as-is${RESET}"
    fi
fi

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
