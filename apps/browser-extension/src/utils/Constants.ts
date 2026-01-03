export const DISABLED_SITES_KEY = 'local:aliasvault_disabled_sites';
export const GLOBAL_AUTOFILL_POPUP_ENABLED_KEY = 'local:aliasvault_global_autofill_popup_enabled';
export const GLOBAL_CONTEXT_MENU_ENABLED_KEY = 'local:aliasvault_global_context_menu_enabled';
export const VAULT_LOCKED_DISMISS_UNTIL_KEY = 'local:aliasvault_vault_locked_dismiss_until';
export const TEMPORARY_DISABLED_SITES_KEY = 'local:aliasvault_temporary_disabled_sites';
export const CLIPBOARD_CLEAR_TIMEOUT_KEY = 'local:aliasvault_clipboard_clear_timeout';
export const AUTO_LOCK_TIMEOUT_KEY = 'local:aliasvault_auto_lock_timeout';
export const AUTOFILL_MATCHING_MODE_KEY = 'local:aliasvault_autofill_matching_mode';
export const PASSKEY_PROVIDER_ENABLED_KEY = 'local:aliasvault_passkey_provider_enabled';
export const PASSKEY_DISABLED_SITES_KEY = 'local:aliasvault_passkey_disabled_sites';
export const PENDING_REDIRECT_URL_KEY = 'session:pendingRedirectUrl';

// TODO: store these settings in the actual vault when updating the datamodel for roadmap v1.0.
export const CUSTOM_EMAIL_HISTORY_KEY = 'local:aliasvault_custom_email_history';
export const CUSTOM_USERNAME_HISTORY_KEY = 'local:aliasvault_custom_username_history';
export const SKIP_FORM_RESTORE_KEY = 'local:aliasvault_skip_form_restore';

/**
 * Placeholder SVG for items without a logo (key icon).
 * Used by both ItemIcon.tsx (React) and Popup.ts (content script).
 */
export const PLACEHOLDER_ICON_SVG = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="6.5" stroke="#f49541" stroke-width="2.5"/><circle cx="10" cy="10" r="2.5" stroke="#f49541" stroke-width="2"/><path d="M15 15L27 27" stroke="#f49541" stroke-width="2.5" stroke-linecap="round"/><path d="M19 19L23 15" stroke="#f49541" stroke-width="2.5" stroke-linecap="round"/><path d="M24 24L28 20" stroke="#f49541" stroke-width="2.5" stroke-linecap="round"/></svg>`;
