import React from 'react';

import type { ItemTypeIconKey } from '@/utils/dist/core/models/icons';
import { ItemTypeIconSvgs } from '@/utils/dist/core/models/icons';
import type { Item } from '@/utils/dist/core/models/vault';
import {
  FieldKey,
  ItemTypes,
} from '@/utils/dist/core/models/vault';
import SqliteClient from '@/utils/SqliteClient';

type ItemIconProps = {
  item: Item;
  className?: string;
};

/**
 * Renders an SVG string as a React component using dangerouslySetInnerHTML.
 * The SVG is wrapped in a div to apply className for sizing.
 */
const SvgIcon: React.FC<{ svg: string; className?: string }> = ({ svg, className = 'w-8 h-8' }) => (
  <div
    className={`${className} flex-shrink-0`}
    dangerouslySetInnerHTML={{ __html: svg }}
  />
);

/**
 * Detect credit card brand from card number using BIN prefixes.
 */
const detectCardBrand = (cardNumber: string | undefined): ItemTypeIconKey => {
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
 * Get the appropriate SVG icon for a credit card brand.
 */
const getCardIconSvg = (cardNumber: string | undefined): string => {
  return ItemTypeIconSvgs[detectCardBrand(cardNumber)];
};

/**
 * ItemIcon component - displays contextually appropriate icons based on item type
 *
 * For Login/Alias: Uses the Logo field if available, falls back to placeholder
 * For CreditCard: Shows card brand icons (Visa, Mastercard, Amex, Discover) based on card number
 * For Note: Shows a document/note icon
 */
const ItemIcon: React.FC<ItemIconProps> = ({ item, className = 'w-8 h-8' }) => {
  // For Note type, always show note icon
  if (item.ItemType === ItemTypes.Note) {
    return <SvgIcon svg={ItemTypeIconSvgs.Note} className={className} />;
  }

  // For CreditCard type, detect card brand and show appropriate icon
  if (item.ItemType === ItemTypes.CreditCard) {
    const cardNumberField = item.Fields?.find(f => f.FieldKey === FieldKey.CardNumber);
    const cardNumber = cardNumberField?.Value
      ? (Array.isArray(cardNumberField.Value) ? cardNumberField.Value[0] : cardNumberField.Value)
      : undefined;

    return <SvgIcon svg={getCardIconSvg(cardNumber)} className={className} />;
  }

  // For Login/Alias types, use Logo if available, otherwise placeholder
  const logoSrc = item.Logo && item.Logo.length > 0 ? SqliteClient.imgSrcFromBytes(item.Logo) : null;

  if (logoSrc) {
    return (
      <img
        src={logoSrc}
        alt={item.Name || 'Item'}
        className={`${className} flex-shrink-0`}
        onError={(e) => {
          // On error, replace with placeholder icon
          const target = e.target as HTMLImageElement;
          target.style.display = 'none';
          const parent = target.parentElement;
          if (parent) {
            const placeholder = document.createElement('div');
            placeholder.className = className;
            placeholder.innerHTML = ItemTypeIconSvgs.Placeholder;
            parent.insertBefore(placeholder, target);
          }
        }}
      />
    );
  }

  // Default placeholder for Login/Alias without logo
  return <SvgIcon svg={ItemTypeIconSvgs.Placeholder} className={className} />;
};

export default ItemIcon;

// Export the SvgIcon component and icon utilities for direct use if needed
export { SvgIcon, getCardIconSvg };
