# Icons

All icons of the AliasVault apps, one source of truth for every platform.

- `ui/`: UI icons, drawn in `currentColor` so they take the text color.
- `item/`: item type icons (placeholder, note, card brands).
- `builtin-logo/`: built-in logos a user can pick for an item. The PascalCase form of the file name (`shopping.svg` is `Shopping`) is stored in the vault, never rename one.
- `sources.json`: where each icon comes from. Every icon needs an entry.

Run `core/assets/sync.sh` (or `node core/models/scripts/generate-icons.cjs`) after editing an icon to generate the catalogs for all platforms
(`core/models/src/icons`, `@aliasvault/models/icons` for TypeScript).

## Sources

See `sources.json` for the full list of the source of each icon.

Licenses that apply: heroicons, Feather, Lucide and Zondicons are MIT or ISC licensed, Material Symbols is Apache 2.0.
