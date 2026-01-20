#!/usr/bin/env node
/**
 * Generates FieldKey, FieldType, ItemType constants, SystemFieldRegistry, and ItemTypeIcons for C#, Swift, and Kotlin from TypeScript source.
 * All type definitions are dynamically extracted from the TypeScript source files.
 */

const fs = require('fs');
const path = require('path');

// Paths
const REPO_ROOT = path.join(__dirname, '../../..');
const TS_SOURCE = path.join(REPO_ROOT, 'core/models/src/vault/FieldKey.ts');
const TS_ITEM_SOURCE = path.join(REPO_ROOT, 'core/models/src/vault/Item.ts');
const TS_REGISTRY_SOURCE = path.join(REPO_ROOT, 'core/models/src/vault/SystemFieldRegistry.ts');
const TS_ICONS_SOURCE = path.join(REPO_ROOT, 'core/models/src/icons/ItemTypeIcons.ts');
const CS_OUTPUT = path.join(REPO_ROOT, 'apps/server/Databases/AliasClientDb/Models/FieldKey.cs');
const CS_FIELD_TYPE_OUTPUT = path.join(REPO_ROOT, 'apps/server/Databases/AliasClientDb/Models/FieldType.cs');
const CS_ITEM_TYPE_OUTPUT = path.join(REPO_ROOT, 'apps/server/Databases/AliasClientDb/Models/ItemType.cs');
const CS_REGISTRY_OUTPUT = path.join(REPO_ROOT, 'apps/server/Databases/AliasClientDb/Models/SystemFieldRegistry.cs');
const CS_ICONS_OUTPUT = path.join(REPO_ROOT, 'apps/server/Databases/AliasClientDb/Models/ItemTypeIcons.cs');
const SWIFT_OUTPUT = path.join(REPO_ROOT, 'apps/mobile-app/ios/VaultModels/FieldKey.swift');
const SWIFT_FIELD_TYPE_OUTPUT = path.join(REPO_ROOT, 'apps/mobile-app/ios/VaultModels/FieldType.swift');
const SWIFT_ITEM_TYPE_OUTPUT = path.join(REPO_ROOT, 'apps/mobile-app/ios/VaultModels/ItemType.swift');
const SWIFT_ICONS_OUTPUT = path.join(REPO_ROOT, 'apps/mobile-app/ios/VaultModels/ItemTypeIcons.swift');
const KOTLIN_OUTPUT = path.join(REPO_ROOT, 'apps/mobile-app/android/app/src/main/java/net/aliasvault/app/vaultstore/models/FieldKey.kt');
const KOTLIN_FIELD_TYPE_OUTPUT = path.join(REPO_ROOT, 'apps/mobile-app/android/app/src/main/java/net/aliasvault/app/vaultstore/models/FieldType.kt');
const KOTLIN_ITEM_TYPE_OUTPUT = path.join(REPO_ROOT, 'apps/mobile-app/android/app/src/main/java/net/aliasvault/app/vaultstore/models/ItemType.kt');
const KOTLIN_ICONS_OUTPUT = path.join(REPO_ROOT, 'apps/mobile-app/android/app/src/main/java/net/aliasvault/app/vaultstore/models/ItemTypeIcons.kt');
const RN_ICONS_OUTPUT = path.join(REPO_ROOT, 'apps/mobile-app/components/items/ItemTypeIconComponents.tsx');

/**
 * Parse the TypeScript FieldKey.ts file and extract constants
 */
function parseTypeScriptFieldKeys(tsContent) {
  const fieldKeys = {};

  // Extract field comments
  const lines = tsContent.split('\n');
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
 * Parse FieldCategories from TypeScript source
 * Returns an array of category names in order
 */
function parseFieldCategories(tsContent) {
  const categories = [];

  // Find the FieldCategories constant
  const match = tsContent.match(/export const FieldCategories\s*=\s*\{([^}]+)\}/s);
  if (!match) {
    console.warn('Warning: Could not find FieldCategories in source');
    return categories;
  }

  const body = match[1];
  // Match each category: Primary: 'Primary',
  const categoryRegex = /(\w+):\s*'(\w+)'/g;
  let categoryMatch;

  while ((categoryMatch = categoryRegex.exec(body)) !== null) {
    categories.push(categoryMatch[1]);
  }

  return categories;
}

