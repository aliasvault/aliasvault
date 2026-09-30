#!/usr/bin/env node
/**
 * Generates FieldKey, FieldType, ItemType constants and the icon catalogs (ItemTypeIcons, AppIcons) for Swift, Kotlin and React Native from TypeScript source.
 * All type definitions are dynamically extracted from the TypeScript source files.
 */

const fs = require('fs');
const path = require('path');

// Paths
const REPO_ROOT = path.join(__dirname, '../../..');
const TS_SOURCE = path.join(REPO_ROOT, 'core/models/src/vault/FieldKey.ts');
const TS_ITEM_SOURCE = path.join(REPO_ROOT, 'core/models/src/vault/Item.ts');
const SWIFT_OUTPUT = path.join(REPO_ROOT, 'apps/mobile-app/ios/VaultModels/FieldKey.swift');
const SWIFT_FIELD_TYPE_OUTPUT = path.join(REPO_ROOT, 'apps/mobile-app/ios/VaultModels/FieldType.swift');
const SWIFT_ITEM_TYPE_OUTPUT = path.join(REPO_ROOT, 'apps/mobile-app/ios/VaultModels/ItemType.swift');
const KOTLIN_OUTPUT = path.join(REPO_ROOT, 'apps/mobile-app/android/app/src/main/java/net/aliasvault/app/vaultstore/models/FieldKey.kt');
const KOTLIN_FIELD_TYPE_OUTPUT = path.join(REPO_ROOT, 'apps/mobile-app/android/app/src/main/java/net/aliasvault/app/vaultstore/models/FieldType.kt');
const KOTLIN_ITEM_TYPE_OUTPUT = path.join(REPO_ROOT, 'apps/mobile-app/android/app/src/main/java/net/aliasvault/app/vaultstore/models/ItemType.kt');

/**
 * The SVG icon catalogs.
 */
const ICON_CATALOGS = [
  {
    constName: 'ItemTypeIconSvgs',
    className: 'ItemTypeIcons',
    sourceFile: 'core/models/src/icons/ItemTypeIcons.ts',
    description: ['Centralized SVG icon definitions for item types.', 'Single source of truth for all item type icons across platforms.'],
    rnMapName: 'iconComponents',
    rnKeyTypeName: 'IconKey',
    lookup: false,
    outputs: {
      swift: path.join(REPO_ROOT, 'apps/mobile-app/ios/VaultModels/ItemTypeIcons.swift'),
      kotlin: path.join(REPO_ROOT, 'apps/mobile-app/android/app/src/main/java/net/aliasvault/app/vaultstore/models/ItemTypeIcons.kt'),
      rn: path.join(REPO_ROOT, 'apps/mobile-app/components/items/ItemTypeIconComponents.tsx'),
    },
  },
  {
    constName: 'AppIconSvgs',
    className: 'AppIcons',
    sourceFile: 'core/models/src/icons/AppIcons.ts',
    description: ['The catalog of built-in icons a user can pick for an item, keyed by the Source a builtin logo row stores.', 'Single source of truth for all built-in icons across platforms.'],
    rnMapName: 'appIconComponents',
    rnKeyTypeName: 'AppIconKey',
    lookup: true,
    outputs: {
      swift: path.join(REPO_ROOT, 'apps/mobile-app/ios/VaultModels/AppIcons.swift'),
      kotlin: path.join(REPO_ROOT, 'apps/mobile-app/android/app/src/main/java/net/aliasvault/app/vaultstore/models/AppIcons.kt'),
      rn: path.join(REPO_ROOT, 'apps/mobile-app/components/items/AppIconComponents.tsx'),
    },
  },
];

/**
 * Parse the TypeScript FieldKey.ts file and extract constants
 */
function parseTypeScriptFieldKeys(tsContent) {
  const fieldKeys = {};

  // Extract field comments
  const lines = tsContent.split(/\r?\n/);
  let currentComment = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Capture JSDoc comments
    if (line.startsWith('/**') || line.startsWith('*')) {
      const commentMatch = line.match(/\*\s*(.+)/);
      if (commentMatch && !commentMatch[1].startsWith('/')) {
        currentComment = commentMatch[1].trim();
      }
    }

    // Match field definition
    const fieldMatch = line.match(/^(\w+):\s*'([^']+)',?$/);
    if (fieldMatch) {
      const [, name, value] = fieldMatch;
      fieldKeys[name] = {
        value,
        comment: currentComment
      };
      currentComment = '';
    }
  }

  return fieldKeys;
}

