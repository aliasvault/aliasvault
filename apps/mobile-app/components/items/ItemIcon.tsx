import { Buffer } from 'buffer';

import { Image, ImageStyle, StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

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
   * Get the logo source. For SVGs, returns the raw XML string so SvgXml can
   * render it safely with fallback/onError support. For other formats, returns
   * a data URI for the Image component.
   */
  const getLogoSource = (data: Uint8Array | number[] | string | null | undefined) : { type: 'image' | 'svg', source: string | number } => {
    if (!data) {
      return { type: 'image', source: servicePlaceholder };
    }

    try {
      // If logo is already a base64 string (from iOS SQLite query result)
      if (typeof data === 'string') {
        const mimeType = detectMimeTypeFromBase64(data);
        if (mimeType === 'image/svg+xml') {
          // Decode base64 to raw SVG XML for SvgXml component
          return { type: 'svg', source: Buffer.from(data, 'base64').toString('utf-8') };
        }
        return { type: 'image', source: `data:${mimeType};base64,${data}` };
      }

      // Handle binary data (from Android or other sources)
      const logoBytes = toUint8Array(data);
      const mimeType = detectMimeType(logoBytes);
      if (mimeType === 'image/svg+xml') {
        // Decode bytes to raw SVG XML for SvgXml component
        return { type: 'svg', source: new TextDecoder().decode(logoBytes) };
      }
      const base64Logo = Buffer.from(logoBytes).toString('base64');
      return { type: 'image', source: `data:${mimeType};base64,${base64Logo}` };
    } catch (error) {
      console.error('Error converting logo:', error);
      return { type: 'image', source: servicePlaceholder };
    }
  };

  const logoSource = getLogoSource(logoData);

  if (logoSource.type === 'svg') {
    /*
     * Use SvgXml instead of SvgUri to render SVG logos. SvgXml accepts raw XML
     * and supports onError/fallback props, which lets us gracefully handle
     * malformed SVGs that would otherwise crash the native renderer
     * (e.g. zero-dimension SVGs triggering UIGraphicsBeginImageContext failures).
     */
    console.log('logoSource', logoSource);
    const svgWidth = Number(style?.width ?? styles.logo.width);
    const svgHeight = Number(style?.height ?? styles.logo.height);

    const svgXml = sanitizeSvg(logoSource.source as string, svgWidth, svgHeight);

    // If sanitization failed (returned null), fall back to placeholder
    if (!svgXml) {
      return (
        <Image
          source={servicePlaceholder}
          style={[styles.logo, style]}
        />
      );
    }

    const fallback = (
      <Image
        source={servicePlaceholder}
        style={[styles.logo, style]}
      />
    );

    return (
      <SvgXml
        xml={svgXml}
        width={svgWidth}
        height={svgHeight}
        onError={() => {
          console.warn('SvgXml failed to render SVG logo');
        }}
        fallback={fallback}
        style={{
          borderRadius: styles.logo.borderRadius,
          width: svgWidth,
          height: svgHeight,
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
 * Sanitize SVG XML for react-native-svg compatibility.
 *
 * Addresses several crash vectors:
 * 1. Zero/missing dimensions on the root <svg> tag cause iOS native renderer to crash
 *    with: UIGraphicsBeginImageContext() failed to allocate CGBitmapContext: size={0, 0}.
 * 2. Nested <svg> elements create nested Svg components with no layout dimensions,
 *    triggering the same zero-size crash.
 * 3. Namespaced elements (sodipodi:*, inkscape:*, metadata, rdf:*, cc:*, dc:*) are not
 *    supported by react-native-svg and can cause parse/render failures.
 *
 * Returns null if the SVG is fundamentally broken and should not be rendered.
 */
function sanitizeSvg(xml: string, targetWidth: number, targetHeight: number): string | null {
  try {
    if (!xml || xml.trim().length === 0) {
      return null;
    }

    let sanitized = xml;

    // Remove unsupported namespaced elements and metadata that react-native-svg cannot handle.
    // These include Inkscape/Sodipodi editor elements, RDF metadata, Creative Commons, etc.
    // Use [\s\S] instead of . to match across newlines.
    sanitized = sanitized.replace(/<sodipodi:[^>]*\/>/gi, '');
    sanitized = sanitized.replace(/<sodipodi:[^>]*>[\s\S]*?<\/sodipodi:[^>]*>/gi, '');
    sanitized = sanitized.replace(/<inkscape:[^>]*\/>/gi, '');
    sanitized = sanitized.replace(/<inkscape:[^>]*>[\s\S]*?<\/inkscape:[^>]*>/gi, '');
    sanitized = sanitized.replace(/<metadata[\s>][\s\S]*?<\/metadata>/gi, '');

    // Replace nested <svg> elements (not the root) with <g> elements.
    // Nested <svg> tags create nested Svg root components in react-native-svg
    // that inherit no layout dimensions, causing the zero-size native crash.
    // We preserve the first (root) <svg> and convert inner ones to <g>.
    let isFirst = true;
    sanitized = sanitized.replace(/<svg\b([^>]*)>/gi, (match, attrs) => {
      if (isFirst) {
        isFirst = false;
        return match;
      }
      // Convert inner <svg> to <g>, preserving transform attribute if present
      const transformMatch = (attrs as string).match(/\btransform\s*=\s*["'][^"']*["']/i);
      const transform = transformMatch ? ` ${transformMatch[0]}` : '';
      return `<g${transform}>`;
    });
    // Replace matching closing </svg> tags (all except the last one, which closes the root)
    // Count remaining </svg> tags and replace all but the last with </g>
    const closingTags: number[] = [];
    const closingRegex = /<\/svg>/gi;
    let closeMatch;
    while ((closeMatch = closingRegex.exec(sanitized)) !== null) {
      closingTags.push(closeMatch.index);
    }
    // Replace all closing </svg> except the last one (root) with </g>
    if (closingTags.length > 1) {
      for (let i = closingTags.length - 2; i >= 0; i--) {
        const idx = closingTags[i];
        sanitized = sanitized.substring(0, idx) + '</g>' + sanitized.substring(idx + 6);
      }
    }

    // Ensure root <svg> has valid, non-zero dimensions
    const svgTagMatch = sanitized.match(/<svg\b([^>]*)>/i);
    if (!svgTagMatch) {
      return null;
    }

    const attrs = svgTagMatch[1];
    const widthMatch = attrs.match(/\bwidth\s*=\s*["']([^"']*)["']/i);
    const heightMatch = attrs.match(/\bheight\s*=\s*["']([^"']*)["']/i);

    const hasZeroWidth = widthMatch && (parseFloat(widthMatch[1]) === 0 || widthMatch[1].trim() === '');
    const hasZeroHeight = heightMatch && (parseFloat(heightMatch[1]) === 0 || heightMatch[1].trim() === '');
    const hasMissingWidth = !widthMatch;
    const hasMissingHeight = !heightMatch;

    if (hasZeroWidth || hasMissingWidth || hasZeroHeight || hasMissingHeight) {
      let newAttrs = attrs;

      if (hasZeroWidth && widthMatch) {
        newAttrs = newAttrs.replace(widthMatch[0], `width="${targetWidth}"`);
      } else if (hasMissingWidth) {
        newAttrs = ` width="${targetWidth}"` + newAttrs;
      }

      if (hasZeroHeight && heightMatch) {
        newAttrs = newAttrs.replace(heightMatch[0], `height="${targetHeight}"`);
      } else if (hasMissingHeight) {
        newAttrs = ` height="${targetHeight}"` + newAttrs;
      }

      sanitized = sanitized.replace(svgTagMatch[0], `<svg${newAttrs}>`);
    }

    return sanitized;
  } catch (error) {
    console.warn('Failed to sanitize SVG:', error);
    return null;
  }
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
