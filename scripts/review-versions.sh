#!/usr/bin/env bash

# Check if running with bash
if [ -z "$BASH_VERSION" ]; then
    echo "Error: This script must be run with bash"
    echo "Usage: bash $0"
    exit 1
fi

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

# Function to extract version from iOS app
get_ios_version() {
    grep "MARKETING_VERSION = " ../apps/mobile-app/ios/AliasVault.xcodeproj/project.pbxproj | head -n1 | tr -d '"' | tr -d ';' | tr -d ' ' | cut -d'=' -f2
}

# Function to extract iOS build number
get_ios_build() {
    grep -A1 "CURRENT_PROJECT_VERSION" ../apps/mobile-app/ios/AliasVault.xcodeproj/project.pbxproj | grep "CURRENT_PROJECT_VERSION = [0-9]\+;" | head -n1 | tr -d ';' | tr -d ' ' | cut -d'=' -f2
}

# Function to extract version from Android app
get_android_version() {
    grep "versionName " ../apps/mobile-app/android/app/build.gradle | head -n1 | tr -d '"' | tr -d ' ' | cut -d'=' -f2 | sed 's/versionName//'
}

# Function to extract Android build number
get_android_build() {
    grep "versionCode" ../apps/mobile-app/android/app/build.gradle | grep -E "versionCode [0-9]+" | head -n1 | awk '{print $2}'
}

# Function to extract version from Safari extension
get_safari_version() {
    grep "MARKETING_VERSION = " ../apps/browser-extension/safari-xcode/AliasVault.xcodeproj/project.pbxproj | head -n1 | tr -d '"' | tr -d ';' | tr -d ' ' | cut -d'=' -f2
}

# Function to extract Safari build number
get_safari_build() {
    grep -A1 "CURRENT_PROJECT_VERSION" ../apps/browser-extension/safari-xcode/AliasVault.xcodeproj/project.pbxproj | grep "CURRENT_PROJECT_VERSION = [0-9]\+;" | head -n1 | tr -d ';' | tr -d ' ' | cut -d'=' -f2
}

# Collect all versions
server_version=$(get_server_version)
browser_wxt_version=$(get_browser_extension_version)
browser_package_version=$(get_browser_extension_package_json_version)
browser_ts_version=$(get_browser_extension_ts_version)
mobile_version=$(get_mobile_app_version)
mobile_ts_version=$(get_mobile_app_ts_version)
ios_version=$(get_ios_version)
ios_build=$(get_ios_build)
android_version=$(get_android_version)
android_build=$(get_android_build)
safari_version=$(get_safari_version)
safari_build=$(get_safari_build)

# Print table header
printf "%-50s %-20s %-15s\n" "Component" "Version" "Build Number"
echo "─────────────────────────────────────────────────────────────────────────────────"

# Server
printf "%-50s %-20s %-15s\n" "Server (AppInfo.cs)" "$server_version" "N/A"

# Browser Extension
echo ""
printf "%-50s %-20s %-15s\n" "Browser Extension (wxt.config.ts)" "$browser_wxt_version" "N/A"
printf "%-50s %-20s %-15s\n" "Browser Extension (package.json)" "$browser_package_version" "N/A"
printf "%-50s %-20s %-15s\n" "Browser Extension (AppInfo.ts)" "$browser_ts_version" "N/A"

# Safari Extension
echo ""
printf "%-50s %-20s %-15s\n" "Safari Extension (Xcode)" "$safari_version" "$safari_build"

# Mobile App
echo ""
printf "%-50s %-20s %-15s\n" "Mobile App (app.json)" "$mobile_version" "N/A"
printf "%-50s %-20s %-15s\n" "Mobile App (AppInfo.ts)" "$mobile_ts_version" "N/A"

# iOS
echo ""
printf "%-50s %-20s %-15s\n" "iOS App (Xcode)" "$ios_version" "$ios_build"

# Android
echo ""
printf "%-50s %-20s %-15s\n" "Android App (build.gradle)" "$android_version" "$android_build"

echo "────────────────────────────────────────────────────────────────────────────────────"