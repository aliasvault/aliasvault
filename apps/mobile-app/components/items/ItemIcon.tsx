import { Buffer } from 'buffer';

import { Image, ImageStyle, StyleSheet } from 'react-native';
import { SvgUri } from 'react-native-svg';

import servicePlaceholder from '@/assets/images/service-placeholder.webp';

/**
 * Item icon props.
 */
type ItemIconProps = {
  logo?: Uint8Array | number[] | string | null;
  style?: ImageStyle;
};

/**
 * Item icon component.
 */
export function ItemIcon({ logo, style }: ItemIconProps) : React.ReactNode {
  /**
   * Get the logo source.
   */
  const getLogoSource = (logoData: Uint8Array | number[] | string | null | undefined) : { type: 'image' | 'svg', source: string | number } => {
    if (!logoData) {
      return { type: 'image', source: servicePlaceholder };
    }

    try {
      // If logo is already a base64 string (from iOS SQLite query result)
      if (typeof logoData === 'string') {
        const mimeType = detectMimeTypeFromBase64(logoData);
        return {
          type: mimeType === 'image/svg+xml' ? 'svg' : 'image',
          source: `data:${mimeType};base64,${logoData}`
        };
      }

      // Handle binary data (from Android or other sources)
      const logoBytes = toUint8Array(logoData);
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

  const logoSource = getLogoSource(logo);

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
});