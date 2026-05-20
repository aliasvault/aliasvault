/**
 * Autofill popup type registry.
 */

import { DetectedFieldType } from '@/utils/formDetector/types/FormFields';

export type PopupTypeConfig = {
  /**
   * The DetectedFieldType this popup is responsible for. `undefined` means
   * the default credentials popup, which handles any non-specialized field.
   */
  fieldType: DetectedFieldType | undefined;
  /** i18n key for the context-menu label. */
  titleKey: string;
};

export const POPUP_TYPES = {
  credentials: {
    fieldType: undefined,
    titleKey: 'content.autofillWithAliasVault',
  },
  totp: {
    fieldType: DetectedFieldType.Totp,
    titleKey: 'content.autofillTotp',
  },
} as const satisfies Record<string, PopupTypeConfig>;

export type PopupType = keyof typeof POPUP_TYPES;

/** Default popup type when no detected field type matches a specialized popup. */
export const DEFAULT_POPUP_TYPE: PopupType = 'credentials';

/** Runtime guard: narrow a wire-format string to a known popup type. */
export function isPopupType(value: string | undefined): value is PopupType {
  return value !== undefined && value in POPUP_TYPES;
}

/** Reverse lookup: detected field type -> popup type (falls back to default). */
export function popupTypeForFieldType(fieldType: DetectedFieldType | null | undefined): PopupType {
  for (const [type, config] of Object.entries(POPUP_TYPES) as [PopupType, PopupTypeConfig][]) {
    if (config.fieldType !== undefined && config.fieldType === fieldType) {
      return type;
    }
  }
  return DEFAULT_POPUP_TYPE;
}
