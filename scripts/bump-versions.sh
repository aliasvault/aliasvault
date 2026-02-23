#!/usr/bin/env bash

# Check if running with bash
if [ -z "$BASH_VERSION" ]; then
    echo "Error: This script must be run with bash"
    echo "Usage: bash $0 [--build-only]"
    exit 1
fi

# Color codes
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

# Initialize variables
BUILD_ONLY=false
MARKETING_UPDATE=false

# Function to generate semantic build number
# Format: MMmmppSXX where MM=major, mm=minor, pp=patch, S=stage, XX=build
# Stage: 1=alpha, 3=beta, 7=rc, 9=ga (general availability)
generate_semantic_build_number() {
    local major=$1
    local minor=$2
    local patch=$3
    local build_increment=$4
    local version_suffix=$5

    # Determine stage based on version suffix
    local stage_num=9  # Default to GA
    if [[ "$version_suffix" =~ -alpha ]]; then
        stage_num=1
    elif [[ "$version_suffix" =~ -beta ]]; then
        stage_num=3
    elif [[ "$version_suffix" =~ -rc ]]; then
        stage_num=7
    fi

    # Pad with zeros and create build number
    local major_padded=$(printf "%02d" $major)
    local minor_padded=$(printf "%02d" $minor)
    local patch_padded=$(printf "%02d" $patch)
    local build_padded=$(printf "%02d" $build_increment)

    local semantic_build="${major_padded}${minor_padded}${patch_padded}${stage_num}${build_padded}"

    # Remove leading zeros for App Store compatibility
    echo $((10#$semantic_build))
}

# Function to extract components from semantic build number
# Returns: major minor patch stage increment
extract_build_components() {
    local semantic_build=$1

    # Pad the semantic build number to 9 digits with leading zeros
    local padded_build=$(printf "%09d" $semantic_build)

    # Extract components
    local major=${padded_build:0:2}
    local minor=${padded_build:2:2}
    local patch=${padded_build:4:2}
    local stage_num=${padded_build:6:1}
    local increment=${padded_build:7:2}

    # Map stage number back to string
    local stage
    case $stage_num in
        1)
            stage="alpha"
            ;;
        3)
            stage="beta"
            ;;
        7)
            stage="rc"
            ;;
        9)
            stage="ga"
            ;;
        *)
            # Unknown stage, return empty to trigger reset
            echo ""
            return
            ;;
    esac

    # Remove leading zeros and return
    echo "$((10#$major)) $((10#$minor)) $((10#$patch)) $stage $((10#$increment))"
}

