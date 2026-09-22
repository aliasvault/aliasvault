import { LogoKinds } from '@aliasvault/models/vault';

import type { ItemLogo, LogoSelection } from '@aliasvault/models/vault';

/**
 * Whether a choice leaves the icon following the item's URL. No choice at all means the same.
 * @param selection - the unsaved choice, if any.
 */
export function usesWebsiteLogo(selection: LogoSelection | undefined): boolean {
  return !selection || selection.Kind === LogoKinds.Favicon;
}

/**
 * The logo the item will show once saved (shown in edit UI).
 * @param storedLogo - the logo the item has in the vault.
 * @param pendingSelection - the unsaved choice, if any.
 * @param faviconSource - the domain the editor resolved from the URL field, when following the website.
 */
export function effectiveItemLogo(storedLogo: ItemLogo | undefined, pendingSelection: LogoSelection | undefined, faviconSource: string | null | undefined): ItemLogo | undefined {
  if (!pendingSelection) {
    return storedLogo;
  }
  if (pendingSelection.Kind === LogoKinds.Favicon) {
    return faviconSource ? { Id: '', Kind: LogoKinds.Favicon, Source: faviconSource } : undefined;
  }
  return { Id: '', Kind: pendingSelection.Kind, Source: pendingSelection.Source ?? '', Name: pendingSelection.Name };
}

/**
 * The translation key describing where a logo comes from. The favicon key takes a `domain` parameter.
 * @param logo - the logo, or undefined when the item shows none.
 */
export function logoSourceTranslationKey(logo: ItemLogo | undefined): string {
  switch (logo?.Kind) {
    case LogoKinds.Builtin:
      return 'items.logo.sourceBuiltin';
    case LogoKinds.Custom:
      return 'items.logo.sourceCustom';
    case LogoKinds.Favicon:
      return 'items.logo.sourceFavicon';
    default:
      return 'items.logo.sourceNone';
  }
}
