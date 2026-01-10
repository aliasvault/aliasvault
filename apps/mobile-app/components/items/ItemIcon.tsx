import { Buffer } from 'buffer';

import { Image, ImageStyle, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect, Text as SvgText } from 'react-native-svg';
import { SvgUri } from 'react-native-svg';

import type { Item } from '@/utils/dist/core/models/vault';
import { ItemTypes, FieldKey } from '@/utils/dist/core/models/vault';

import servicePlaceholder from '@/assets/images/service-placeholder.webp';

/**
 * Item icon props - supports both legacy logo-only mode and new item-based mode.
 */
type ItemIconProps = {
  /** Legacy: Logo bytes for Login/Alias items */
  logo?: Uint8Array | number[] | string | null;
  /** New: Full item object for type-aware icon rendering */
  item?: Item;
  style?: ImageStyle;
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
const CreditCardIcon = ({ width = 32, height = 32 }: { width?: number; height?: number }) => (
  <Svg width={width} height={height} viewBox="0 0 32 32" fill="none">
    <Rect x="2" y="6" width="28" height="20" rx="3" fill="#f49541" />
    <Rect x="2" y="11" width="28" height="4" fill="#d68338" />
    <Rect x="5" y="18" width="8" height="2" rx="1" fill="#ffe096" />
    <Rect x="5" y="22" width="5" height="1.5" rx="0.75" fill="#fbcb74" />
  </Svg>
);

/**
 * Visa card icon in AliasVault style
 */
const VisaIcon = ({ width = 32, height = 32 }: { width?: number; height?: number }) => (
  <Svg width={width} height={height} viewBox="0 0 32 32" fill="none">
    <Rect x="2" y="6" width="28" height="20" rx="3" fill="#f49541" />
    <Path
      d="M13.5 13L11.5 19H10L8.5 14.5C8.5 14.5 8.35 14 8 14C7.65 14 7 13.8 7 13.8L7.05 13.5H9.5C9.85 13.5 10.15 13.75 10.2 14.1L10.8 17L12.5 13.5H13.5V13ZM15 19H14L15 13H16L15 19ZM20 13.5C20 13.5 19.4 13.3 18.7 13.3C17.35 13.3 16.4 14 16.4 15C16.4 15.8 17.1 16.2 17.65 16.5C18.2 16.8 18.4 17 18.4 17.2C18.4 17.5 18.05 17.7 17.6 17.7C17 17.7 16.5 17.5 16.5 17.5L16.3 18.7C16.3 18.7 16.9 19 17.7 19C19.2 19 20.1 18.2 20.1 17.1C20.1 15.7 18.4 15.6 18.4 15C18.4 14.7 18.7 14.5 19.15 14.5C19.6 14.5 20.1 14.7 20.1 14.7L20.3 13.5H20V13.5ZM24 19L23.1 13.5H22C21.7 13.5 21.45 13.7 21.35 13.95L19 19H20.5L20.8 18H22.7L22.9 19H24ZM21.2 17L22 14.5L22.45 17H21.2Z"
      fill="#ffe096"
    />
  </Svg>
);

/**
 * Mastercard icon in AliasVault style
 */
const MastercardIcon = ({ width = 32, height = 32 }: { width?: number; height?: number }) => (
  <Svg width={width} height={height} viewBox="0 0 32 32" fill="none">
    <Rect x="2" y="6" width="28" height="20" rx="3" fill="#f49541" />
    <Circle cx="13" cy="16" r="5" fill="#d68338" />
    <Circle cx="19" cy="16" r="5" fill="#ffe096" />
    <Path
      d="M16 12.5C17.1 13.4 17.8 14.6 17.8 16C17.8 17.4 17.1 18.6 16 19.5C14.9 18.6 14.2 17.4 14.2 16C14.2 14.6 14.9 13.4 16 12.5Z"
      fill="#fbcb74"
    />
  </Svg>
);

/**
 * Amex card icon in AliasVault style
 */
const AmexIcon = ({ width = 32, height = 32 }: { width?: number; height?: number }) => (
  <Svg width={width} height={height} viewBox="0 0 32 32" fill="none">
    <Rect x="2" y="6" width="28" height="20" rx="3" fill="#f49541" />
    <SvgText
      x="16"
      y="18"
      textAnchor="middle"
      fill="#ffe096"
      fontSize="8"
      fontWeight="bold"
      fontFamily="Arial, sans-serif"
    >
      AMEX
    </SvgText>
  </Svg>
);

/**
 * Discover card icon in AliasVault style
 */
const DiscoverIcon = ({ width = 32, height = 32 }: { width?: number; height?: number }) => (
  <Svg width={width} height={height} viewBox="0 0 32 32" fill="none">
    <Rect x="2" y="6" width="28" height="20" rx="3" fill="#f49541" />
    <Circle cx="20" cy="16" r="4" fill="#ffe096" />
    <Path
      d="M7 14H8.5C9.3 14 10 14.7 10 15.5C10 16.3 9.3 17 8.5 17H7V14Z"
      fill="#ffe096"
    />
    <Rect x="11" y="14" width="1.5" height="3" fill="#ffe096" />
    <Path
      d="M14 15C14 14.4 14.4 14 15 14C15.3 14 15.5 14.1 15.7 14.3L16.5 13.5C16.1 13.2 15.6 13 15 13C13.9 13 13 13.9 13 15C13 16.1 13.9 17 15 17C15.6 17 16.1 16.8 16.5 16.5L15.7 15.7C15.5 15.9 15.3 16 15 16C14.4 16 14 15.6 14 15Z"
      fill="#ffe096"
    />
  </Svg>
);

/**
 * Note/document icon in AliasVault style
 */
const NoteIcon = ({ width = 32, height = 32 }: { width?: number; height?: number }) => (
  <Svg width={width} height={height} viewBox="0 0 32 32" fill="none">
    <Path
      d="M8 4C6.9 4 6 4.9 6 6V26C6 27.1 6.9 28 8 28H24C25.1 28 26 27.1 26 26V11L19 4H8Z"
      fill="#f49541"
    />
    <Path d="M19 4V11H26L19 4Z" fill="#d68338" />
    <Rect x="10" y="14" width="12" height="1.5" rx="0.75" fill="#ffe096" />
    <Rect x="10" y="18" width="10" height="1.5" rx="0.75" fill="#ffe096" />
    <Rect x="10" y="22" width="8" height="1.5" rx="0.75" fill="#ffe096" />
  </Svg>
);

/**
 * Placeholder icon for Login/Alias items - traditional key design with outline style
 */
const PlaceholderIcon = ({ width = 32, height = 32 }: { width?: number; height?: number }) => (
  <Svg width={width} height={height} viewBox="0 0 32 32" fill="none">
    {/* Key bow (circular head) - positioned top-left */}
    <Circle cx="10" cy="10" r="6.5" stroke="#f49541" strokeWidth="2.5" />
    {/* Key hole in bow */}
    <Circle cx="10" cy="10" r="2.5" stroke="#f49541" strokeWidth="2" />
    {/* Key shaft - diagonal */}
    <Path d="M15 15L27 27" stroke="#f49541" strokeWidth="2.5" strokeLinecap="round" />
    {/* Key teeth - perpendicular to shaft */}
    <Path d="M19 19L23 15" stroke="#f49541" strokeWidth="2.5" strokeLinecap="round" />
    <Path d="M24 24L28 20" stroke="#f49541" strokeWidth="2.5" strokeLinecap="round" />
  </Svg>
);

/**
 * Get the appropriate icon component based on card brand
 */
const getCardIcon = (brand: CardBrand) => {
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
 * Item icon component - supports both item-based and legacy logo-based rendering.
 */
export function ItemIcon({ logo, item, style }: ItemIconProps) : React.ReactNode {
  const width = Number(style?.width ?? styles.logo.width);
  const height = Number(style?.height ?? styles.logo.height);

  // New item-based rendering mode
  if (item) {
    // For Note type, always show note icon
    if (item.ItemType === ItemTypes.Note) {
      return (
        <View style={[styles.iconContainer, style]}>
          <NoteIcon width={width} height={height} />
        </View>
      );
    }

    // For CreditCard type, detect card brand and show appropriate icon
    if (item.ItemType === ItemTypes.CreditCard) {
      const cardNumberField = item.Fields?.find(f => f.FieldKey === FieldKey.CardNumber);
      const cardNumber = cardNumberField?.Value
        ? (Array.isArray(cardNumberField.Value) ? cardNumberField.Value[0] : cardNumberField.Value)
        : undefined;

      const brand = detectCardBrand(cardNumber);
      const CardIcon = getCardIcon(brand);

      return (
        <View style={[styles.iconContainer, style]}>
          <CardIcon width={width} height={height} />
        </View>
      );
    }

    // For Login/Alias types, use Logo if available, otherwise placeholder
    const logoData = item.Logo;
    if (logoData && logoData.length > 0) {
      return renderLogo(logoData, style);
    }

    // Default placeholder for Login/Alias without logo
    return (
      <View style={[styles.iconContainer, style]}>
        <PlaceholderIcon width={width} height={height} />
      </View>
    );
  }

  // Legacy logo-only rendering mode
  if (logo && (typeof logo === 'string' || logo.length > 0)) {
    return renderLogo(logo, style);
  }

  // Fallback to placeholder
  return (
    <View style={[styles.iconContainer, style]}>
      <PlaceholderIcon width={width} height={height} />
    </View>
  );
}

/**
 * Render logo from binary data.
 */
function renderLogo(
  logoData: Uint8Array | number[] | string,
  style?: ImageStyle
): React.ReactNode {
  /**
   * Get the logo source.
   */
  const getLogoSource = (data: Uint8Array | number[] | string | null | undefined) : { type: 'image' | 'svg', source: string | number } => {
    if (!data) {
      return { type: 'image', source: servicePlaceholder };
    }

    try {
      // If logo is already a base64 string (from iOS SQLite query result)
      if (typeof data === 'string') {
        const mimeType = detectMimeTypeFromBase64(data);
        return {
          type: mimeType === 'image/svg+xml' ? 'svg' : 'image',
          source: `data:${mimeType};base64,${data}`
        };
      }

      // Handle binary data (from Android or other sources)
      const logoBytes = toUint8Array(data);
      const base64Logo = Buffer.from(logoBytes).toString('base64');
      const mimeType = detectMimeType(logoBytes);
      return {
        type: mimeType === 'image/svg+xml' ? 'svg' : 'image',
        source: `data:${mimeType};base64,${base64Logo}`
      };
    } catch (error) {
      console.error('Error converting logo:', error);
      return { type: 'image', source: servicePlaceholder };
    }
  };

  const logoSource = getLogoSource(logoData);

  if (logoSource.type === 'svg') {
    /*
     * SVGs are not supported in React Native Image component,
     * so we use SvgUri from react-native-svg.
     */
    return (
      <SvgUri
        uri={logoSource.source as string}
        width={Number(style?.width ?? styles.logo.width)}
        height={Number(style?.height ?? styles.logo.height)}
        style={{
          borderRadius: styles.logo.borderRadius,
          width: Number(style?.width ?? styles.logo.width),
          height: Number(style?.height ?? styles.logo.height),
          marginLeft: Number(style?.marginLeft ?? 0),
          marginRight: Number(style?.marginRight ?? 0),
          marginTop: Number(style?.marginTop ?? 0),
          marginBottom: Number(style?.marginBottom ?? 0),
        }}
      />
    );
  }

  return (
    <Image
      source={typeof logoSource.source === 'string' ? { uri: logoSource.source } : logoSource.source}
      style={[styles.logo, style]}
      defaultSource={servicePlaceholder}
    />
  );
}

/**
 * Detect MIME type from base64 string by decoding first few bytes
 */
function detectMimeTypeFromBase64(base64: string): string {
  try {
    const binaryString = atob(base64.slice(0, 8));
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return detectMimeType(bytes);
  } catch (error) {
    console.warn('Error detecting mime type from base64:', error);
    return 'image/x-icon';
  }
}

/**
 * Detect MIME type from file signature (magic numbers)
 */
function detectMimeType(bytes: Uint8Array): string {
  /**
   * Check if the file is an SVG.
   */
  const isSvg = (): boolean => {
    const header = new TextDecoder().decode(bytes.slice(0, 5)).toLowerCase();
    return header.includes('<?xml') || header.includes('<svg');
  };

  /**
   * Check if the file is an ICO.
   */
  const isIco = (): boolean => {
    return bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00;
  };

  /**
   * Check if the file is a PNG.
   */
  const isPng = (): boolean => {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
  };

  if (isSvg()) {
    return 'image/svg+xml';
  }
  if (isIco()) {
    return 'image/x-icon';
  }
  if (isPng()) {
    return 'image/png';
  }

  return 'image/x-icon';
}

/**
 * Convert various binary data formats to Uint8Array
 */
function toUint8Array(buffer: Uint8Array | number[] | {[key: number]: number}): Uint8Array {
  if (buffer instanceof Uint8Array) {
    return buffer;
  }

  if (Array.isArray(buffer)) {
    return new Uint8Array(buffer);
  }

  const length = Object.keys(buffer).length;
  const arr = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    arr[i] = buffer[i];
  }

  return arr;
}

const styles = StyleSheet.create({
  logo: {
    borderRadius: 4,
    height: 32,
    width: 32,
  },
  iconContainer: {
    borderRadius: 4,
    overflow: 'hidden',
  },
});