# Function to extract build increment from semantic build number
extract_build_increment() {
    local semantic_build=$1
    local version_major=$2
    local version_minor=$3
    local version_patch=$4

    # Pad the semantic build number to 9 digits with leading zeros
    local padded_build=$(printf "%09d" $semantic_build)

    # Generate the version prefix (first 6 digits)
    local version_prefix=$(printf "%02d%02d%02d" $version_major $version_minor $version_patch)

    # Check if the build number starts with the expected version prefix
    if [[ ${padded_build:0:6} == $version_prefix ]]; then
        # Extract the last 2 digits as the build increment
        local build_increment=${padded_build: -2}
        # Remove leading zeros
        echo $((10#$build_increment))
    else
        # If version changed, reset to 0
        echo 0
    fi
}

# Function to read and validate semantic version
read_semver() {
    # Get current version from server
    local current_major=$(grep "public const int VersionMajor = " ../apps/server/Shared/AliasVault.Shared.Core/AppInfo.cs | tr -d ';' | tr -d ' ' | cut -d'=' -f2)
    local current_minor=$(grep "public const int VersionMinor = " ../apps/server/Shared/AliasVault.Shared.Core/AppInfo.cs | tr -d ';' | tr -d ' ' | cut -d'=' -f2)
    local current_stage=$(grep "public const string VersionStage = " ../apps/server/Shared/AliasVault.Shared.Core/AppInfo.cs | cut -d'"' -f2)
    local suggested_version="${current_major}.$((current_minor + 1)).0"

    while true; do
        read -p "Enter new semantic version (e.g. 1.2.3 or 1.2.3-alpha.1) [$suggested_version]: " version_input
        # If empty, use suggested version
        if [[ -z "$version_input" ]]; then
            version_input=$suggested_version
        fi
        # Extract base version and suffix
        if [[ $version_input =~ ^([0-9]+\.[0-9]+\.[0-9]+)((-[a-zA-Z]+)(\.[0-9]+)?)?$ ]]; then
            version=${BASH_REMATCH[1]}
            version_suffix=${BASH_REMATCH[2]}
            break
        else
            echo "Invalid version format. Please use format X.Y.Z or X.Y.Z-suffix (e.g. $suggested_version or 1.2.3-alpha.1)"
        fi
    done
}

# Function to handle semantic build number bump
handle_semantic_build_number() {
    local current_build=$1
    local project_name=$2
    local version_major=$3
    local version_minor=$4
    local version_patch=$5
    local is_marketing_update=$6

    if [[ "$is_marketing_update" == true ]]; then
        # For marketing version updates, generate new build number with current version suffix
        local suggested_increment=0
        read -p "$project_name ($current_build) - Enter new build increment [$suggested_increment]: " input

        if [[ -z "$input" ]]; then
            input=$suggested_increment
        fi

        if [[ "$input" =~ ^[0-9]+$ ]]; then
            if [[ $input -gt 99 ]]; then
                input=99
            fi
            generate_semantic_build_number "$version_major" "$version_minor" "$version_patch" "$input" "${version_suffix:-""}"
        else
            generate_semantic_build_number "$version_major" "$version_minor" "$version_patch" "$suggested_increment" "${version_suffix:-""}"
        fi
    else
        # For build-only updates, just increment the last 2 digits
        local padded_build=$(printf "%09d" $current_build)
        local last_two_digits=${padded_build: -2}
        local current_increment=$((10#$last_two_digits))
        local suggested_increment=$((current_increment + 1))

        read -p "$project_name ($current_build) - (Increment: $current_increment) - Enter new build increment [$suggested_increment]: " input

        if [[ -z "$input" ]]; then
            input=$suggested_increment
        fi

        if [[ "$input" =~ ^[0-9]+$ ]]; then
            if [[ $input -gt 99 ]]; then
                input=99
            fi
            # Replace last 2 digits with new increment
            local new_increment_padded=$(printf "%02d" $input)
            local new_build="${padded_build:0:7}${new_increment_padded}"
            echo $((10#$new_build))
        else
            # If invalid input, just increment by 1
            local new_increment_padded=$(printf "%02d" $suggested_increment)
            local new_build="${padded_build:0:7}${new_increment_padded}"
            echo $((10#$new_build))
        fi
    fi
}

# Function to update version in a file
update_version() {
    local file=$1
    local pattern=$2
    local replacement=$3
    local project_name=$4

    if [ -f "$file" ]; then
        # Create a temporary file
        local temp_file=$(mktemp)
        # Replace the pattern and write to temp file
        awk -v pat="$pattern" -v rep="$replacement" '{gsub(pat, rep); print}' "$file" > "$temp_file"
        # Move temp file back to original
        mv "$temp_file" "$file"
    else
        echo "Warning: File $file not found"
    fi
}

# Function to extract version from server AppInfo.cs
get_server_version() {
    local major=$(grep "public const int VersionMajor = " ../apps/server/Shared/AliasVault.Shared.Core/AppInfo.cs | tr -d ';' | tr -d ' ' | cut -d'=' -f2)
    local minor=$(grep "public const int VersionMinor = " ../apps/server/Shared/AliasVault.Shared.Core/AppInfo.cs | tr -d ';' | tr -d ' ' | cut -d'=' -f2)
    local patch=$(grep "public const int VersionPatch = " ../apps/server/Shared/AliasVault.Shared.Core/AppInfo.cs | tr -d ';' | tr -d ' ' | cut -d'=' -f2)
    local stage=$(grep "public const string VersionStage = " ../apps/server/Shared/AliasVault.Shared.Core/AppInfo.cs | cut -d'"' -f2)
    echo "$major.$minor.$patch$stage"
}

# Function to extract version from browser extension config
get_browser_extension_version() {
    grep "version: " ../apps/browser-extension/wxt.config.ts | head -n1 | tr -d '"' | tr -d ',' | tr -d ' ' | cut -d':' -f2
}

# Function to extract version from browser extension package.json
get_browser_extension_package_json_version() {
    grep "\"version\": " ../apps/browser-extension/package.json | tr -d '"' | tr -d ',' | tr -d ' ' | cut -d':' -f2
}

# Function to extract version from browser extension AppInfo.ts
get_browser_extension_ts_version() {
    grep "public static readonly VERSION = " ../apps/browser-extension/src/utils/AppInfo.ts | tr -d "'" | tr -d ';' | tr -d ' ' | cut -d'=' -f2
}

# Function to extract version from mobile app
get_mobile_app_version() {
    grep "\"version\": " ../apps/mobile-app/app.json | tr -d '"' | tr -d ',' | tr -d ' ' | cut -d':' -f2
}

get_mobile_app_ts_version() {
    grep "public static readonly VERSION = " ../apps/mobile-app/utils/AppInfo.ts | tr -d "'" | tr -d ';' | tr -d ' ' | cut -d'=' -f2
}

# Function to extract version from iOS app (main target only, identified by net.aliasvault.app bundle ID)
get_ios_version() {
    local pbxproj="../apps/mobile-app/ios/AliasVault.xcodeproj/project.pbxproj"
    # Find the line number of the main app's bundle identifier
    local line_num=$(grep -n "PRODUCT_BUNDLE_IDENTIFIER = net.aliasvault.app;" "$pbxproj" | head -n1 | cut -d: -f1)
    # Look back within the same build settings block (typically within 30 lines) for MARKETING_VERSION
    local start_line=$((line_num - 30))
    sed -n "${start_line},${line_num}p" "$pbxproj" | grep "MARKETING_VERSION" | head -n1 | sed 's/.*= //' | tr -d ';'
}

# Function to extract version from Android app
get_android_version() {
    grep "versionName " ../apps/mobile-app/android/app/build.gradle | head -n1 | tr -d '"' | tr -d ' ' | cut -d'=' -f2 | sed 's/versionName//'
}

# Function to extract version from Safari extension
get_safari_version() {
    grep "MARKETING_VERSION = " ../apps/browser-extension/safari-xcode/AliasVault.xcodeproj/project.pbxproj | head -n1 | tr -d '"' | tr -d ';' | tr -d ' ' | cut -d'=' -f2
}

# Function to extract version from Rust core Cargo.toml
get_rust_core_version() {
    grep "^version = " ../core/rust/Cargo.toml | head -n1 | tr -d '"' | tr -d ' ' | cut -d'=' -f2
}

# Check current versions
server_version=$(get_server_version)
browser_wxt_version=$(get_browser_extension_version)
browser_package_version=$(get_browser_extension_package_json_version)
browser_ts_version=$(get_browser_extension_ts_version)
mobile_version=$(get_mobile_app_version)
mobile_ts_version=$(get_mobile_app_ts_version)
ios_version=$(get_ios_version)
android_version=$(get_android_version)
safari_version=$(get_safari_version)
rust_core_version=$(get_rust_core_version)

# Create associative array of versions
declare -A versions
versions["server"]="$server_version"
versions["browser_wxt"]="$browser_wxt_version"
versions["browser_package"]="$browser_package_version"
versions["browser_ts"]="$browser_ts_version"
versions["mobile"]="$mobile_version"
versions["mobile_ts"]="$mobile_ts_version"
versions["ios"]="$ios_version"
versions["android"]="$android_version"
versions["safari"]="$safari_version"
versions["rust_core"]="$rust_core_version"

# Create display names for output
declare -A display_names
display_names["server"]="Server"
display_names["browser_wxt"]="Browser Extension (wxt.config.ts)"
display_names["browser_package"]="Browser Extension (package.json)"
display_names["browser_ts"]="Browser Extension (AppInfo.ts)"
display_names["mobile"]="Mobile App"
display_names["mobile_ts"]="Mobile App (TS)"
display_names["ios"]="iOS App"
display_names["android"]="Android App"
display_names["safari"]="Safari Extension"
display_names["rust_core"]="Rust Core"

# Function to normalize version by removing stage suffix
normalize_version() {
    local version=$1
    echo "${version%%-*}"
}

# Check if all versions are equal (comparing base versions without stage suffixes)
# Use .version/version.txt as the canonical reference if it exists, otherwise fall back to server version
all_equal=true
if [ -f "../apps/.version/version.txt" ]; then
    first_version=$(cat "../apps/.version/version.txt")
else
    first_version="$server_version"
fi
first_normalized_version=$(normalize_version "$first_version")
for project in "${!versions[@]}"; do
    normalized_version=$(normalize_version "${versions[$project]}")
    if [[ "$normalized_version" != "$first_normalized_version" ]]; then
        all_equal=false
        break
    fi
done

# This script is used to bump version numbers across the AliasVault codebase.
# It can update both marketing versions (e.g. 1.2.3) and build numbers for app stores.
# Marketing versions are used for new feature releases and bug fixes.
# Build numbers are used for internal testing, translations, and misc updates.

# Ask user what they want to do
echo ""
echo "--------------------------------"
echo "AliasVault version bump tool"
echo "* This tool updates version numbers across the AliasVault codebase"
echo "--------------------------------"
echo ""
echo "What would you like to do?"
echo ""
echo "1) [Public release] Prepare new public release (marketing version + app store build numbers)"
echo "2) [Internal release] New internal app store build (app store build numbers only, e.g. for testing translations)"
echo ""
read -p "Enter your choice: " choice

case $choice in
    1)
        MARKETING_UPDATE=true
        ;;
    2)
        BUILD_ONLY=true
        ;;
    *)
        echo "Invalid choice. Exiting."
        exit 1
        ;;
esac

# If versions are not equal, ask for confirmation
if [[ "$all_equal" == false ]]; then
    echo -e "\nWARNING: Not all base versions are equal!"
    echo "Different base versions found (ignoring stage suffixes):"
    for project in "${!versions[@]}"; do
        project_normalized=$(normalize_version "${versions[$project]}")
        if [[ "$project_normalized" != "$first_normalized_version" ]]; then
            echo "${display_names[$project]}: ${versions[$project]} (base: $project_normalized, differs from base: $first_normalized_version)"
        fi
    done
    read -p "Do you want to continue with the version bump? (y/N) " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        echo "Version bump cancelled."
        exit 1
    fi
fi

# Initialize version_suffix variable
version_suffix=""

if [[ "$BUILD_ONLY" == true ]]; then
    # Use existing version
    version_input=$first_version
    # Extract base version and suffix
    if [[ $version_input =~ ^([0-9]+\.[0-9]+\.[0-9]+)((-[a-zA-Z]+)(\.[0-9]+)?)?$ ]]; then
        version=${BASH_REMATCH[1]}
        version_suffix=${BASH_REMATCH[2]}
    else
        version=$version_input
        version_suffix=""
    fi
    major=$(echo $version | cut -d. -f1)
    minor=$(echo $version | cut -d. -f2)
    patch=$(echo $version | cut -d. -f3)
elif [[ "$MARKETING_UPDATE" == true ]]; then
    # Print current versions
    echo ""
    echo "--------------------------------"
    echo "Current versions"
    echo "--------------------------------"
    for project in "${!versions[@]}"; do
        echo "${display_names[$project]}: ${versions[$project]}"
    done

    # Read new version
    echo ""
    echo "--------------------------------"
    echo "Update marketing versions"
    echo "--------------------------------"
    read_semver

    # Extract major, minor, patch from version
    major=$(echo $version | cut -d. -f1)
    minor=$(echo $version | cut -d. -f2)
    patch=$(echo $version | cut -d. -f3)

    # Build display version with suffix if present
    display_version="${version}${version_suffix}"

    # Read current build numbers (needed for changelog creation)
    ios_pbxproj="../apps/mobile-app/ios/AliasVault.xcodeproj/project.pbxproj"
    ios_main_line=$(grep -n "PRODUCT_BUNDLE_IDENTIFIER = net.aliasvault.app;" "$ios_pbxproj" | head -n1 | cut -d: -f1)
    ios_start_line=$((ios_main_line - 30))
    current_ios_build=$(sed -n "${ios_start_line},${ios_main_line}p" "$ios_pbxproj" | grep "CURRENT_PROJECT_VERSION" | head -n1 | sed 's/.*= //' | tr -d ';' | grep -E '^[0-9]+$')
    if [ -z "$current_ios_build" ]; then
        echo -e "${RED}Error: Could not read iOS build number or invalid format${RESET}"
        exit 1
    fi

    current_android_build=$(grep "versionCode" ../apps/mobile-app/android/app/build.gradle | grep -E "versionCode [0-9]+" | head -n1 | awk '{print $2}' | grep -E '^[0-9]+$')
    if [ -z "$current_android_build" ]; then
        echo -e "${RED}Error: Could not read Android build number or invalid format${RESET}"
        exit 1
    fi

    current_safari_build=$(grep -A1 "CURRENT_PROJECT_VERSION" ../apps/browser-extension/safari-xcode/AliasVault.xcodeproj/project.pbxproj | grep "CURRENT_PROJECT_VERSION = [0-9]\+;" | head -n1 | tr -d ';' | tr -d ' ' | cut -d'=' -f2 | grep -E '^[0-9]+$')
    if [ -z "$current_safari_build" ]; then
        echo -e "${RED}Error: Could not read Safari build number or invalid format${RESET}"
        exit 1
    fi

    # Calculate new build numbers
    new_ios_build=$(handle_semantic_build_number "$current_ios_build" "iOS Mobile App" "$major" "$minor" "$patch" "$MARKETING_UPDATE")
    new_android_build=$(handle_semantic_build_number "$current_android_build" "Android App" "$major" "$minor" "$patch" "$MARKETING_UPDATE")
    new_safari_build=$(handle_semantic_build_number "$current_safari_build" "Safari Extension" "$major" "$minor" "$patch" "$MARKETING_UPDATE")

    # Only create changelog files for GA releases (not alpha, beta, or rc)
    if [[ -z "$version_suffix" ]]; then
        echo ""
        echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
        echo -e "${CYAN}STEP 1: Creating Release Notes Files${RESET}"
        echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
        echo ""
        echo -e "${BLUE}Creating empty changelog files for GA version $version...${RESET}"

        # Create iOS changelog files
        if [ -d "../fastlane/metadata/ios" ]; then
            for lang_dir in ../fastlane/metadata/ios/*/; do
                if [ -d "$lang_dir" ]; then
                    lang=$(basename "$lang_dir")
                    changelog_dir="$lang_dir/changelogs"
                    mkdir -p "$changelog_dir"
                    touch "$changelog_dir/$new_ios_build.txt"
                fi
            done
            echo -e "${GREEN}✓ Created iOS changelog files${RESET}"
        fi

        # Create Android changelog files
        if [ -d "../fastlane/metadata/android" ]; then
            for lang_dir in ../fastlane/metadata/android/*/; do
                if [ -d "$lang_dir" ]; then
                    lang=$(basename "$lang_dir")
                    changelog_dir="$lang_dir/changelogs"
                    mkdir -p "$changelog_dir"
                    touch "$changelog_dir/$new_android_build.txt"
                fi
            done
            echo -e "${GREEN}✓ Created Android changelog files${RESET}"
        fi

        # Create Browser Extension changelog files
        if [ -d "../fastlane/metadata/browser-extension" ]; then
            for lang_dir in ../fastlane/metadata/browser-extension/*/; do
                if [ -d "$lang_dir" ]; then
                    lang=$(basename "$lang_dir")
                    changelog_dir="$lang_dir/changelogs"
                    mkdir -p "$changelog_dir"
                    touch "$changelog_dir/$version.txt"
                fi
            done
            echo -e "${GREEN}✓ Created Browser Extension changelog files${RESET}"
        fi

        echo ""
        echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
        echo -e "${YELLOW}Step 1/2: New release notes files created.${RESET}"
        echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
        echo -en "${CYAN}Press Enter when you are ready to continue with version bumps...${RESET}"
        read
        echo ""
    else
        echo ""
        echo -e "${YELLOW}Skipping changelog creation for pre-release version $display_version (only GA releases get published to app stores)${RESET}"
        echo ""
    fi

    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo -e "${CYAN}STEP 2: Updating Version Numbers${RESET}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo ""

    # Update server version
    echo -e "${BLUE}Updating server version...${RESET}"
    update_version "../apps/server/Shared/AliasVault.Shared.Core/AppInfo.cs" \
        "public const int VersionMajor = [0-9][0-9]*;" \
        "public const int VersionMajor = $major;"
    update_version "../apps/server/Shared/AliasVault.Shared.Core/AppInfo.cs" \
        "public const int VersionMinor = [0-9][0-9]*;" \
        "public const int VersionMinor = $minor;"
    update_version "../apps/server/Shared/AliasVault.Shared.Core/AppInfo.cs" \
        "public const int VersionPatch = [0-9][0-9]*;" \
        "public const int VersionPatch = $patch;"
    update_version "../apps/server/Shared/AliasVault.Shared.Core/AppInfo.cs" \
        "public const string VersionStage = \"[^\"]*\";" \
        "public const string VersionStage = \"$version_suffix\";"

    # Update browser extension version (without suffix - browser stores don't support semver suffixes)
    echo -e "${BLUE}Updating browser extension wxt.config.ts version...${RESET}"
    update_version "../apps/browser-extension/wxt.config.ts" \
        "version: \"[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*[^\"]*\"," \
        "version: \"$version\","

    # Update package.json version (without suffix - for consistency with browser stores)
    echo -e "${BLUE}Updating browser extension package.json version...${RESET}"
    update_version "../apps/browser-extension/package.json" \
        "\"version\": \"[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*[^\"]*\"," \
        "\"version\": \"$version\","

    # Update browser extension AppInfo.ts version
    echo -e "${BLUE}Updating browser extension AppInfo.ts version...${RESET}"
    update_version "../apps/browser-extension/src/utils/AppInfo.ts" \
        "public static readonly VERSION = '[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*[^']*';" \
        "public static readonly VERSION = '$display_version';"

    # Update generic mobile app version
    echo -e "${BLUE}Updating mobile app version...${RESET}"
    update_version "../apps/mobile-app/utils/AppInfo.ts" \
        "public static readonly VERSION = '[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*[^']*';" \
        "public static readonly VERSION = '$display_version';"
    update_version "../apps/mobile-app/app.json" \
        "\"version\": \"[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*[^\"]*\"," \
        "\"version\": \"$display_version\","

    # Update iOS app version (Apple doesn't accept stage suffixes in MARKETING_VERSION)
    echo -e "${BLUE}Updating iOS app version...${RESET}"
    update_version "../apps/mobile-app/ios/AliasVault.xcodeproj/project.pbxproj" \
        "MARKETING_VERSION = [0-9]\+\.[0-9]\+\.[0-9]\+[^;]*;" \
        "MARKETING_VERSION = $version;"

    # Update Android app version
    echo -e "${BLUE}Updating Android app version...${RESET}"
    update_version "../apps/mobile-app/android/app/build.gradle" \
        "versionName \"[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*[^\"]*\"" \
        "versionName \"$display_version\""

    # Update Safari extension version (Apple doesn't accept stage suffixes in MARKETING_VERSION)
    echo -e "${BLUE}Updating Safari extension version...${RESET}"
    update_version "../apps/browser-extension/safari-xcode/AliasVault.xcodeproj/project.pbxproj" \
        "MARKETING_VERSION = [0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*[^;]*;" \
        "MARKETING_VERSION = $version;"

    # Update Rust core version (Cargo.toml uses base version without suffix)
    echo -e "${BLUE}Updating Rust core version...${RESET}"
    update_version "../core/rust/Cargo.toml" \
        "^version = \"[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*[^\"]*\"" \
        "version = \"$version\""

    # Update Rust core Cargo.lock (aliasvault-core package version)
    echo -e "${BLUE}Updating Rust core Cargo.lock version...${RESET}"
    sed -i '' '/^name = "aliasvault-core"$/{n;s/version = "[^"]*"/version = "'"$version"'"/;}' "../core/rust/Cargo.lock"

    echo ""
    echo -e "${GREEN}✓ Version numbers updated successfully${RESET}"
fi

# Handle build numbers with semantic versioning
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${CYAN}Update semantic build numbers (for App Store releases)${RESET}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo "Format: MMmmppSXX (9 digits) where S=stage (1=alpha, 3=beta, 7=rc, 9=ga)"
if [[ -n "$version_suffix" ]]; then
    echo "Detected suffix: $version_suffix"
fi
printf "Example for version %d.%d.%d%s: \"" $major $minor $patch "$version_suffix"
if [[ "$version_suffix" =~ -alpha ]]; then
    printf "%02d%02d%02d100\" → %d" $major $minor $patch $((10#$(printf "%02d%02d%02d100" $major $minor $patch)))
elif [[ "$version_suffix" =~ -beta ]]; then
    printf "%02d%02d%02d300\" → %d" $major $minor $patch $((10#$(printf "%02d%02d%02d300" $major $minor $patch)))
elif [[ "$version_suffix" =~ -rc ]]; then
    printf "%02d%02d%02d700\" → %d" $major $minor $patch $((10#$(printf "%02d%02d%02d700" $major $minor $patch)))
else
    printf "%02d%02d%02d900\" → %d" $major $minor $patch $((10#$(printf "%02d%02d%02d900" $major $minor $patch)))
fi
echo " (leading zeros removed)"
echo ""

# Read current build numbers (if not already read for marketing update)
if [[ "$MARKETING_UPDATE" != true ]]; then
    # For iOS, read from main app target (identified by net.aliasvault.app bundle ID)
    ios_pbxproj="../apps/mobile-app/ios/AliasVault.xcodeproj/project.pbxproj"
    ios_main_line=$(grep -n "PRODUCT_BUNDLE_IDENTIFIER = net.aliasvault.app;" "$ios_pbxproj" | head -n1 | cut -d: -f1)
    ios_start_line=$((ios_main_line - 30))
    current_ios_build=$(sed -n "${ios_start_line},${ios_main_line}p" "$ios_pbxproj" | grep "CURRENT_PROJECT_VERSION" | head -n1 | sed 's/.*= //' | tr -d ';' | grep -E '^[0-9]+$')
    if [ -z "$current_ios_build" ]; then
        echo -e "${RED}Error: Could not read iOS build number or invalid format${RESET}"
        exit 1
    fi

    current_android_build=$(grep "versionCode" ../apps/mobile-app/android/app/build.gradle | grep -E "versionCode [0-9]+" | head -n1 | awk '{print $2}' | grep -E '^[0-9]+$')
    if [ -z "$current_android_build" ]; then
        echo -e "${RED}Error: Could not read Android build number or invalid format${RESET}"
        exit 1
    fi

    current_safari_build=$(grep -A1 "CURRENT_PROJECT_VERSION" ../apps/browser-extension/safari-xcode/AliasVault.xcodeproj/project.pbxproj | grep "CURRENT_PROJECT_VERSION = [0-9]\+;" | head -n1 | tr -d ';' | tr -d ' ' | cut -d'=' -f2 | grep -E '^[0-9]+$')
    if [ -z "$current_safari_build" ]; then
        echo -e "${RED}Error: Could not read Safari build number or invalid format${RESET}"
        exit 1
    fi
fi

# Handle iOS build number with semantic versioning
# Calculate new build numbers if not already done
if [[ "$MARKETING_UPDATE" != true ]]; then
    new_ios_build=$(handle_semantic_build_number "$current_ios_build" "iOS Mobile App" "$major" "$minor" "$patch" "$MARKETING_UPDATE")
    new_android_build=$(handle_semantic_build_number "$current_android_build" "Android App" "$major" "$minor" "$patch" "$MARKETING_UPDATE")
    new_safari_build=$(handle_semantic_build_number "$current_safari_build" "Safari Extension" "$major" "$minor" "$patch" "$MARKETING_UPDATE")
fi

# Update build numbers
update_version "../apps/mobile-app/ios/AliasVault.xcodeproj/project.pbxproj" \
    "CURRENT_PROJECT_VERSION = [0-9]\+;" \
    "CURRENT_PROJECT_VERSION = $new_ios_build;" \
    "iOS Mobile App"

update_version "../apps/mobile-app/android/app/build.gradle" \
    "versionCode [0-9]\+" \
    "versionCode $new_android_build" \
    "Android App"

update_version "../apps/browser-extension/safari-xcode/AliasVault.xcodeproj/project.pbxproj" \
    "CURRENT_PROJECT_VERSION = [0-9]\+;" \
    "CURRENT_PROJECT_VERSION = $new_safari_build;" \
    "Safari Extension"

echo ""
echo -e "${GREEN}✓ Build numbers updated successfully${RESET}"

# Show reminders
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${CYAN}Reminders${RESET}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

if [[ "$MARKETING_UPDATE" == true ]]; then
    # Install.sh reminder (only for version changes)
    echo -e "${YELLOW}• If you've made changes to install.sh since the last release, remember to increment its @version number in the header.${RESET}"

    if [[ -z "$version_suffix" ]]; then
        echo -e "${YELLOW}• Changelog files have been created and should be committed separately (as instructed earlier)${RESET}"
    else
        echo -e "${YELLOW}• Skipped changelog creation for pre-release version $display_version (only GA releases get published to app stores)${RESET}"
    fi
elif [[ "$BUILD_ONLY" == true ]]; then
    echo -e "${YELLOW}• Marketing version remained at: $version${RESET}"
    echo -e "${YELLOW}• Only build numbers were incremented${RESET}"
fi

# Write version information to text files for build processes (only for marketing updates)
if [[ "$MARKETING_UPDATE" == true ]]; then
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo -e "${CYAN}Writing version files for build processes${RESET}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo ""

    # Create version directory if it doesn't exist
    version_dir="../apps/.version"
    mkdir -p "$version_dir"

    # Write full version (with suffix if present)
    full_version="${version}${version_suffix}"
    echo "$full_version" > "$version_dir/version.txt"
    echo -e "${GREEN}✓ Wrote full version to .version/version.txt: $full_version${RESET}"

    # Write individual version components
    echo "$major" > "$version_dir/major.txt"
    echo "$minor" > "$version_dir/minor.txt"
    echo "$patch" > "$version_dir/patch.txt"
    echo "$version_suffix" > "$version_dir/suffix.txt"
    echo -e "${GREEN}✓ Wrote version components to .version/{major,minor,patch,suffix}.txt${RESET}"
fi

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
if [[ "$BUILD_ONLY" == true ]]; then
    echo -e "${GREEN}✅ Build-only update completed!${RESET}"
elif [[ "$MARKETING_UPDATE" == true ]]; then
    echo -e "${GREEN}✅ Marketing version and build update completed!${RESET}"
else
    echo -e "${GREEN}✅ Update completed!${RESET}"
fi
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"