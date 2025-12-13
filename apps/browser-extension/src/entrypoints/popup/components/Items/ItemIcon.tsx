import React from 'react';

import type { Item } from '@/utils/dist/core/models/vault';
import { FieldKey, ItemTypes } from '@/utils/dist/core/models/vault';
import SqliteClient from '@/utils/SqliteClient';

type ItemIconProps = {
  item: Item;
  className?: string;
};

/**
 * Credit card brand type
 */
type CardBrand = 'visa' | 'mastercard' | 'amex' | 'discover' | 'generic';

/**
 * Detect credit card brand from card number using industry-standard prefixes
 * @param cardNumber - The card number to detect brand from
 * @returns The detected card brand
 */
const detectCardBrand = (cardNumber: string | undefined): CardBrand => {
  if (!cardNumber) {
    return 'generic';
  }

  // Remove spaces and dashes
  const cleaned = cardNumber.replace(/[\s-]/g, '');

  // Must be mostly numeric
  if (!/^\d{4,}/.test(cleaned)) {
    return 'generic';
  }

  // Visa: starts with 4
  if (/^4/.test(cleaned)) {
    return 'visa';
  }

  // Mastercard: starts with 51-55 or 2221-2720
  if (/^5[1-5]/.test(cleaned) || /^2[2-7]/.test(cleaned)) {
    return 'mastercard';
  }

  // Amex: starts with 34 or 37
  if (/^3[47]/.test(cleaned)) {
    return 'amex';
  }

  // Discover: starts with 6011, 622, 644-649, 65
  if (/^6(?:011|22|4[4-9]|5)/.test(cleaned)) {
    return 'discover';
  }

  return 'generic';
};

/**
 * Generic credit card icon in AliasVault style
 */
const CreditCardIcon: React.FC<{ className?: string }> = ({ className = 'w-8 h-8' }) => (
  <svg
    className={className}
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="2" y="6" width="28" height="20" rx="3" fill="#f49541" />
    <rect x="2" y="11" width="28" height="4" fill="#d68338" />
    <rect x="5" y="18" width="8" height="2" rx="1" fill="#ffe096" />
    <rect x="5" y="22" width="5" height="1.5" rx="0.75" fill="#fbcb74" />
  </svg>
);

/**
 * Visa card icon in AliasVault style
 */
const VisaIcon: React.FC<{ className?: string }> = ({ className = 'w-8 h-8' }) => (
  <svg
    className={className}
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="2" y="6" width="28" height="20" rx="3" fill="#f49541" />
    <path
      d="M13.5 13L11.5 19H10L8.5 14.5C8.5 14.5 8.35 14 8 14C7.65 14 7 13.8 7 13.8L7.05 13.5H9.5C9.85 13.5 10.15 13.75 10.2 14.1L10.8 17L12.5 13.5H13.5V13ZM15 19H14L15 13H16L15 19ZM20 13.5C20 13.5 19.4 13.3 18.7 13.3C17.35 13.3 16.4 14 16.4 15C16.4 15.8 17.1 16.2 17.65 16.5C18.2 16.8 18.4 17 18.4 17.2C18.4 17.5 18.05 17.7 17.6 17.7C17 17.7 16.5 17.5 16.5 17.5L16.3 18.7C16.3 18.7 16.9 19 17.7 19C19.2 19 20.1 18.2 20.1 17.1C20.1 15.7 18.4 15.6 18.4 15C18.4 14.7 18.7 14.5 19.15 14.5C19.6 14.5 20.1 14.7 20.1 14.7L20.3 13.5H20V13.5ZM24 19L23.1 13.5H22C21.7 13.5 21.45 13.7 21.35 13.95L19 19H20.5L20.8 18H22.7L22.9 19H24ZM21.2 17L22 14.5L22.45 17H21.2Z"
      fill="#ffe096"
    />
  </svg>
);

/**
 * Mastercard icon in AliasVault style
 */
const MastercardIcon: React.FC<{ className?: string }> = ({ className = 'w-8 h-8' }) => (
  <svg
    className={className}
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="2" y="6" width="28" height="20" rx="3" fill="#f49541" />
    <circle cx="13" cy="16" r="5" fill="#d68338" />
    <circle cx="19" cy="16" r="5" fill="#ffe096" />
    <path
      d="M16 12.5C17.1 13.4 17.8 14.6 17.8 16C17.8 17.4 17.1 18.6 16 19.5C14.9 18.6 14.2 17.4 14.2 16C14.2 14.6 14.9 13.4 16 12.5Z"
      fill="#fbcb74"
    />
  </svg>
);

/**
 * Amex card icon in AliasVault style
 */
const AmexIcon: React.FC<{ className?: string }> = ({ className = 'w-8 h-8' }) => (
  <svg
    className={className}
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="2" y="6" width="28" height="20" rx="3" fill="#f49541" />
    <text
      x="16"
      y="18"
      textAnchor="middle"
      fill="#ffe096"
      fontSize="8"
      fontWeight="bold"
      fontFamily="Arial, sans-serif"
    >
      AMEX
    </text>
  </svg>
);

/**
 * Discover card icon in AliasVault style
 */
