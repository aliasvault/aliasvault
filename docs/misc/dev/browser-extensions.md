---
layout: default
title: Browser extensions
parent: Development
grand_parent: Miscellaneous
nav_order: 3
---

# Browser extensions
AliasVault offers browser extensions compatible with both Chrome and Firefox. This guide explains how to build and debug the extensions locally.

## Development Setup
The browser extensions are built using:
- React: https://react.dev/
- WXT: https://wxt.dev/ (A framework for cross-browser extension development)
- Vite: https://vitejs.dev/

### Install dependencies
Make sure you have Node.js installed on your host machine, then install the dependencies:

```bash
cd apps/browser-extension
npm install
```

### Development Mode
WXT provides a development mode that automatically reloads changes and opens a new browser window with the extension loaded:

```bash
# For Google Chrome development
npm run dev:chrome

# For Firefox development
npm run dev:firefox

# For Microsoft Edge development
npm run dev:edge
```

## Building and Loading the Extensions Manually

### Google Chrome

1. Build the extension:
```bash
npm run build:chrome
```

2. Load in Chrome:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" in the top right corner
   - Click "Load unpacked" and the folder `./apps/browser-extension/dist/chrome-mv3`

### Firefox

1. Build the extension:
```bash
npm run build:firefox
```

2. Load in Firefox:
   - Open Firefox and navigate to `about:debugging`
   - Click "This Firefox" in the left sidebar
   - Click "Load Temporary Add-on"
   - Navigate to the `./apps/browser-extension/dist/firefox-mv2` folder and select the `manifest.json` file

### Microsoft Edge

1. Build the extension:
```bash
npm run build:edge
```

2. Load in Edge:
   - Open Edge and navigate to `edge://extensions/`
   - Enable "Developer mode" in the top right corner
   - Click "Load unpacked" and the folder `./apps/browser-extension/dist/edge-mv3`

### Safari

1. Build the extension:
```bash
npm run build:safari
```

2. Open the Xcode project in the `safari-xcode/AliasVault/AliasVault.xcodeproj` folder and build / run the app.

3. The extension will be installed automatically in Safari. Follow the on-screen MacOS app instructions to complete the installation.

## Automatic tests
The extension has a suite of automatic tests that are run on every pull request. These tests are located in the `__tests__` directories scattered throughout the browser extension codebase.

### Run the tests
To run the tests locally, you can use the `npm run test` command. This will run all tests.

```bash
npm run test
```

## Manual tests
In order to test for client side issues, here is a list of public websites that have caused issues in the past and can be used to test whether the extension is (still) working correctly.

### Websites that have caused issues
The following websites have been known to cause issues in the past (but should be fixed now). After making changes to the extension, you can test whether the extension is (still) working correctly by using the websites below.

| Website | Reason |
| --- | --- |
| [Paprika Shopping](https://www.paprika-shopping.nl/nieuwsbrief/newsletter-register-landing.html) | Popup CSS style conflicts |
| [Bloshing](https://bloshing.com/inschrijven-nieuwsbrief) | Popup CSS style conflicts |
| [GameFAQs](https://gamefaqs.gamespot.com/user) | Popup buttons not working |
| [Hacker News](https://news.ycombinator.com/login?goto=news) | Popup and client favicon not showing due to SVG format |
| [Bitwarden](https://vault.bitwarden.com/#/login) | Autofill password not detected (input not long enough), manually typing in works |
| [Microsoft Online](https://login.microsoftonline.com/) | Password gets reset after autofill |
| [ING Bank](https://mijn.ing.nl/login/) | Autofill doesn't detect input fields and AliasVault autofill icon placement is off |
| [GitHub Issues](https://github.com/aliasvault/aliasvault/issues) | The "New issue -> Blank Issue" title field causes the autofill to trigger because of a parent form (outside of the role=modal div) |
| [Netim](https://www.netim.com/direct/) | Autofill popup not showing up |
| [ChatGPT login](https://auth.openai.com/log-in) | Autofill popup not showing up |
| TrueNAS (self-hosted login page) | Some characters in password field are inserted double. E.g. `abcde` in AliasVault becomes `abbccdee` in password field. |
