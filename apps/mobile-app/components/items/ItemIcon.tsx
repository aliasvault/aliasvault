import { Buffer } from 'buffer';

import { Image, ImageStyle, StyleSheet, View } from 'react-native';
import { SvgUri } from 'react-native-svg';

import type { Item } from '@/utils/dist/core/models/vault';
import {
  ItemTypes,
  FieldKey,
} from '@/utils/dist/core/models/vault';

import servicePlaceholder from '@/assets/images/service-placeholder.webp';

// Import centralized icon components (auto-generated from core/models/src/icons/ItemTypeIcons.ts)
import {
  iconComponents,
  PlaceholderIcon,
  NoteIcon,
  type IconKey,
} from './ItemTypeIconComponents';

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
 * Detect credit card brand from card number using BIN prefixes.
 */
const detectCardBrand = (cardNumber: string | undefined): IconKey => {
  if (!cardNumber) return 'CreditCard';

  const cleaned = cardNumber.replace(/[\s-]/g, '');
  if (!/^\d{4,}/.test(cleaned)) return 'CreditCard';

  if (/^4/.test(cleaned)) return 'Visa';
  if (/^5[1-5]/.test(cleaned) || /^2[2-7]/.test(cleaned)) return 'Mastercard';
  if (/^3[47]/.test(cleaned)) return 'Amex';
  if (/^6(?:011|22|4[4-9]|5)/.test(cleaned)) return 'Discover';

  return 'CreditCard';
};

/**
 * Get the appropriate icon component for a card number.
 */
const getCardIconComponent = (cardNumber: string | undefined) => {
  return iconComponents[detectCardBrand(cardNumber)];
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

      const CardIcon = getCardIconComponent(cardNumber);

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
