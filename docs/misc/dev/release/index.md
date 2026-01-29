---
layout: default
title: Release
parent: Development
nav_order: 99
---

# Publish new release

Follow the steps in the checklist below to prepare a new release.

{: .toc }
* TOC
{:toc}

---

# Release preparation checklist

## Bump versions
All clients and server apps contain a version definition that needs to be updated with every release. This version is used for communication between components to ensure they are compatible with eachother. Versions are also used for official publication on the app stores.

For bumping the version for all projects in one go, you can use the interactive script located in:
```bash
./scripts/bump_version.sh
```

> If you prefer to update versions manually instead of using the interactive script, see the [Manual versioning](manual-versioning) page for detailed steps.

## Write changelogs
When a new version of the mobile apps and/or browser extensions is released, write changelogs and commit them to:
- iOS app: `./fastlane/metadata/ios/en-US/changelogs/[versionCode].txt`.
    > Filename should equal the `versionCode` in build.gradle.
- Android app: `./fastlane/metadata/android/en-US/changelogs/[versionCode].txt`.
    > Filename should equal the `versionCode` in build.gradle.
- Browser extensions: `./fastlane/metadata/browser-extension/en-US/changelogs/[semver].txt`.
    > Filename should equal the semver of the release (e.g. `0.20.0`).

## Update documentation
- [ ] Update /docs instructions for any relevant changes to functionality or self-host installaton process
- [ ] Update README screenshots if applicable
- [ ] Update README current/upcoming features

---

# Release flow
Follow the steps below to publish a new release to the various channels.

## Create a new release on GitHub
The creation of the new release tag will cause the `install.sh` script to see the new version via GitHub and prompt the user to update when `install.sh update` is run.

1. Create a new release on GitHub with a new tag in semver format, e.g. `0.12.0`.
2. Add a description to the release and generate the changelog.
3. Publish the release.

### Publish new Docker Images
The creation of the new release tag will automatically trigger the GitHub Actions workflow `Publish Docker Images` which will build the docker images and push them to the GitHub Container Registry. After publishing, the images will then be available for the installation script to pull during the update. Do take note that this publish step may take up to 15 minutes to complete. Between the creation of the release tag and the completion of the publish step, the installation script will not be able to pull the new images (yet) and can throw errors, this is expected. After the publish is completed, users can update their self-hosted installation by following the [update guide](/installation/update)

#### To locally build and publish the all-in-one Docker image:
GitHub Actions has had issues in the past with building the all-in-one Docker image for arm64 because of unknown timeouts. To locally build for both amd64 and arm64 and push manually, run the following:

**Docker Hub**
```bash
# Login to Docker Hub
docker login

# Build and push all-in-one image
# Note: replace 0.22.0 below with the actual tag of the version that you're building and pushing
docker buildx build --platform linux/amd64,linux/arm64/v8 \
  -f dockerfiles/all-in-one/Dockerfile \
  -t aliasvault/aliasvault:0.22.0 \
  -t aliasvault/aliasvault:latest \
  --push .
```

**Ghcr.io**
```bash
# Login to ghcr.io
docker login ghcr.io

# Build and push all-in-one image
# Note: replace 0.22.0 below with the actual tag of the version that you're building and pushing
docker buildx build --platform linux/amd64,linux/arm64/v8 \
  -f dockerfiles/all-in-one/Dockerfile \
  -t ghcr.io/aliasvault/aliasvault:0.22.0 \
  -t ghcr.io/aliasvault/aliasvault:latest \
  --push .
```

## Publish new browser extension version
The GitHub Actions workflow `Browser Extension Build` will build the browser extension(s) and publish the archive to the GitHub Actions Artifacts page and also upload the archives to the release.

> Note: this step is only required if the browser extension has been updated.

1. Download the browser extension archives from the newly published release. Note: it can take a few minutes for the artifacts to be available after the release has been published.
2. Upload the Chrome archive to the Chrome Web Store.
3. Upload the Firefox archive (normal + sources) to the Firefox Add-ons page.
4. Upload the Edge archive to the Microsoft Edge Add-ons page.
5. Submit the Safari extension to Apple for review:
    1. Navigate to the `apps/browser-extension` directory.
    2. Build the safari extension locally via `npm run build:safari`, which will output the build files to `dist/safari-mv2`. **Note: it's important to always rebuild, as otherwise stale build files from a previous build might get included in the Safari binary by accident!**
    3. Open the `apps/browser-extension/safari-xcode/AliasVault.xcodeproj` project in Xcode and submit the extension via the "Archive" and then "Distribute App" option.

## Publish new Mobile App version
1. Submit the iOS app to Apple for review:
    1. Open the `apps/mobile-app/ios/AliasVault.xcworkspace` project in Xcode and submit the extension via the "Archive" and then "Distribute App" option.
2. Submit the Android app to Google Play Console for review:
    1. Run the gradle build in the `apps/mobile-app/android` folder:
```bash
./gradlew app:bundleRelease
```
    2. The resulting .aab file will be available in the following location.
```bash
apps/mobile-ap/android/app/build/outputs/bundle/release
```
    3. Take this file and upload it to the Google Play Console.

### F-Droid automatic build and publish
Note: The AliasVault GitHub repo is connected to the F-Droid alternative Android App Store. When a new Git release is published, F-Droid will automatically pull the latest changes, read the Fastlane metadata to retrieve the changelog, and build the app itself. This process is fully automatic, and publishing can take 2-3 days.

The AliasVault Android app build is configured by the following file which is part of the official `fdroiddata` repo on GitLab:
[https://gitlab.com/fdroid/fdroiddata/-/blob/master/metadata/net.aliasvault.app.yml](https://gitlab.com/fdroid/fdroiddata/-/blob/master/metadata/net.aliasvault.app.yml)

If any changes were made to the Android app build process or if any new third party (expo) packages have been installed, make sure it still
works with the F-Droid build process. This can be tested either locally via `fdroid build`, or it can be done by creating a new test commit in
a forked `fdroiddata` repo on GitLab and making the `net.aliasvault.app.yml` point to the latest main branch. This way you can test whether
the build itself works properly with the latest version before actually publishing a new release.