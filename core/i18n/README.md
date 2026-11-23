# @aliasvault/i18n

This folder contains the centralized translations for all AliasVault clients: web app, browser extension and mobile app.

All client apps either embed these translation files directly, or appropriate translation files are generated from this single source-of-truth. 

## Crowdin integration
Crowdin is used for managing translations, and it looks at the `locales/en.json` for its translation source strings. All other `[lang].json` files are managed, created and updated by Crowdin and periodically merged via PRs.

## Language codes
UI languages and their locale files use the two-letter ISO 639-1 code (`nl`, `nl.json`). A language with more than one variant in Crowdin uses a regional code per variant instead (`pt-BR`, `pt-PT`): Crowdin's `%two_letters_code%` is the same for both variants, so `languages_mapping` in `crowdin.yml` gives each variant its own file.

`languages.json` holds the UI languages (`uiLanguages`) and, per language, the display info and `alternativeCodes` (locale tags that map onto it). `matchAvailableLanguage` resolves a stored setting or a browser/device locale in three steps: exact code, then `alternativeCodes`, then the base language matched the same way. The variant that lists the bare code in its `alternativeCodes` (`pt-BR` lists `pt`) is the default for its language, which covers a `pt` stored before the split and regions without an entry.

A UI language is registered in:
- the Crowdin project settings (target language)
- `languages.json` (`uiLanguages`, plus a `languages` entry)
- `src/all.ts` and `src/load.ts` (locale imports)
- Android `res/xml/locales_config.xml`, iOS `knownRegions` in `project.pbxproj` and `CFBundleLocalizations` in `AliasVault/Info.plist` and `Autofill/Info.plist`

## Native translation files
The iOS `.strings` and Android `strings.xml` files of the mobile app are generated from `locales/`, using the map in
`exports/mobile-native.json` (native file and key -> shared key). iOS folders take the language code as-is (`pt-BR.lproj`); Android writes a two-letter region as an `r` qualifier (`values-pt-rBR`) and any other tag in BCP 47 form (`values-b+zh+Hant`). Run `npm run export:native` (in `core/i18n`) or `npm run i18n:export-native` (in `apps/mobile-app`) after changing `en.json` or merging a Crowdin pull request; `npm run export:native:check` reports files that are out of date.

## Translator hints
`hints.json` holds an optional hint per key (key -> hint) for translators. `npm run hints:push` (in `core/i18n`) copies
them into the context of the Crowdin strings; it needs `CROWDIN_PROJECT_ID` and `CROWDIN_PERSONAL_TOKEN` in the
environment. `npm run hints:push:dry-run` only lists what would change.
