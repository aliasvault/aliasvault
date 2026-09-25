import { LogoKinds } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { effectiveItemLogo, logoSourceTranslationKey, usesWebsiteLogo } from '../ItemLogoView';

import type { ItemLogo } from '@aliasvault/models/vault';

const stored: ItemLogo = { Id: 'logo-1', Kind: LogoKinds.Builtin, Source: 'Bank' };

describe('usesWebsiteLogo', () => {
  it('follows the website without a choice or with a favicon choice', () => {
    expect(usesWebsiteLogo(undefined)).toBe(true);
    expect(usesWebsiteLogo({ Kind: LogoKinds.Favicon })).toBe(true);
    expect(usesWebsiteLogo({ Kind: LogoKinds.Builtin, Source: 'Mail' })).toBe(false);
  });
});

describe('effectiveItemLogo', () => {
  it('keeps the stored logo while nothing was chosen', () => {
    expect(effectiveItemLogo(stored, undefined, 'example.com')).toBe(stored);
  });

  it('previews a built-in choice over the stored logo', () => {
    expect(effectiveItemLogo(stored, { Kind: LogoKinds.Builtin, Source: 'Mail' }, null)).toEqual({ Id: '', Kind: LogoKinds.Builtin, Source: 'Mail', Name: undefined });
  });

  it('previews the resolved domain when going back to the website icon', () => {
    expect(effectiveItemLogo(stored, { Kind: LogoKinds.Favicon }, 'example.com')).toEqual({ Id: '', Kind: LogoKinds.Favicon, Source: 'example.com' });
    expect(effectiveItemLogo(stored, { Kind: LogoKinds.Favicon }, null)).toBeUndefined();
  });
});

describe('logoSourceTranslationKey', () => {
  it('names each kind and the absence of a logo', () => {
    expect(logoSourceTranslationKey(undefined)).toBe('items.logo.sourceNone');
    expect(logoSourceTranslationKey(stored)).toBe('items.logo.sourceBuiltin');
    expect(logoSourceTranslationKey({ Id: '', Kind: LogoKinds.Custom, Source: 'abc' })).toBe('items.logo.sourceCustom');
    expect(logoSourceTranslationKey({ Id: '', Kind: LogoKinds.Favicon, Source: 'example.com' })).toBe('items.logo.sourceFavicon');
  });
});