/**
 * Parse FieldTypes from TypeScript Item.ts source
 * Returns an array of field type names in order
 */
function parseFieldTypes(tsContent) {
  const fieldTypes = [];

  // Find the FieldTypes constant
  const match = tsContent.match(/export const FieldTypes\s*=\s*\{([^}]+)\}/s);
  if (!match) {
    console.warn('Warning: Could not find FieldTypes in source');
    return fieldTypes;
  }

  const body = match[1];
  // Match each type: Text: 'Text',
  const typeRegex = /(\w+):\s*'(\w+)'/g;
  let typeMatch;

  while ((typeMatch = typeRegex.exec(body)) !== null) {
    fieldTypes.push(typeMatch[1]);
  }

  return fieldTypes;
}

/**
 * Parse ItemTypes from TypeScript Item.ts source
 * Returns an array of item type names in order
 */
function parseItemTypes(tsContent) {
  const itemTypes = [];

  // Find the ItemTypes constant
  const match = tsContent.match(/export const ItemTypes\s*=\s*\{([^}]+)\}/s);
  if (!match) {
    console.warn('Warning: Could not find ItemTypes in source');
    return itemTypes;
  }

  const body = match[1];
  // Match each type: Login: 'Login',
  const typeRegex = /(\w+):\s*'(\w+)'/g;
  let typeMatch;

  while ((typeMatch = typeRegex.exec(body)) !== null) {
    itemTypes.push(typeMatch[1]);
  }

  return itemTypes;
}

/**
 * Generate Swift enum
 */
function generateSwift(fieldKeys) {
  const header = `// <auto-generated />
// This file is auto-generated from core/models/src/vault/FieldKey.ts
// Do not edit this file directly. Run 'npm run generate:models' to regenerate.

import Foundation

/// System field keys for the field-based data model.
/// These keys map to FieldDefinition.FieldKey values.
public struct FieldKey {`;

  const fields = Object.entries(fieldKeys)
    .map(([name, { value, comment }]) => {
      // Convert PascalCase to camelCase for Swift
      const swiftName = name.charAt(0).toLowerCase() + name.slice(1);
      return `    /// ${comment}
    public static let ${swiftName} = "${value}"`;
    })
    .join('\n\n');

  const footer = `
}
`;

  return header + '\n' + fields + footer;
}

/**
 * Generate Kotlin object
 */
function generateKotlin(fieldKeys) {
  const header = `// <auto-generated />
// This file is auto-generated from core/models/src/vault/FieldKey.ts
// Do not edit this file directly. Run 'npm run generate:models' to regenerate.

package net.aliasvault.app.vaultstore.models

/**
 * System field keys for the field-based data model.
 * These keys map to FieldDefinition.FieldKey values.
 */
object FieldKey {`;

  const fields = Object.entries(fieldKeys)
    .map(([name, { value, comment }]) => {
      // Convert to SCREAMING_SNAKE_CASE for Kotlin constants
      const kotlinName = name.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '');
      // Ensure comment ends with a period for Kotlin detekt
      const kotlinComment = comment.endsWith('.') ? comment : `${comment}.`;
      return `    /**
     * ${kotlinComment}
     */
    const val ${kotlinName} = "${value}"`;
    })
    .join('\n\n');

  const footer = `
}
`;

  return header + '\n' + fields + footer;
}

/**
 * Generate Swift struct for FieldType
 */
function generateSwiftFieldType(fieldTypes) {
  const header = `// <auto-generated />
// This file is auto-generated from core/models/src/vault/Item.ts
// Do not edit this file directly. Run 'npm run generate:models' to regenerate.

import Foundation

/// Field types for rendering and validation.
public struct FieldType {`;

  const fields = fieldTypes
    .map(type => {
      // Convert PascalCase to camelCase for Swift
      const swiftName = type.charAt(0).toLowerCase() + type.slice(1);
      return `    /// ${type} field type.
    public static let ${swiftName} = "${type}"`;
    })
    .join('\n\n');

  const allTypes = `

    /// All available field types.
    public static let all = [${fieldTypes.map(t => t.charAt(0).toLowerCase() + t.slice(1)).join(', ')}]

    /// Checks if a string value is a valid field type.
    public static func isValid(_ value: String?) -> Bool {
        guard let value = value else { return false }
        return all.contains(value)
    }`;

  const footer = `
}
`;

  return header + '\n' + fields + allTypes + footer;
}

