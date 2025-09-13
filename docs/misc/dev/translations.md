---
layout: default
title: Translations
parent: Development
grand_parent: Miscellaneous
nav_order: 3
---

# Translations

AliasVault supports multiple languages across all applications. Currently supported languages:
- English
- Dutch
- German
- Finnish
- Hebrew
- Italian
- Ukrainian
- Chinese (Simplified)

---

## Adding a New Language

To add a new language to AliasVault, follow these steps in order:

### Step 1: Configure Crowdin Integration

1. **Update crowdin.yml**: Add the new language identifier to the `crowdin.yml` file in the root of the repository
2. **Crowdin will automatically**:
   - Fetch changes from the `main` branch
   - Offer new content for translation in the Crowdin web interface
   - Create translation files for the new language

### Step 2: Web App (Blazor WASM)

1. **Add language to LanguageService**: Update `apps/server/AliasVault.Client/Services/LanguageService.cs` with the new language identifier
2. **Translation files to create (optional, Crowdin should make a PR for this automatically)**:
   - `apps/server/AliasVault.Client/wwwroot/locales/{language-code}.json`
   - `apps/server/AliasVault.Client/Resources/{language-code}.resx` files

### Step 3: Browser Extension

1. **Add language identifier to config**: Update `/apps/browser-extension/src/utils/i18n/config.ts` and insert new language based on existing structure
1. **Create language file (optional, Crowdin should make a PR for this automatically)**:
   - `apps/browser-extension/src/locales/{language-code}.json`

### Step 4: Mobile App - React Native

1. **Add language identifier to config:** Update `/apps/mobile-app/i18n/index.ts` and insert new language based on existing structure
2 **Create translation file (optional, Crowdin should make a PR for this automatically)**: `apps/mobile-app/i18n/locales/{language-code}.json`

### Step 5: Mobile App - iOS Native

**Location**: `apps/mobile-app/ios/`

2. **Add language in Xcode**:
   - Open workspace in Xcode
   - Go to target "AliasVault" > Project settings "Info" > Localizations
   - Add the desired language
   - Repeat the two steps above for target "Autofill" as well.

3. **Translation files to create (optional, Crowdin should make a PR for this automatically)**:
   - `AliasVault/{language-code}.lproj/Localizable.strings`
   - `AliasVault/{language-code}.lproj/InfoPlist.strings`
   - `Autofill/{language-code}.lproj/Localizable.strings`
   - `VaultUI/{language-code}.lproj/Localizable.strings`

### Step 6: Mobile App - Android Native

**Location**: `apps/mobile-app/android/app/src/main/res/`

1. **Update locales config**: Add the language to `xml/locales_config.xml`
2. **Create translation file (optional, Crowdin should make a PR for this automatically)**: `values-{language-code}/strings.xml`

## Translation File Locations Summary

### React Native mobile app:
- `apps/mobile-app/i18n/locales/en.json`
- `apps/mobile-app/i18n/locales/nl.json`

### Browser Extension:
- `apps/browser-extension/src/locales/en/**/*.json`
- `apps/browser-extension/src/locales/nl/**/*.json`

### Web App (Blazor WASM):
- `apps/server/AliasVault.Client/wwwroot/locales/en.json`
- `apps/server/AliasVault.Client/wwwroot/locales/nl.json`
- `apps/server/AliasVault.Client/Resources/**/*.en.resx`
- `apps/server/AliasVault.Client/Resources/**/*.nl.resx`

### Android app native:
- `apps/mobile-app/android/app/src/main/res/values/strings.xml` (default, English)
- `apps/mobile-app/android/app/src/main/res/values-nl/strings.xml` (Dutch)

### iOS app native:
- `apps/mobile-app/ios/AliasVault/en.lproj/Localizable.strings` (default, English)
- `apps/mobile-app/ios/AliasVault/nl.lproj/Localizable.strings` (Dutch)
- `apps/mobile-app/ios/Autofill/en.lproj/Localizable.strings` (default, English)
- `apps/mobile-app/ios/Autofill/nl.lproj/Localizable.strings` (Dutch)
- `apps/mobile-app/ios/VaultUI/en.lproj/Localizable.strings` (default, English)
- `apps/mobile-app/ios/VaultUI/nl.lproj/Localizable.strings` (Dutch)

## Crowdin Integration

AliasVault uses Crowdin for translation management with GitHub App integration. The project is configured with a centralized `crowdin.yml` file in the root of the repository that manages all translation files across the monorepo.

The Crowdin GitHub App automatically:
- Fetches changes from the `main` branch as soon as they become available
- Offers new content for translation in the Crowdin web interface
- Manages translation file synchronization across all applications

Installing Crowdin CLI on MacOS for manually syncing source files:

```bash
brew tap crowdin/crowdin
brew install crowdin@4
brew link --force --overwrite crowdin@4
```

To test uploading of source files via CLI to detect any issues with formatting:

```bash
crowdin upload --token=[api_token] --project-id=808100
```

Example output which may indicate errors:

```bash
✔️  Directory 'apps/mobile-app/ios/Autofill'
✔️  Directory 'apps/mobile-app/ios/Autofill/en.lproj'
❌ File 'apps/mobile-app/ios/Autofill/en.lproj/Localizable.strings'
❌ Wrong parameters:
<key: type, code: callbackValue, message: Unsupported type>
✔️  Directory 'apps/mobile-app/android'
✔️  Directory 'apps/mobile-app/android/app'
✔️  Directory 'apps/mobile-app/android/app/src'
✔️  Directory 'apps/mobile-app/android/app/src/main'
✔️  Directory 'apps/mobile-app/android/app/src/main/res'
✔️  Directory 'apps/mobile-app/android/app/src/main/res/values'
✔️  File 'apps/mobile-app/android/app/src/main/res/values/strings.xml'
````

