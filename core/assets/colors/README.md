# Colors

`palette.json` is the single source of truth for the AliasVault colors on every platform:

- `primary`: the brand color scale (`primary-50` to `primary-900`), used for every primary action, link, active state and brand accent.
- `theme.light` / `theme.dark`: the semantic theme colors of the mobile apps. A value is a `#rrggbb` color or a `primary.<shade>` reference.

Run `core/assets/sync.sh` (or `node core/models/scripts/generate-colors.cjs`) after a change. It writes:

| Output | Used by |
|--------|---------|
| `core/models/src/colors/Palette.ts` | TypeScript, as `@aliasvault/models/colors` (mobile `constants/Colors.ts`) |
| `core/models/src/colors/tailwind-preset.cjs` | the Tailwind configs of the web app, browser extension and admin |
| `apps/mobile-app/ios/VaultUI/ColorConstants.swift` | native iOS screens (autofill, passkeys) |
| `apps/mobile-app/android/app/src/main/res/values{,-night}/av_colors.xml` | native Android screens, as `@color/av_*` |