/**
 * Generate Swift struct for ItemType
 */
function generateSwiftItemType(itemTypes) {
  const header = `// <auto-generated />
// This file is auto-generated from core/models/src/vault/Item.ts
// Do not edit this file directly. Run 'npm run generate:models' to regenerate.

import Foundation

/// Item types supported by the vault.
public struct ItemType {`;

  const fields = itemTypes
    .map(type => {
      // Convert PascalCase to camelCase for Swift
      const swiftName = type.charAt(0).toLowerCase() + type.slice(1);
      return `    /// ${type} item type.
    public static let ${swiftName} = "${type}"`;
    })
    .join('\n\n');

  const allTypes = `

    /// All available item types.
    public static let all = [${itemTypes.map(t => t.charAt(0).toLowerCase() + t.slice(1)).join(', ')}]

    /// Checks if a string value is a valid item type.
    public static func isValid(_ value: String?) -> Bool {
        guard let value = value else { return false }
        return all.contains(value)
    }`;

  const footer = `
}
`;

  return header + '\n' + fields + allTypes + footer;
}

/**
 * Generate Kotlin object for FieldType
 */
function generateKotlinFieldType(fieldTypes) {
  const header = `// <auto-generated />
// This file is auto-generated from core/models/src/vault/Item.ts
// Do not edit this file directly. Run 'npm run generate:models' to regenerate.

package net.aliasvault.app.vaultstore.models

/**
 * Field types for rendering and validation.
 */
object FieldType {`;

  const fields = fieldTypes
    .map(type => {
      // Convert to SCREAMING_SNAKE_CASE for Kotlin constants
      const kotlinName = type.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '');
      return `    /**
     * ${type} field type.
     */
    const val ${kotlinName} = "${type}"`;
    })
    .join('\n\n');

  const allTypes = `

    /**
     * All available field types.
     */
    val all = listOf(${fieldTypes.map(t => t.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '')).join(', ')})

    /**
     * Checks if a string value is a valid field type.
     */
    fun isValid(value: String?): Boolean {
        return value in all
    }`;

  const footer = `
}
`;

  return header + '\n' + fields + allTypes + footer;
}

/**
 * Generate Kotlin object for ItemType
 */
function generateKotlinItemType(itemTypes) {
  const header = `// <auto-generated />
// This file is auto-generated from core/models/src/vault/Item.ts
// Do not edit this file directly. Run 'npm run generate:models' to regenerate.

package net.aliasvault.app.vaultstore.models

/**
 * Item types supported by the vault.
 */
object ItemType {`;

  const fields = itemTypes
    .map(type => {
      // Convert to SCREAMING_SNAKE_CASE for Kotlin constants
      const kotlinName = type.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '');
      return `    /**
     * ${type} item type.
     */
    const val ${kotlinName} = "${type}"`;
    })
    .join('\n\n');

  const allTypes = `

    /**
     * All available item types.
     */
    val all = listOf(${itemTypes.map(t => t.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '')).join(', ')})

    /**
     * Checks if a string value is a valid item type.
     */
    fun isValid(value: String?): Boolean {
        return value in all
    }`;

  const footer = `
}
`;

  return header + '\n' + fields + allTypes + footer;
}

/**
 * Ensure directory exists
 */
function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ==================== ICON GENERATION ====================

/**
 * Parse an SVG catalog constant (a `{ Name: `<svg...>` }` object) from TypeScript source
 */
