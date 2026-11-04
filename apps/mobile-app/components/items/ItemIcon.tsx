import { useEffect, useState } from 'react';
import { Image, ImageStyle, StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import {
  ItemTypes,
  FieldKey,
  LogoKinds,
} from '@aliasvault/models/vault';

import type { DisplayItem } from '@/utils/DisplayItem';

import { useColorScheme } from '@/hooks/useColorScheme';
import { normalizeSvgLogo } from '@/platform/NativeRustCore';

// Import centralized icon components (auto-generated from core/models/src/icons)
import { builtinLogoComponents, type BuiltinLogoComponentKey } from './BuiltinLogoComponents';
import {
  itemTypeIconComponents,
  PlaceholderIcon,
  NoteIcon,
  type ItemTypeIconComponentKey,
} from './ItemTypeIconComponents';

/**
 * The start of an SVG logo's data URI.
 */
const SVG_DATA_URI_PREFIX = 'data:image/svg+xml;base64,';

/**
 * Corner radius of a logo.
 */
const LOGO_RADIUS_RATIO = 0.17;

/**
 * Most normalized SVG logos kept in memory.
 */
const MAX_CACHED_SVG_LOGOS = 500;

/**
 * Normalized SVG logos by color scheme and base64 source, null for a logo that cannot be drawn.
 */
const normalizedSvgLogos = new Map<string, string | null>();

/**
 * Normalizations in flight, so items sharing a logo make one native call.
 */
const pendingSvgLogos = new Map<string, Promise<string | null>>();

/**
 * The SVG logo as simplified markup react-native-svg draws like a browser: undefined while normalizing, null when it cannot be drawn.
 */
function useNormalizedSvgLogo(svgBase64: string | null, dark: boolean): string | null | undefined {
  const key = svgBase64 === null ? null : `${dark ? 'dark' : 'light'}:${svgBase64}`;
  const [, setResolvedKey] = useState<string | null>(null);

  useEffect(() => {
    if (key === null || svgBase64 === null || normalizedSvgLogos.has(key)) {
      return;
    }
    let active = true;
    let request = pendingSvgLogos.get(key);
    if (!request) {
      request = normalizeSvgLogo(svgBase64, dark).catch(() => null);
      pendingSvgLogos.set(key, request);
    }
    void request.then((svg) => {
      pendingSvgLogos.delete(key);
      if (normalizedSvgLogos.size >= MAX_CACHED_SVG_LOGOS) {
        normalizedSvgLogos.delete(normalizedSvgLogos.keys().next().value as string);
      }
      normalizedSvgLogos.set(key, svg);
      if (active) {
        setResolvedKey(key);
      }
    });
    return (): void => {
      active = false;
    };
  }, [key, svgBase64, dark]);

  if (key === null) {
    return null;
  }
  return normalizedSvgLogos.has(key) ? normalizedSvgLogos.get(key) ?? null : undefined;
}

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
const detectCardBrand = (cardNumber: string | undefined): ItemTypeIconComponentKey => {
  if (!cardNumber) return 'credit-card';

  const cleaned = cardNumber.replace(/[\s-]/g, '');
  if (!/^\d{4,}/.test(cleaned)) return 'credit-card';

  if (/^4/.test(cleaned)) return 'visa';
  if (/^5[1-5]/.test(cleaned) || /^2[2-7]/.test(cleaned)) return 'mastercard';
  if (/^3[47]/.test(cleaned)) return 'amex';
  if (/^6(?:011|22|4[4-9]|5)/.test(cleaned)) return 'discover';

  return 'credit-card';
};

/**
 * The component for a built-in icon key, or null when the key is unknown to this client (a newer version may have added it).
 */
export const getBuiltinLogoComponent = (key: string): typeof builtinLogoComponents[BuiltinLogoComponentKey] | null => {
  return Object.prototype.hasOwnProperty.call(builtinLogoComponents, key) ? builtinLogoComponents[key as BuiltinLogoComponentKey] : null;
};

/**
 * Get the appropriate icon component for a card number.
 */
const getCardIconComponent = (cardNumber: string | undefined) => {
  return itemTypeIconComponents[detectCardBrand(cardNumber)];
};

/**
 * Item icon component: a logo the user picked wins, then a type icon for notes and cards, then the item's logo.
 */
export function ItemIcon({ item, style }: ItemIconProps) : React.ReactNode {
  const width = Number(style?.width ?? styles.logo.width);
  const height = Number(style?.height ?? styles.logo.height);

  // A built-in icon carries no bytes: every platform draws it from the shared catalog.
  if (item.LogoInfo?.Kind === LogoKinds.Builtin) {
    const BuiltinIcon = getBuiltinLogoComponent(item.LogoInfo.Source);
    if (BuiltinIcon) {
      return (
        <View style={[styles.iconContainer, style]}>
          <BuiltinIcon width={width} height={height} />
        </View>
      );
    }
  }

  // An uploaded image is shown like any other logo; a custom row without bytes falls through to the placeholder.
  if (item.LogoInfo?.Kind === LogoKinds.Custom && item.LogoDataUri) {
    return <LogoImage dataUri={item.LogoDataUri} style={style} />;
  }

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
  const borderRadius = Math.round(svgWidth * LOGO_RADIUS_RATIO);

  const svg = useNormalizedSvgLogo(isSvg ? dataUri.slice(SVG_DATA_URI_PREFIX.length) : null, useColorScheme() === 'dark');

  if (!isSvg) {
    return <Image source={{ uri: dataUri }} style={[styles.logo, style, { borderRadius }]} />;
  }

  const placeholder = (
    <View style={[styles.iconContainer, style]}>
      <PlaceholderIcon width={svgWidth} height={svgHeight} />
    </View>
  );

  // An SVG that cannot be drawn shows the placeholder; while it is normalized the space stays empty.
  if (svg === null) {
    return placeholder;
  }

  // react-native-svg does not clip to a border radius, so a wrapping view does the rounding.
  return (
    <View
      style={{
        borderRadius,
        overflow: 'hidden',
        width: svgWidth,
        height: svgHeight,
        marginLeft: Number(style?.marginLeft ?? 0),
        marginRight: Number(style?.marginRight ?? 0),
        marginTop: Number(style?.marginTop ?? 0),
        marginBottom: Number(style?.marginBottom ?? 0),
      }}
    >
      {svg !== undefined && <SvgXml xml={svg} width={svgWidth} height={svgHeight} fallback={placeholder} />}
    </View>
  );
}

const styles = StyleSheet.create({
  logo: {
    height: 32,
    width: 32,
  },
  iconContainer: {
    borderRadius: 4,
    overflow: 'hidden',
  },
});