/**
 * Parse ItemTypeFieldConfig type from TypeScript source
 * Returns an array of property definitions
 */
function parseItemTypeFieldConfig(tsContent) {
  const properties = [];

  // Find the ItemTypeFieldConfig type
  const match = tsContent.match(/export type ItemTypeFieldConfig\s*=\s*\{([^}]+)\}/s);
  if (!match) {
    console.warn('Warning: Could not find ItemTypeFieldConfig in source');
    return properties;
  }

  const body = match[1];
  // Match properties with comments
  const lines = body.split('\n');
  let currentComment = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // Capture comments
    const commentMatch = trimmed.match(/\/\*\*\s*(.+)\s*\*\//);
    if (commentMatch) {
      currentComment = commentMatch[1].trim();
    }

    // Match property: PropertyName: type;
    const propMatch = trimmed.match(/^(\w+):\s*(\w+);?$/);
    if (propMatch) {
      properties.push({
        name: propMatch[1],
        type: propMatch[2],
        comment: currentComment
      });
      currentComment = '';
    }
  }

  return properties;
}

/**
 * Parse SystemFieldDefinition type from TypeScript source
 * Returns an array of property definitions
 */
function parseSystemFieldDefinition(tsContent) {
  const properties = [];

  // Find the SystemFieldDefinition type
  const match = tsContent.match(/export type SystemFieldDefinition\s*=\s*\{([\s\S]*?)\n\};/);
  if (!match) {
    console.warn('Warning: Could not find SystemFieldDefinition in source');
    return properties;
  }

  const body = match[1];
  const lines = body.split('\n');
  let currentComment = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // Capture single-line comments
    const singleCommentMatch = trimmed.match(/\/\*\*\s*(.+)\s*\*\//);
    if (singleCommentMatch) {
      currentComment = singleCommentMatch[1].trim();
      continue;
    }

    // Match property definition
    const propMatch = trimmed.match(/^(\w+):\s*(.+);?$/);
    if (propMatch && !trimmed.startsWith('/*') && !trimmed.startsWith('*')) {
      let propType = propMatch[2].replace(/;$/, '').trim();

      // Simplify complex types for C# mapping
      let csharpType = mapTypeToCSharp(propType);

      properties.push({
        name: propMatch[1],
        tsType: propType,
        csharpType: csharpType,
        comment: currentComment
      });
      currentComment = '';
    }
  }

  return properties;
}

/**
 * Map TypeScript type to C# type
 */
function mapTypeToCSharp(tsType) {
  if (tsType === 'string') return 'string';
  if (tsType === 'boolean') return 'bool';
  if (tsType === 'number') return 'int';
  if (tsType === 'FieldType') return 'string'; // FieldType is a string union
  if (tsType === 'FieldCategory') return 'FieldCategory';
  if (tsType.includes('Partial<Record<ItemType, ItemTypeFieldConfig>>')) {
    return 'IReadOnlyDictionary<string, ItemTypeFieldConfig>';
  }
  return 'string'; // Default fallback
}

/**
 * Generate C# static class for FieldKey
 */
