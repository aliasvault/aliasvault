import { FieldKey, FieldTypes, getSystemField, type FieldCategory, FieldCategories, type Item, type ItemField } from '@aliasvault/models/vault';

/**
 * A single value of an item field as shown on the item page. A multi-value field renders one display field per value.
 */
export type DisplayField = {
  FieldKey: string;
  Label: string;
  FieldType: string;
  IsCustomField: boolean;
  Value: string;
  IsHidden: boolean;
  EnableHistory: boolean;
  DisplayOrder: number;
  Category: FieldCategory;
};

/**
 * The category of a field, from the system field registry; unknown keys are custom.
 */
const getCategory = (field: ItemField): FieldCategory => {
  if (field.IsCustomField) {
    return FieldCategories.Custom;
  }
  return getSystemField(field.FieldKey)?.Category ?? FieldCategories.Custom;
};

/**
 * The values of a field, one entry per non-empty value.
 */
const valuesOf = (field: ItemField): string[] => {
  const values = Array.isArray(field.Value) ? field.Value : [field.Value];
  return values.filter(v => typeof v === 'string' && v.length > 0);
};

/**
 * The order of a login field on the item page: email, username, password, then the rest.
 */
const loginOrder = (field: DisplayField): number => {
  switch (field.FieldKey) {
    case FieldKey.LoginEmail: return 1;
    case FieldKey.LoginUsername: return 2;
    case FieldKey.LoginPassword: return 3;
    default: return 4 + field.DisplayOrder;
  }
};

/**
 * Group the non-empty field values of an item by category, in display order.
 */
export function groupDisplayFields(item: Item): Record<FieldCategory, DisplayField[]> {
  const result = Object.fromEntries(Object.values(FieldCategories).map(c => [c, [] as DisplayField[]])) as Record<FieldCategory, DisplayField[]>;

  for (const field of item.Fields) {
    const category = getCategory(field);
    const systemField = field.IsCustomField ? undefined : getSystemField(field.FieldKey);
    for (const value of valuesOf(field)) {
      result[category].push({
        FieldKey: field.FieldKey,
        Label: field.IsCustomField ? field.Label : field.FieldKey,
        FieldType: field.FieldType ?? FieldTypes.Text,
        IsCustomField: field.IsCustomField,
        Value: value,
        IsHidden: field.IsHidden,
        EnableHistory: field.EnableHistory,
        DisplayOrder: systemField?.DefaultDisplayOrder ?? field.DisplayOrder,
        Category: category,
      });
    }
  }

  for (const category of Object.keys(result) as FieldCategory[]) {
    result[category].sort((a, b) => a.DisplayOrder - b.DisplayOrder);
  }
  result[FieldCategories.Login].sort((a, b) => loginOrder(a) - loginOrder(b));

  return result;
}

/**
 * The URL values of an item, for the header block.
 */
export function getUrlValues(item: Item): string[] {
  const field = item.Fields.find(f => f.FieldKey === FieldKey.LoginUrl);
  return field ? valuesOf(field) : [];
}

/** Field types that always span the full width. */
const ALWAYS_FULL_WIDTH_TYPES: string[] = [FieldTypes.Password, FieldTypes.Hidden, FieldTypes.TextArea, FieldTypes.URL];

/** Field keys that always span the full width. */
const ALWAYS_FULL_WIDTH_KEYS: string[] = [FieldKey.CardCardholderName];

/** Field pairs that sit next to each other at half width when both are present. */
const PINNED_HALF_WIDTH_PAIRS: [string, string][] = [
  [FieldKey.CardExpiryMonth, FieldKey.CardExpiryYear],
  [FieldKey.CardCvv, FieldKey.CardPin],
];

/**
 * Which fields of a section span the full width.
 */
function getFullWidthFields(fields: DisplayField[]): Set<string> {
  const fullWidth = new Set<string>();
  const keys = new Set(fields.map(f => f.FieldKey));
  const pinnedHalf = new Set<string>();
  for (const [a, b] of PINNED_HALF_WIDTH_PAIRS) {
    if (keys.has(a) && keys.has(b)) {
      pinnedHalf.add(a);
      pinnedHalf.add(b);
    }
  }

  const candidates: DisplayField[] = [];
  for (const field of fields) {
    if (pinnedHalf.has(field.FieldKey)) {
      continue;
    }
    if (ALWAYS_FULL_WIDTH_TYPES.includes(field.FieldType) || ALWAYS_FULL_WIDTH_KEYS.includes(field.FieldKey)) {
      fullWidth.add(field.FieldKey);
    } else {
      candidates.push(field);
    }
  }

  if (candidates.length === 1) {
    fullWidth.add(candidates[0].FieldKey);
  } else if (candidates.length > 1 && candidates.length % 2 === 1) {
    fullWidth.add(candidates[candidates.length - 1].FieldKey);
  }

  return fullWidth;
}

/**
 * Whether a field spans the full width of its section.
 */
export function shouldBeFullWidth(field: DisplayField, fields: DisplayField[]): boolean {
  return getFullWidthFields(fields).has(field.FieldKey);
}
