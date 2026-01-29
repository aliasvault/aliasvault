#!/bin/bash
#
# Show the latest changelogs for all platforms (Android, iOS, Browser Extension)
# Outputs formatted changelog content for easy copy-paste
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
METADATA_DIR="$ROOT_DIR/fastlane/metadata"

# Function to get the latest changelog file from a directory
get_latest_changelog() {
    local dir="$1"
    if [ -d "$dir" ]; then
        # Sort files by version number (handles both numeric and semver formats)
        ls -1 "$dir" 2>/dev/null | sort -V | tail -1
    fi
}

# Function to print Android changelogs (XML format, no spaces between languages)
print_android() {
    local changelog_dir="$METADATA_DIR/android/en-US/changelogs"
    local latest_file=$(get_latest_changelog "$changelog_dir")

    echo "================================================================================"
    echo "ANDROID (latest: $latest_file)"
    echo "================================================================================"
    echo ""

    # Print all locales in XML format without blank lines between them
    for locale_dir in "$METADATA_DIR/android"/*; do
        if [ -d "$locale_dir/changelogs" ]; then
            locale=$(basename "$locale_dir")
            local file="$locale_dir/changelogs/$latest_file"
            if [ -f "$file" ]; then
                echo "<$locale>"
                cat "$file"
                echo "</$locale>"
            fi
        fi
    done
    echo ""
}

# Function to print iOS/Browser Extension changelogs (each language separate)
print_simple() {
    local platform="$1"
    local display_name="$2"
    local changelog_dir="$METADATA_DIR/$platform/en-US/changelogs"
    local latest_file=$(get_latest_changelog "$changelog_dir")

    echo "================================================================================"
    echo "$display_name (latest: $latest_file)"
    echo "================================================================================"

    # Print each locale separately
    for locale_dir in "$METADATA_DIR/$platform"/*; do
        if [ -d "$locale_dir/changelogs" ]; then
            locale=$(basename "$locale_dir")
            local file="$locale_dir/changelogs/$latest_file"
            if [ -f "$file" ]; then
                echo ""
                echo "--- $locale ---"
                cat "$file"
            fi
        fi
    done
    echo ""
}

echo ""
echo "Latest Changelogs Summary"
echo ""

print_android
print_simple "ios" "iOS"
print_simple "browser-extension" "BROWSER EXTENSION"

echo "================================================================================"
echo ""