function generateCSharp(fieldKeys) {
  const header = `// <auto-generated />
// This file is auto-generated from core/models/src/vault/FieldKey.ts
// Do not edit this file directly. Run 'npm run generate:models' to regenerate.

namespace AliasClientDb.Models;

/// <summary>
/// System field keys for the field-based data model.
/// These keys map to FieldDefinition.FieldKey values.
/// </summary>
public static class FieldKey
{`;

  const fields = Object.entries(fieldKeys)
    .map(([name, { value, comment }]) => {
      return `    /// <summary>
    /// ${comment}
    /// </summary>
    public const string ${name} = "${value}";`;
    })
    .join('\n\n');

  const footer = `
}
`;

  return header + '\n' + fields + footer;
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
 * Generate C# static class for FieldType
 */
function generateCSharpFieldType(fieldTypes) {
  const header = `// <auto-generated />
// This file is auto-generated from core/models/src/vault/Item.ts
// Do not edit this file directly. Run 'npm run generate:models' to regenerate.

#nullable enable

namespace AliasClientDb.Models;

/// <summary>
/// Field types for rendering and validation.
/// </summary>
public static class FieldType
{`;

  const fields = fieldTypes
    .map(type => {
      return `    /// <summary>
    /// ${type} field type.
    /// </summary>
    public const string ${type} = "${type}";`;
    })
    .join('\n\n');

  const allTypes = `

    /// <summary>
    /// All available field types.
    /// </summary>
    public static readonly string[] All = { ${fieldTypes.map(t => t).join(', ')} };

    /// <summary>
    /// Checks if a string value is a valid field type.
    /// </summary>
    /// <param name="value">The value to check.</param>
    /// <returns>True if the value is a valid field type.</returns>
    public static bool IsValid(string? value)
    {
        return ${fieldTypes.map(t => `value == ${t}`).join(' || ')};
    }`;

  const footer = `
}
`;

  return header + '\n' + fields + allTypes + footer;
}

/**
 * Generate C# static class for ItemType
 */
function generateCSharpItemType(itemTypes) {
  const header = `// <auto-generated />
// This file is auto-generated from core/models/src/vault/Item.ts
// Do not edit this file directly. Run 'npm run generate:models' to regenerate.

#nullable enable

namespace AliasClientDb.Models;

/// <summary>
/// Item types supported by the vault.
/// </summary>
public static class ItemType
{`;

  const fields = itemTypes
    .map(type => {
      return `    /// <summary>
    /// ${type} item type.
    /// </summary>
    public const string ${type} = "${type}";`;
    })
    .join('\n\n');

  const allTypes = `

    /// <summary>
    /// All available item types.
    /// </summary>
    public static readonly string[] All = { ${itemTypes.map(t => t).join(', ')} };

    /// <summary>
    /// Checks if a string value is a valid item type.
    /// </summary>
    /// <param name="value">The value to check.</param>
    /// <returns>True if the value is a valid item type.</returns>
    public static bool IsValid(string? value)
    {
        return ${itemTypes.map(t => `value == ${t}`).join(' || ')};
    }`;

  const footer = `
}
`;

  return header + '\n' + fields + allTypes + footer;
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
 * Parse the TypeScript SystemFieldRegistry.ts file and extract field definitions
 */
function parseSystemFieldRegistry(tsContent) {
  const fields = {};

  // Find the start of SystemFieldRegistry definition
  const registryStart = tsContent.indexOf('export const SystemFieldRegistry');
  if (registryStart === -1) {
    return fields;
  }

  // Extract just the registry content
  const registryContent = tsContent.slice(registryStart);

  // Match each field definition block using a state machine approach
  // Look for patterns like: 'login.username': {
  const fieldStartRegex = /'([a-z]+\.[a-z_]+)':\s*\{/g;
  let match;

  while ((match = fieldStartRegex.exec(registryContent)) !== null) {
    const fieldKey = match[1];
    const startIdx = match.index + match[0].length;

    // Find matching closing brace by counting braces
    let braceCount = 1;
    let endIdx = startIdx;
    while (braceCount > 0 && endIdx < registryContent.length) {
      if (registryContent[endIdx] === '{') braceCount++;
      if (registryContent[endIdx] === '}') braceCount--;
      endIdx++;
    }

    const fieldBody = registryContent.slice(startIdx, endIdx - 1);

    // Skip if this doesn't look like a SystemFieldDefinition (needs FieldKey property)
    if (!fieldBody.includes('FieldKey:')) {
      continue;
    }

    const field = {
      FieldKey: fieldKey,
      FieldType: extractStringValue(fieldBody, 'FieldType'),
      IsHidden: extractBoolValue(fieldBody, 'IsHidden'),
      IsMultiValue: extractBoolValue(fieldBody, 'IsMultiValue'),
      EnableHistory: extractBoolValue(fieldBody, 'EnableHistory'),
      Category: extractEnumValue(fieldBody, 'Category', 'FieldCategories'),
      DefaultDisplayOrder: extractNumberValue(fieldBody, 'DefaultDisplayOrder'),
      ApplicableToTypes: extractApplicableToTypes(fieldBody)
    };

    fields[fieldKey] = field;
  }

  return fields;
}

/**
 * Extract a string value from a field body
 */
function extractStringValue(body, propName) {
  const match = body.match(new RegExp(`${propName}:\\s*'([^']+)'`));
  return match ? match[1] : '';
}

/**
 * Extract a boolean value from a field body
 */
function extractBoolValue(body, propName) {
  const match = body.match(new RegExp(`${propName}:\\s*(true|false)`));
  return match ? match[1] === 'true' : false;
}

/**
 * Extract a number value from a field body
 */
function extractNumberValue(body, propName) {
  const match = body.match(new RegExp(`${propName}:\\s*(\\d+)`));
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Extract an enum value from a field body (e.g., FieldCategories.Login -> Login)
 */
function extractEnumValue(body, propName, enumName) {
  const match = body.match(new RegExp(`${propName}:\\s*${enumName}\\.(\\w+)`));
  return match ? match[1] : '';
}

/**
 * Extract ApplicableToTypes object from field body
 */
function extractApplicableToTypes(body) {
  const applicableToTypes = {};

  // Find the start of ApplicableToTypes
  const startMatch = body.match(/ApplicableToTypes:\s*\{/);
  if (!startMatch) {
    return applicableToTypes;
  }

  const startIdx = startMatch.index + startMatch[0].length;

  // Find matching closing brace by counting braces
  let braceCount = 1;
  let endIdx = startIdx;
  while (braceCount > 0 && endIdx < body.length) {
    if (body[endIdx] === '{') braceCount++;
    if (body[endIdx] === '}') braceCount--;
    endIdx++;
  }

  const typesBody = body.slice(startIdx, endIdx - 1);

  // Match each item type configuration: ItemType: { ShowByDefault: bool }
  const itemTypeRegex = /(\w+):\s*\{\s*ShowByDefault:\s*(true|false)\s*\}/g;
  let typeMatch;

  while ((typeMatch = itemTypeRegex.exec(typesBody)) !== null) {
    const itemType = typeMatch[1];
    const showByDefault = typeMatch[2] === 'true';
    applicableToTypes[itemType] = { ShowByDefault: showByDefault };
  }

  return applicableToTypes;
}

/**
 * Generate C# SystemFieldRegistry with full metadata
 * All types are dynamically generated from the parsed TypeScript
 */
function generateCSharpSystemFieldRegistry(fields, categories, itemTypeFieldConfigProps, systemFieldDefProps) {
  // Generate FieldCategory enum dynamically
  const categoryEnum = categories.map((cat, index) => {
    return `    /// <summary>${cat} fields.</summary>
    ${cat}${index < categories.length - 1 ? ',' : ''}`;
  }).join('\n');

  // Generate ItemTypeFieldConfig record dynamically
  const itemTypeFieldConfigParams = itemTypeFieldConfigProps
    .map(p => `${mapTypeToCSharp(p.type)} ${p.name}`)
    .join(', ');

  // Generate SystemFieldDefinition record dynamically
  const systemFieldDefParams = systemFieldDefProps
    .map(p => `${p.csharpType} ${p.name}`)
    .join(',\n    ');

  const systemFieldDefXmlParams = systemFieldDefProps
    .map(p => `/// <param name="${p.name}">${p.comment || p.name}</param>`)
    .join('\n');

  const header = `// <auto-generated />
// This file is auto-generated from core/models/src/vault/SystemFieldRegistry.ts
// Do not edit this file directly. Run 'npm run generate:models' to regenerate.

#nullable enable

namespace AliasClientDb.Models;

/// <summary>
/// Field categories for grouping in UI.
/// </summary>
public enum FieldCategory
{
${categoryEnum}
}

/// <summary>
/// Per-item-type configuration for a system field.
/// </summary>
${itemTypeFieldConfigProps.map(p => `/// <param name="${p.name}">${p.comment || p.name}</param>`).join('\n')}
public record ItemTypeFieldConfig(${itemTypeFieldConfigParams});

/// <summary>
/// System field definition with metadata.
/// </summary>
${systemFieldDefXmlParams}
public record SystemFieldDefinition(
    ${systemFieldDefParams});

/// <summary>
/// Registry of all system-defined fields.
/// These fields are immutable and their metadata is defined in code.
/// </summary>
public static class SystemFieldRegistry
{
    /// <summary>
    /// All system field definitions indexed by field key.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, SystemFieldDefinition> Fields =
        new Dictionary<string, SystemFieldDefinition>
        {
`;

  const fieldEntries = Object.entries(fields)
    .map(([key, field]) => {
      const applicableTypes = Object.entries(field.ApplicableToTypes)
        .map(([type, config]) => `["${type}"] = new ItemTypeFieldConfig(${config.ShowByDefault})`)
        .join(', ');

      return `            [FieldKey.${fieldKeyToPropertyName(key)}] = new SystemFieldDefinition(
                FieldKey: "${field.FieldKey}",
                FieldType: "${field.FieldType}",
                IsHidden: ${field.IsHidden.toString().toLowerCase()},
                IsMultiValue: ${field.IsMultiValue.toString().toLowerCase()},
                ApplicableToTypes: new Dictionary<string, ItemTypeFieldConfig> { ${applicableTypes} },
                EnableHistory: ${field.EnableHistory.toString().toLowerCase()},
                Category: FieldCategory.${field.Category},
                DefaultDisplayOrder: ${field.DefaultDisplayOrder})`;
    })
    .join(',\n');

  // Extract unique prefixes from field keys for IsSystemFieldPrefix
  const prefixes = [...new Set(Object.keys(fields).map(k => k.split('.')[0]))];
  const prefixChecks = prefixes.map(p => `fieldKey.StartsWith("${p}.")`).join(' ||\n               ');

  const methods = `
        };

    /// <summary>
    /// Get system field definition by key.
    /// </summary>
    /// <param name="fieldKey">The field key to look up.</param>
    /// <returns>The field definition, or null if not found.</returns>
    public static SystemFieldDefinition? GetSystemField(string fieldKey)
    {
        return Fields.TryGetValue(fieldKey, out var field) ? field : null;
    }

    /// <summary>
    /// Check if a field key represents a system field.
    /// </summary>
    /// <param name="fieldKey">The field key to check.</param>
    /// <returns>True if the field key is a system field.</returns>
    public static bool IsSystemField(string fieldKey)
    {
        return Fields.ContainsKey(fieldKey);
    }

    /// <summary>
    /// Check if a field applies to a specific item type.
    /// </summary>
    /// <param name="field">The field definition.</param>
    /// <param name="itemType">The item type to check.</param>
    /// <returns>True if the field applies to the item type.</returns>
    public static bool FieldAppliesToType(SystemFieldDefinition field, string itemType)
    {
        return field.ApplicableToTypes.ContainsKey(itemType);
    }

    /// <summary>
    /// Get all system fields applicable to a specific item type.
    /// Results are sorted by DefaultDisplayOrder.
    /// </summary>
    /// <param name="itemType">The item type.</param>
    /// <returns>Fields applicable to the item type.</returns>
    public static IEnumerable<SystemFieldDefinition> GetFieldsForItemType(string itemType)
    {
        return Fields.Values
            .Where(f => f.ApplicableToTypes.ContainsKey(itemType))
            .OrderBy(f => f.DefaultDisplayOrder);
    }

    /// <summary>
    /// Get system fields that should be shown by default for a specific item type.
    /// Results are sorted by DefaultDisplayOrder.
    /// </summary>
    /// <param name="itemType">The item type.</param>
    /// <returns>Fields shown by default for the item type.</returns>
    public static IEnumerable<SystemFieldDefinition> GetDefaultFieldsForItemType(string itemType)
    {
        return Fields.Values
            .Where(f => f.ApplicableToTypes.TryGetValue(itemType, out var config) && config.ShowByDefault)
            .OrderBy(f => f.DefaultDisplayOrder);
    }

    /// <summary>
    /// Get system fields that are NOT shown by default for a specific item type.
    /// These are the fields that can be added via an "add field" button.
    /// Results are sorted by DefaultDisplayOrder.
    /// </summary>
    /// <param name="itemType">The item type.</param>
    /// <returns>Optional fields for the item type.</returns>
    public static IEnumerable<SystemFieldDefinition> GetOptionalFieldsForItemType(string itemType)
    {
        return Fields.Values
            .Where(f => f.ApplicableToTypes.TryGetValue(itemType, out var config) && !config.ShowByDefault)
            .OrderBy(f => f.DefaultDisplayOrder);
    }

    /// <summary>
    /// Check if a field key matches a known system field prefix.
    /// </summary>
    /// <param name="fieldKey">The field key to check.</param>
    /// <returns>True if the field key has a system field prefix.</returns>
    public static bool IsSystemFieldPrefix(string fieldKey)
    {
        return ${prefixChecks};
    }
}
`;

  return header + fieldEntries + methods;
}

/**
 * Convert field key to C# property name (e.g., 'login.username' -> 'LoginUsername')
 */
function fieldKeyToPropertyName(fieldKey) {
  return fieldKey
    .split('.')
    .map(part => part.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(''))
    .join('');
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
 * Parse ItemTypeIconSvgs from TypeScript source
 */
function parseItemTypeIconSvgs(tsContent) {
  const icons = {};

  // Find the ItemTypeIconSvgs constant
  const startMatch = tsContent.match(/export const ItemTypeIconSvgs\s*=\s*\{/);
  if (!startMatch) {
    console.warn('Warning: Could not find ItemTypeIconSvgs in source');
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
  const lines = body.split('\n');
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
 * Generate C# ItemTypeIcons static class
 */
function generateCSharpIcons(icons) {
  const header = `// <auto-generated />
// This file is auto-generated from core/models/src/icons/ItemTypeIcons.ts
// Do not edit this file directly. Run 'npm run generate:models' to regenerate.

namespace AliasClientDb.Models;

/// <summary>
/// Centralized SVG icon definitions for item types.
/// Single source of truth for all item type icons across platforms.
/// </summary>
public static class ItemTypeIcons
{
`;

  const iconFields = Object.entries(icons)
    .map(([name, svg]) => {
      // Escape the SVG for C# string literal
      const escapedSvg = svg.replace(/"/g, '\\"').replace(/\n/g, '\\n');
      return `    /// <summary>${name} icon SVG.</summary>
    public const string ${name} = "${escapedSvg}";`;
    })
    .join('\n\n');

  const footer = `
}
`;

  return header + iconFields + footer;
}

/**
 * Generate Swift ItemTypeIcons struct
 */
function generateSwiftIcons(icons) {
  const header = `// <auto-generated />
// This file is auto-generated from core/models/src/icons/ItemTypeIcons.ts
// Do not edit this file directly. Run 'npm run generate:models' to regenerate.
// swiftlint:disable line_length

import Foundation

/// Centralized SVG icon definitions for item types.
/// Single source of truth for all item type icons across platforms.
public struct ItemTypeIcons {
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

  const footer = `
}
`;

  return header + iconFields + footer;
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
function generateReactNativeIcons(icons) {
  const header = `// <auto-generated />
// This file is auto-generated from core/models/src/icons/ItemTypeIcons.ts
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
export const iconComponents = {
${Object.keys(icons).map(name => `  ${name}: ${name}Icon,`).join('\n')}
};

export type IconKey = keyof typeof iconComponents;
`;

  return header + components + iconMap;
}

/**
 * Generate Kotlin ItemTypeIcons object
 */
function generateKotlinIcons(icons) {
  const header = `// <auto-generated />
// This file is auto-generated from core/models/src/icons/ItemTypeIcons.ts
// Do not edit this file directly. Run 'npm run generate:models' to regenerate.
@file:Suppress("MaxLineLength")

package net.aliasvault.app.vaultstore.models

/**
 * Centralized SVG icon definitions for item types.
 * Single source of truth for all item type icons across platforms.
 */
object ItemTypeIcons {
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

  const footer = `
}
`;

  return header + iconFields + footer;
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

  // Read TypeScript SystemFieldRegistry source
  if (!fs.existsSync(TS_REGISTRY_SOURCE)) {
    throw new Error(`Source file not found: ${TS_REGISTRY_SOURCE}`);
  }

  const tsRegistryContent = fs.readFileSync(TS_REGISTRY_SOURCE, 'utf8');

  // Parse types dynamically from TypeScript
  const categories = parseFieldCategories(tsRegistryContent);
  const itemTypeFieldConfigProps = parseItemTypeFieldConfig(tsRegistryContent);
  const systemFieldDefProps = parseSystemFieldDefinition(tsRegistryContent);
  const systemFields = parseSystemFieldRegistry(tsRegistryContent);

  if (Object.keys(systemFields).length === 0) {
    throw new Error('No system fields found in registry source file');
  }

  console.log(`Parsed ${Object.keys(fieldKeys).length} field keys`);
  console.log(`Parsed ${fieldTypes.length} field types: ${fieldTypes.join(', ')}`);
  console.log(`Parsed ${itemTypes.length} item types: ${itemTypes.join(', ')}`);
  console.log(`Parsed ${categories.length} field categories: ${categories.join(', ')}`);
  console.log(`Parsed ${itemTypeFieldConfigProps.length} ItemTypeFieldConfig properties`);
  console.log(`Parsed ${systemFieldDefProps.length} SystemFieldDefinition properties`);
  console.log(`Parsed ${Object.keys(systemFields).length} system field definitions`);

  // Generate C# FieldKey
  ensureDir(CS_OUTPUT);
  const csContent = generateCSharp(fieldKeys);
  fs.writeFileSync(CS_OUTPUT, csContent, 'utf8');
  console.log(`Generated: ${CS_OUTPUT}`);

  // Generate C# FieldType
  ensureDir(CS_FIELD_TYPE_OUTPUT);
  const csFieldTypeContent = generateCSharpFieldType(fieldTypes);
  fs.writeFileSync(CS_FIELD_TYPE_OUTPUT, csFieldTypeContent, 'utf8');
  console.log(`Generated: ${CS_FIELD_TYPE_OUTPUT}`);

  // Generate C# ItemType
  ensureDir(CS_ITEM_TYPE_OUTPUT);
  const csItemTypeContent = generateCSharpItemType(itemTypes);
  fs.writeFileSync(CS_ITEM_TYPE_OUTPUT, csItemTypeContent, 'utf8');
  console.log(`Generated: ${CS_ITEM_TYPE_OUTPUT}`);

  // Generate C# SystemFieldRegistry
  ensureDir(CS_REGISTRY_OUTPUT);
  const csRegistryContent = generateCSharpSystemFieldRegistry(
    systemFields,
    categories,
    itemTypeFieldConfigProps,
    systemFieldDefProps
  );
  fs.writeFileSync(CS_REGISTRY_OUTPUT, csRegistryContent, 'utf8');
  console.log(`Generated: ${CS_REGISTRY_OUTPUT}`);

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

  // Read TypeScript ItemTypeIcons source
  if (!fs.existsSync(TS_ICONS_SOURCE)) {
    console.warn(`Warning: Icons source file not found: ${TS_ICONS_SOURCE}`);
  } else {
    const tsIconsContent = fs.readFileSync(TS_ICONS_SOURCE, 'utf8');
    const iconSvgs = parseItemTypeIconSvgs(tsIconsContent);

    if (Object.keys(iconSvgs).length === 0) {
      console.warn('Warning: No icon SVGs found in source file');
    } else {
      console.log(`Parsed ${Object.keys(iconSvgs).length} icon SVGs: ${Object.keys(iconSvgs).join(', ')}`);

      // Generate C# ItemTypeIcons
      ensureDir(CS_ICONS_OUTPUT);
      const csIconsContent = generateCSharpIcons(iconSvgs);
      fs.writeFileSync(CS_ICONS_OUTPUT, csIconsContent, 'utf8');
      console.log(`Generated: ${CS_ICONS_OUTPUT}`);

      // Generate Swift ItemTypeIcons
      ensureDir(SWIFT_ICONS_OUTPUT);
      const swiftIconsContent = generateSwiftIcons(iconSvgs);
      fs.writeFileSync(SWIFT_ICONS_OUTPUT, swiftIconsContent, 'utf8');
      console.log(`Generated: ${SWIFT_ICONS_OUTPUT}`);

      // Generate Kotlin ItemTypeIcons
      ensureDir(KOTLIN_ICONS_OUTPUT);
      const kotlinIconsContent = generateKotlinIcons(iconSvgs);
      fs.writeFileSync(KOTLIN_ICONS_OUTPUT, kotlinIconsContent, 'utf8');
      console.log(`Generated: ${KOTLIN_ICONS_OUTPUT}`);

      // Generate React Native ItemTypeIcons components
      ensureDir(RN_ICONS_OUTPUT);
      const rnIconsContent = generateReactNativeIcons(iconSvgs);
      fs.writeFileSync(RN_ICONS_OUTPUT, rnIconsContent, 'utf8');
      console.log(`Generated: ${RN_ICONS_OUTPUT}`);
    }
  }

  console.log('\nCode generation complete!');
}

main();
