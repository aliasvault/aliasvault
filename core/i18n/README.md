# @aliasvault/i18n

This folder contains the centralized translations for all AliasVault clients: web app, browser extension and mobile app.

All client apps either embed these translation files directly, or appropriate translation files are generated from this single source-of-truth. 

## Crowdin integration
Crowdin is used for managing translations, and it looks at the `locales/en.json` for its translation source strings. All other `[lang].json` files are managed, created and updated by Crowdin and periodically merged via PRs.

## Native translation files
The iOS `.strings` and Android `strings.xml` files of the mobile app are generated from `locales/`, using the map in
`exports/mobile-native.json` (native file and key -> shared key). Run `npm run export:native` (in `core/i18n`) or `npm run i18n:export-native` (in `apps/mobile-app`) after changing `en.json` or merging a Crowdin pull request; `npm run export:native:check` reports files that are out of date.

## Translator hints
`hints.json` holds an optional hint per key (key -> hint) for translators. `npm run hints:push` (in `core/i18n`) copies
them into the context of the Crowdin strings; it needs `CROWDIN_PROJECT_ID` and `CROWDIN_PERSONAL_TOKEN` in the
environment. `npm run hints:push:dry-run` only lists what would change.