function parseIconSvgs(tsContent, constName) {
  const icons = {};

  // Find the catalog constant
  const startMatch = tsContent.match(new RegExp(`export const ${constName}\\s*=\\s*\\{`));
  if (!startMatch) {
    console.warn(`Warning: Could not find ${constName} in source`);
    return icons;
  }

  const startIdx = startMatch.index + startMatch[0].length;

  // Find the closing brace by counting braces
  let braceCount = 1;
  let endIdx = startIdx;
  while (braceCount > 0 && endIdx < tsContent.length) {
    if (tsContent[endIdx] === '{') braceCount++;
    if (tsContent[endIdx] === '}') braceCount--;
    endIdx++;
  }

  const body = tsContent.slice(startIdx, endIdx - 1);

  // Match each icon: IconName: `<svg...>`,
  // Use a state machine to handle template literals with backticks
  const lines = body.split(/\r?\n/);
  let currentIconName = null;
  let currentSvg = '';
  let inTemplateLiteral = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip JSDoc comments
    if (trimmed.startsWith('/**') || trimmed.startsWith('*')) {
      continue;
    }

    // Check for icon name start: IconName: `
    const iconStartMatch = trimmed.match(/^(\w+):\s*`(.*)$/);
    if (iconStartMatch && !inTemplateLiteral) {
      currentIconName = iconStartMatch[1];
      const rest = iconStartMatch[2];

      // Check if it ends on the same line
      if (rest.endsWith('`,') || rest.endsWith('`')) {
        icons[currentIconName] = rest.replace(/`,?$/, '');
        currentIconName = null;
      } else {
        currentSvg = rest + '\n';
        inTemplateLiteral = true;
      }
      continue;
    }

    // Continue collecting SVG content
    if (inTemplateLiteral && currentIconName) {
      // Check if this line ends the template literal
      if (trimmed.endsWith('`,') || trimmed === '`,' || trimmed === '`') {
        currentSvg += line.replace(/\s*`,?$/, '');
        icons[currentIconName] = currentSvg.trim();
        currentIconName = null;
        currentSvg = '';
        inTemplateLiteral = false;
      } else {
        currentSvg += line + '\n';
      }
    }
  }

  return icons;
}


/**
 * Generate a Swift struct for an icon catalog
 */
function generateSwiftIcons(icons, catalog) {
  const header = `// <auto-generated />
// This file is auto-generated from ${catalog.sourceFile}
// Do not edit this file directly. Run 'npm run generate:models' to regenerate.
// swiftlint:disable line_length

import Foundation

${catalog.description.map(line => `/// ${line}`).join('\n')}
public struct ${catalog.className} {
`;

  const iconFields = Object.entries(icons)
    .map(([name, svg]) => {
      const swiftName = name.charAt(0).toLowerCase() + name.slice(1);
      // Use triple-quoted string for multiline SVG
      return `    /// ${name} icon SVG.
    public static let ${swiftName} = """
${svg}
"""`;
    })
    .join('\n\n');

  const lookup = catalog.lookup ? `

    /// The SVG for an icon key, or nil when the key is unknown to this client.
    public static func svg(for key: String) -> String? {
        switch key {
${Object.keys(icons).map(name => `        case "${name}": return ${name.charAt(0).toLowerCase() + name.slice(1)}`).join('\n')}
        default: return nil
        }
    }` : '';

  const footer = `
}
`;

  return header + iconFields + lookup + footer;
}

/**
 * Parse SVG string and convert to React Native SVG component JSX.
 * Handles circle, rect, path, and text elements.
 */
function svgToReactNative(svgString, componentName) {
  // Extract elements from SVG
  const circleRegex = /<circle\s+([^>]+)\/>/g;
  const rectRegex = /<rect\s+([^>]+)\/>/g;
  const pathRegex = /<path\s+([^>]+)\/>/g;
  const textRegex = /<text\s+([^>]+)>([^<]+)<\/text>/g;

  const elements = [];

  // Parse circles
  let match;
  while ((match = circleRegex.exec(svgString)) !== null) {
    const attrs = parseAttributes(match[1]);
    const props = Object.entries(attrs)
      .map(([key, value]) => {
        const rnKey = toReactNativeAttr(key);
        return `${rnKey}="${value}"`;
      })
      .join(' ');
    elements.push({ index: match.index, element: `<Circle ${props} />` });
  }

  // Parse rects
  while ((match = rectRegex.exec(svgString)) !== null) {
    const attrs = parseAttributes(match[1]);
    const props = Object.entries(attrs)
      .map(([key, value]) => {
        const rnKey = toReactNativeAttr(key);
        return `${rnKey}="${value}"`;
      })
      .join(' ');
    elements.push({ index: match.index, element: `<Rect ${props} />` });
  }

  // Parse paths
  while ((match = pathRegex.exec(svgString)) !== null) {
    const attrs = parseAttributes(match[1]);
    const props = Object.entries(attrs)
      .map(([key, value]) => {
        const rnKey = toReactNativeAttr(key);
        return `${rnKey}="${value}"`;
      })
      .join(' ');
    elements.push({ index: match.index, element: `<Path ${props} />` });
  }

  // Parse text elements
  while ((match = textRegex.exec(svgString)) !== null) {
    const attrs = parseAttributes(match[1]);
    const textContent = match[2];
    const props = Object.entries(attrs)
      .map(([key, value]) => {
        const rnKey = toReactNativeAttr(key);
        return `${rnKey}="${value}"`;
      })
      .join(' ');
    elements.push({ index: match.index, element: `<SvgText ${props}>${textContent}</SvgText>` });
  }

  // Sort elements by their original position in the SVG
  elements.sort((a, b) => a.index - b.index);

  const elementLines = elements.map(e => `    ${e.element}`).join('\n');

  return `export const ${componentName}Icon = ({ width = 32, height = 32 }: { width?: number; height?: number }): React.ReactElement => (
  <Svg width={width} height={height} viewBox="0 0 32 32" fill="none">
${elementLines}
  </Svg>
);`;
}

/**
 * Parse HTML/SVG attributes into an object.
 */
function parseAttributes(attrString) {
  const attrs = {};
  const attrRegex = /(\w+(?:-\w+)*)="([^"]+)"/g;
  let match;
  while ((match = attrRegex.exec(attrString)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

/**
 * Convert SVG attribute names to React Native SVG attribute names.
 */
function toReactNativeAttr(attr) {
  const mapping = {
    'stroke-width': 'strokeWidth',
    'stroke-linecap': 'strokeLinecap',
    'stroke-linejoin': 'strokeLinejoin',
    'fill-rule': 'fillRule',
    'clip-rule': 'clipRule',
    'text-anchor': 'textAnchor',
    'font-size': 'fontSize',
    'font-weight': 'fontWeight',
    'font-family': 'fontFamily',
  };
  return mapping[attr] || attr;
}

/**
 * Generate React Native SVG components from icons.
 */
function generateReactNativeIcons(icons, catalog) {
  const header = `// <auto-generated />
// This file is auto-generated from ${catalog.sourceFile}
// Do not edit this file directly. Run 'npm run generate:models' to regenerate.

import React from 'react';
import Svg, { Circle, Path, Rect, Text as SvgText } from 'react-native-svg';

`;

  const components = Object.entries(icons)
    .map(([name, svg]) => svgToReactNative(svg, name))
    .join('\n\n');

  const iconMap = `
/**
 * Map of icon key to React Native SVG component.
 */
export const ${catalog.rnMapName} = {
${Object.keys(icons).map(name => `  ${name}: ${name}Icon,`).join('\n')}
};

export type ${catalog.rnKeyTypeName} = keyof typeof ${catalog.rnMapName};
`;

  return header + components + iconMap;
}

/**
 * Generate a Kotlin object for an icon catalog
 */
function generateKotlinIcons(icons, catalog) {
  const header = `// <auto-generated />
// This file is auto-generated from ${catalog.sourceFile}
// Do not edit this file directly. Run 'npm run generate:models' to regenerate.
@file:Suppress("MaxLineLength")

package net.aliasvault.app.vaultstore.models

/**
${catalog.description.map(line => ` * ${line}`).join('\n')}
 */
object ${catalog.className} {
`;

  const iconFields = Object.entries(icons)
    .map(([name, svg]) => {
      const kotlinName = name.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '');
      // Use trimIndent for multiline string
      return `    /**
     * ${name} icon SVG.
     */
    val ${kotlinName} = """
${svg}
    """.trimIndent()`;
    })
    .join('\n\n');

  const lookup = catalog.lookup ? `

    /**
     * The SVG for an icon key, or null when the key is unknown to this client.
     */
    fun svgFor(key: String): String? = when (key) {
${Object.keys(icons).map(name => `        "${name}" -> ${name.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '')}`).join('\n')}
        else -> null
    }` : '';

  const footer = `
}
`;

  return header + iconFields + lookup + footer;
}

/**
 * Main execution
 */
function main() {
  // Read TypeScript FieldKey source
  if (!fs.existsSync(TS_SOURCE)) {
    throw new Error(`Source file not found: ${TS_SOURCE}`);
  }

  const tsContent = fs.readFileSync(TS_SOURCE, 'utf8');
  const fieldKeys = parseTypeScriptFieldKeys(tsContent);

  if (Object.keys(fieldKeys).length === 0) {
    throw new Error('No field keys found in source file');
  }

  // Read TypeScript Item.ts source for FieldTypes and ItemTypes
  if (!fs.existsSync(TS_ITEM_SOURCE)) {
    throw new Error(`Source file not found: ${TS_ITEM_SOURCE}`);
  }

  const tsItemContent = fs.readFileSync(TS_ITEM_SOURCE, 'utf8');
  const fieldTypes = parseFieldTypes(tsItemContent);
  const itemTypes = parseItemTypes(tsItemContent);

  if (fieldTypes.length === 0) {
    throw new Error('No field types found in Item.ts source file');
  }

  if (itemTypes.length === 0) {
    throw new Error('No item types found in Item.ts source file');
  }

  console.log(`Parsed ${Object.keys(fieldKeys).length} field keys`);
  console.log(`Parsed ${fieldTypes.length} field types: ${fieldTypes.join(', ')}`);
  console.log(`Parsed ${itemTypes.length} item types: ${itemTypes.join(', ')}`);

  // Generate Swift FieldKey
  ensureDir(SWIFT_OUTPUT);
  const swiftContent = generateSwift(fieldKeys);
  fs.writeFileSync(SWIFT_OUTPUT, swiftContent, 'utf8');
  console.log(`Generated: ${SWIFT_OUTPUT}`);

  // Generate Swift FieldType
  ensureDir(SWIFT_FIELD_TYPE_OUTPUT);
  const swiftFieldTypeContent = generateSwiftFieldType(fieldTypes);
  fs.writeFileSync(SWIFT_FIELD_TYPE_OUTPUT, swiftFieldTypeContent, 'utf8');
  console.log(`Generated: ${SWIFT_FIELD_TYPE_OUTPUT}`);

  // Generate Swift ItemType
  ensureDir(SWIFT_ITEM_TYPE_OUTPUT);
  const swiftItemTypeContent = generateSwiftItemType(itemTypes);
  fs.writeFileSync(SWIFT_ITEM_TYPE_OUTPUT, swiftItemTypeContent, 'utf8');
  console.log(`Generated: ${SWIFT_ITEM_TYPE_OUTPUT}`);

  // Generate Kotlin FieldKey
  ensureDir(KOTLIN_OUTPUT);
  const kotlinContent = generateKotlin(fieldKeys);
  fs.writeFileSync(KOTLIN_OUTPUT, kotlinContent, 'utf8');
  console.log(`Generated: ${KOTLIN_OUTPUT}`);

  // Generate Kotlin FieldType
  ensureDir(KOTLIN_FIELD_TYPE_OUTPUT);
  const kotlinFieldTypeContent = generateKotlinFieldType(fieldTypes);
  fs.writeFileSync(KOTLIN_FIELD_TYPE_OUTPUT, kotlinFieldTypeContent, 'utf8');
  console.log(`Generated: ${KOTLIN_FIELD_TYPE_OUTPUT}`);

  // Generate Kotlin ItemType
  ensureDir(KOTLIN_ITEM_TYPE_OUTPUT);
  const kotlinItemTypeContent = generateKotlinItemType(itemTypes);
  fs.writeFileSync(KOTLIN_ITEM_TYPE_OUTPUT, kotlinItemTypeContent, 'utf8');
  console.log(`Generated: ${KOTLIN_ITEM_TYPE_OUTPUT}`);

  // ==================== ICON GENERATION ====================

  for (const catalog of ICON_CATALOGS) {
    const source = path.join(REPO_ROOT, catalog.sourceFile);
    if (!fs.existsSync(source)) {
      throw new Error(`Icons source file not found: ${source}`);
    }

    const iconSvgs = parseIconSvgs(fs.readFileSync(source, 'utf8'), catalog.constName);
    if (Object.keys(iconSvgs).length === 0) {
      throw new Error(`No icon SVGs found in ${catalog.sourceFile}`);
    }
    console.log(`Parsed ${Object.keys(iconSvgs).length} ${catalog.className} SVGs: ${Object.keys(iconSvgs).join(', ')}`);

    const generated = [
      [catalog.outputs.swift, generateSwiftIcons(iconSvgs, catalog)],
      [catalog.outputs.kotlin, generateKotlinIcons(iconSvgs, catalog)],
      [catalog.outputs.rn, generateReactNativeIcons(iconSvgs, catalog)],
    ];
    for (const [output, content] of generated) {
      ensureDir(output);
      fs.writeFileSync(output, content, 'utf8');
      console.log(`Generated: ${output}`);
    }
  }

  console.log('\nCode generation complete!');
}

main();