const DiscoverIcon: React.FC<{ className?: string }> = ({ className = 'w-8 h-8' }) => (
  <svg
    className={className}
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="2" y="6" width="28" height="20" rx="3" fill="#f49541" />
    <circle cx="20" cy="16" r="4" fill="#ffe096" />
    <path
      d="M7 14H8.5C9.3 14 10 14.7 10 15.5C10 16.3 9.3 17 8.5 17H7V14Z"
      fill="#ffe096"
    />
    <rect x="11" y="14" width="1.5" height="3" fill="#ffe096" />
    <path
      d="M14 15C14 14.4 14.4 14 15 14C15.3 14 15.5 14.1 15.7 14.3L16.5 13.5C16.1 13.2 15.6 13 15 13C13.9 13 13 13.9 13 15C13 16.1 13.9 17 15 17C15.6 17 16.1 16.8 16.5 16.5L15.7 15.7C15.5 15.9 15.3 16 15 16C14.4 16 14 15.6 14 15Z"
      fill="#ffe096"
    />
  </svg>
);

/**
 * Note/document icon in AliasVault style
 */
const NoteIcon: React.FC<{ className?: string }> = ({ className = 'w-8 h-8' }) => (
  <svg
    className={className}
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M8 4C6.9 4 6 4.9 6 6V26C6 27.1 6.9 28 8 28H24C25.1 28 26 27.1 26 26V11L19 4H8Z"
      fill="#f49541"
    />
    <path
      d="M19 4V11H26L19 4Z"
      fill="#d68338"
    />
    <rect x="10" y="14" width="12" height="1.5" rx="0.75" fill="#ffe096" />
    <rect x="10" y="18" width="10" height="1.5" rx="0.75" fill="#ffe096" />
    <rect x="10" y="22" width="8" height="1.5" rx="0.75" fill="#ffe096" />
  </svg>
);

/**
 * Placeholder icon for Login/Alias items - traditional key design with outline style
 */
const PlaceholderIcon: React.FC<{ className?: string }> = ({ className = 'w-8 h-8' }) => (
  <svg
    className={className}
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Key bow (circular head) - positioned top-left */}
    <circle cx="10" cy="10" r="6.5" stroke="#f49541" strokeWidth="2.5" />
    {/* Key hole in bow */}
    <circle cx="10" cy="10" r="2.5" stroke="#f49541" strokeWidth="2" />
    {/* Key shaft - diagonal */}
    <path d="M15 15L27 27" stroke="#f49541" strokeWidth="2.5" strokeLinecap="round" />
    {/* Key teeth - perpendicular to shaft */}
    <path d="M19 19L23 15" stroke="#f49541" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M24 24L28 20" stroke="#f49541" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

/**
 * Get the appropriate icon component based on card brand
 */
const getCardIcon = (brand: CardBrand): React.FC<{ className?: string }> => {
  switch (brand) {
    case 'visa':
      return VisaIcon;
    case 'mastercard':
      return MastercardIcon;
    case 'amex':
      return AmexIcon;
    case 'discover':
      return DiscoverIcon;
    default:
      return CreditCardIcon;
  }
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
    return <NoteIcon className={className} />;
  }

  // For CreditCard type, detect card brand and show appropriate icon
  if (item.ItemType === ItemTypes.CreditCard) {
    const cardNumberField = item.Fields?.find(f => f.FieldKey === FieldKey.CardNumber);
    const cardNumber = cardNumberField?.Value
      ? (Array.isArray(cardNumberField.Value) ? cardNumberField.Value[0] : cardNumberField.Value)
      : undefined;

    const brand = detectCardBrand(cardNumber);
    const CardIcon = getCardIcon(brand);

    return <CardIcon className={className} />;
  }

  // For Login/Alias types, use Logo if available, otherwise placeholder
  if (item.Logo && item.Logo.length > 0) {
    return (
      <img
        src={SqliteClient.imgSrcFromBytes(item.Logo)}
        alt={item.Name || 'Item'}
        className={`${className} flex-shrink-0`}
        onError={(e) => {
          // On error, replace with placeholder icon
          const target = e.target as HTMLImageElement;
          target.style.display = 'none';
          // Insert placeholder SVG (key icon)
          const parent = target.parentElement;
          if (parent) {
            const placeholder = document.createElement('div');
            placeholder.innerHTML = `<svg class="${className}" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="6.5" stroke="#f49541" stroke-width="2.5"/><circle cx="10" cy="10" r="2.5" stroke="#f49541" stroke-width="2"/><path d="M15 15L27 27" stroke="#f49541" stroke-width="2.5" stroke-linecap="round"/><path d="M19 19L23 15" stroke="#f49541" stroke-width="2.5" stroke-linecap="round"/><path d="M24 24L28 20" stroke="#f49541" stroke-width="2.5" stroke-linecap="round"/></svg>`;
            parent.insertBefore(placeholder.firstChild!, target);
          }
        }}
      />
    );
  }

  // Default placeholder for Login/Alias without logo
  return <PlaceholderIcon className={className} />;
};

export default ItemIcon;

// Export individual icons for direct use if needed
export {
  CreditCardIcon,
  VisaIcon,
  MastercardIcon,
  AmexIcon,
  DiscoverIcon,
  NoteIcon,
  PlaceholderIcon,
  detectCardBrand
};
export type { CardBrand };
