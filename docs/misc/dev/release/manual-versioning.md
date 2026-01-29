---
layout: default
title: Manual versioning
parent: Release
grand_parent: Development
nav_order: 2
---

# Manual Versioning Steps

Alternatively, you can do it manually by following these steps:

## Versioning client and server
- [ ] Update ./apps/server/Shared/AliasVault.Shared.Core/AppInfo.cs and update major/minor/patch to the new version. This version will be shown in the client and admin app footer. This version should be equal to the git release tag.
- [ ] Update ./apps/server/Shared/AliasVault.Shared.Core/AppInfo.cs with the minimum supported client versions.
    - Only required if new API output breaks earlier client versions and/or this version of the client/API will upgrade the client vault model to a new major version.
- [ ] Update ./install.sh `@version` number in header ONLY if the install script content has changed since the last release. Increment the number by 1. This allows the install script to self-update when running the `./install.sh update` command on default installations. Note: This is a simple build number (not semver) that is independent of the release version - only increment it when install.sh actually changes.

## Versioning browser extensions
- [ ] Update `./apps/browser-extension/wxt.config.ts` with the new version for the extension. This will be shown in the browser extension web stores. This version should be equal to the git release tag.
- [ ] Update `./apps/browser-extension/safari-xcode/AliasVault.xcodeproj/project.pbxproj` and set the version in `MARKETING_VERSION` and increase the build number in `CURRENT_PROJECT_VERSION`. This is the version that will be shown in the Safari Browser Extension App Store.
- [ ] Update `./apps/browser-extension/src/utils/AppInfo.ts` with the new version for the extension. This version should be equal to the git release tag.
- [ ] Update `./apps/browser-extension/src/utils/AppInfo.ts` with the minimum supported server version (in case of required API breaking changes).
- [ ] Update `./apps/browser-extension/src/utils/AppInfo.ts` with the minimum supported client vault version (in case of required client vault model changes).

## Versioning mobile apps
- [ ] Update `./apps/mobile-app/app.json` with the new version for the mobile app. This version should be equal to the git release tag.
- [ ] Update `./apps/mobile-app/utils/AppInfo.ts` with the new version for the mobile app. This version should be equal to the git release tag.
- [ ] Update `./apps/mobile-app/utils/AppInfo.ts` with the minimum supported server version (in case of required API breaking changes).
- [ ] Update `./apps/mobile-app/utils/AppInfo.ts` with the minimum supported client vault version (in case of required client vault model changes).
- [ ] Update `./apps/mobile-app/ios/AliasVault.xcodeproj/project.pbxproj` and set the version in `MARKETING_VERSION` and increase the build number in `CURRENT_PROJECT_VERSION`. This is the version that will be shown in the iOS App Store.
- [ ] Update `./apps/mobile-app/android/app/build.gradle` and set the version in `versionName` and increase the build number in `versionCode`.

## Install script (docker images)
If docker containers have been added or removed:
- [ ] Verify that `.github/workflows/release.yml` contains references to all docker images that need to be published.
- [ ] Update `install.sh` and verify that the `images=()` array that takes care of pulling the images from the GitHub Container Registry is updated.