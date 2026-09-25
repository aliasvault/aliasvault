This folder contains the Xcode project used to publish the Safari version of the AliasVault browser extension to Apple.

This project was created using the `safari-web-extension-converter` tool. This XCode project is a simple wrapper around the
WXT React browser extension, which is required by Apple in order to package and submit a Safari extension.

For more information see:
- https://developer.apple.com/documentation/safariservices/converting-a-web-extension-for-safari
- https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension

To recreate this project, run the following command in the browser-extension root directory:

```bash
# Build the Safari extension via the normal build process (outputs in dist/safari-mv2)
npm run build:safari

# Convert the safari extension to an Xcode project (requires MacOS/XCode command line interface)
xcrun safari-web-extension-converter --bundle-identifier net.aliasvault.safari --macos-only dist/safari-mv2 --project-location build-assets/safari-xcode --force

# After the Xcode project is opened, you can run the extension by clicking the "Run" button in the top left corner of the Xcode window.
# This will install the extension to your Safari browser and allow you to run it.
```

> Note: This project does not need to be recreated when the extension is updated. It loads all extension files from the dist/safari-mv2 directory that is created by the `build:safari` command. To update the extension and/or publish a new version:
> 1. Run `npm run build:safari` to rebuild the Safari extension
> 2. Open this Xcode project and rebuild it to get the latest version
> 3. Submit the extension to Apple for review via Xcode:
>    - Select the "Archive" option from the Product menu
>    - Select the newly created archive and click "Distribute App"
>    - Select "Distribute" and follow the instructions to submit to App Store Connect
