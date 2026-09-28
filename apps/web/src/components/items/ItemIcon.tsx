import SqliteClient from '@aliasvault/client/database/SqliteClient';
import { getAppIconSvg, ItemTypeIconSvgs } from '@aliasvault/models/icons';
import { FieldKey, ItemTypes, LogoKinds, type Item } from '@aliasvault/models/vault';
import React, { useState } from 'react';

import type { ItemTypeIconKey } from '@aliasvault/models/icons';

type ItemIconProps = {
  item: Item;
  altText?: string;
  /** Tailwind size classes. */
  sizeClass?: string;
};

/**
 * Render an SVG string inside a sized wrapper.
 */
const SvgIcon: React.FC<{ svg: string; sizeClass: string }> = ({ svg, sizeClass }) => (
  <span className={`${sizeClass} flex-shrink-0 inline-block [&>svg]:w-full [&>svg]:h-full`} dangerouslySetInnerHTML={{ __html: svg }} />
);

/**
 * Detect the credit card brand from the card number's BIN prefix.
 * @param cardNumber - the card number
 */
const detectCardBrand = (cardNumber: string | null | undefined): ItemTypeIconKey => {
  if (!cardNumber) {
    return 'CreditCard';
  }
  const cleaned = cardNumber.replace(/[\s-]/g, '');
  if (!/^\d{4,}/.test(cleaned)) {
    return 'CreditCard';
  }
  if (/^4/.test(cleaned)) {
    return 'Visa';
  }
  if (/^5[1-5]/.test(cleaned) || /^2[2-7]/.test(cleaned)) {
    return 'Mastercard';
  }
  if (/^3[47]/.test(cleaned)) {
    return 'Amex';
  }
  if (/^6(?:011|22|4[4-9]|5)/.test(cleaned)) {
    return 'Discover';
  }
  return 'CreditCard';
};

/**
 * The icon of an item: a logo the user picked, else the favicon for logins and aliases, the card brand for
 * credit cards, and the note icon for notes.
 */
const ItemIcon: React.FC<ItemIconProps> = ({ item, altText, sizeClass = 'w-10 h-10' }) => {
  const [imageFailed, setImageFailed] = useState(false);

  const chosen = item.LogoInfo && item.LogoInfo.Kind !== LogoKinds.Favicon ? item.LogoInfo : null;
  if (chosen?.Kind === LogoKinds.Builtin) {
    const builtinSvg = getAppIconSvg(chosen.Source);
    if (builtinSvg) {
      return <SvgIcon svg={builtinSvg} sizeClass={sizeClass} />;
    }
  }
  if (chosen?.Kind === LogoKinds.Custom) {
    const uploadedSrc = item.Logo ? SqliteClient.imgSrcFromBytes(item.Logo) : null;
    if (uploadedSrc && !imageFailed) {
      return <img src={uploadedSrc} alt={altText ?? item.Name ?? 'Item'} className={`${sizeClass} flex-shrink-0 rounded-lg`} loading="lazy" decoding="async" onError={() => setImageFailed(true)} />;
    }
  }

  if (item.ItemType === ItemTypes.Note) {
    return <SvgIcon svg={ItemTypeIconSvgs.Note} sizeClass={sizeClass} />;
  }

  if (item.ItemType === ItemTypes.CreditCard) {
    const cardNumberField = item.Fields?.find(f => f.FieldKey === FieldKey.CardNumber);
    const cardNumber = cardNumberField?.Value ? (Array.isArray(cardNumberField.Value) ? cardNumberField.Value[0] : cardNumberField.Value) : undefined;
    return <SvgIcon svg={ItemTypeIconSvgs[detectCardBrand(cardNumber)]} sizeClass={sizeClass} />;
  }

  const logoSrc = item.Logo && !imageFailed ? SqliteClient.imgSrcFromBytes(item.Logo) : null;
  if (logoSrc) {
    return <img src={logoSrc} alt={altText ?? item.Name ?? 'Item'} className={`${sizeClass} flex-shrink-0 rounded-lg`} loading="lazy" decoding="async" onError={() => setImageFailed(true)} />;
  }

  return <SvgIcon svg={ItemTypeIconSvgs.Placeholder} sizeClass={sizeClass} />;
};

export default ItemIcon;
