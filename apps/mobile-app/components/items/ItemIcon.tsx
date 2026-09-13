import { Buffer } from 'buffer';

import { useMemo } from 'react';
import { Image, ImageStyle, StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import {
  ItemTypes,
  FieldKey,
} from '@aliasvault/models/vault';

import servicePlaceholder from '@/assets/images/service-placeholder.webp';
import type { DisplayItem } from '@/utils/DisplayItem';

// Import centralized icon components (auto-generated from core/models/src/icons/ItemTypeIcons.ts)
import {
  iconComponents,
  PlaceholderIcon,
  NoteIcon,
  type IconKey,
} from './ItemTypeIconComponents';

/**
 * The start of an SVG logo's data URI.
 */
const SVG_DATA_URI_PREFIX = 'data:image/svg+xml;base64,';

/**
 * Item icon props.
 */
type ItemIconProps = {
  item: DisplayItem;
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
 * Item icon component: a type icon for notes and cards, the item's logo otherwise.
 */
export function ItemIcon({ item, style }: ItemIconProps) : React.ReactNode {
  const width = Number(style?.width ?? styles.logo.width);
  const height = Number(style?.height ?? styles.logo.height);

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

  // For Login/Alias types, use the logo if available, otherwise placeholder
  if (item.LogoDataUri) {
    return <LogoImage dataUri={item.LogoDataUri} style={style} />;
  }

  return (
    <View style={[styles.iconContainer, style]}>
      <PlaceholderIcon width={width} height={height} />
    </View>
  );
}

/**
 * Render a logo from its data URI.
 */
function LogoImage({ dataUri, style }: { dataUri: string; style?: ImageStyle }): React.ReactNode {
  const svgWidth = Number(style?.width ?? styles.logo.width);
  const svgHeight = Number(style?.height ?? styles.logo.height);
  const isSvg = dataUri.startsWith(SVG_DATA_URI_PREFIX);

  // Decode and sanitize an SVG once per logo and size, not on every render.
  const svgXml = useMemo(() => {
    if (!isSvg) {
      return null;
    }
    return sanitizeSvg(Buffer.from(dataUri.slice(SVG_DATA_URI_PREFIX.length), 'base64').toString('utf-8'), svgWidth, svgHeight);
  }, [dataUri, isSvg, svgWidth, svgHeight]);

  if (!isSvg) {
    return (
      <Image
        source={{ uri: dataUri }}
        style={[styles.logo, style]}
        defaultSource={servicePlaceholder}
      />
    );
  }

  const fallback = (
    <Image
      source={servicePlaceholder}
      style={[styles.logo, style]}
    />
  );

  // If sanitization failed (returned null), fall back to placeholder
  if (!svgXml) {
    return fallback;
  }

  /*
   * Use SvgXml instead of SvgUri to render SVG logos. SvgXml accepts raw XML
   * and supports onError/fallback props, which lets us gracefully handle
   * malformed SVGs that would otherwise crash the native renderer
   * (e.g. zero-dimension SVGs triggering UIGraphicsBeginImageContext failures).
   */
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
