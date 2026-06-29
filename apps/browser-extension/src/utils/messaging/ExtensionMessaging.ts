/**
 * Shared messaging contract for the extension. Every message that crosses a
 * popup/background/content-script boundary is declared here and dispatched via
 * the `sendMessage` / `onMessage` exported here.
 */

import { defineExtensionMessaging } from '@webext-core/messaging';

import type { TwoFactorState } from '@/entrypoints/background/TwoFactorStateHandler';
import type { SyncStatusCheckResult, FullVaultSyncResult } from '@/entrypoints/background/VaultMessageHandler';

import type { EncryptionKeyDerivationParams } from '@/utils/dist/core/models/metadata';
import type { PasswordSettings } from '@/utils/dist/core/models/vault';
import type { LoginResponse } from '@/utils/dist/core/models/webapi';
import type { SavePromptPersistedState, LastAutofilledCredential } from '@/utils/loginDetector';
import type { PendingPasskeyRequest, WebAuthnSettingsResponse, WebAuthnPublicKeyGetPayload, MatchingPasskeysResponse, WebAuthnAssertionResponse } from '@/utils/passkey/types';
import type { BoolResponse } from '@/utils/types/messaging/BoolResponse';
import type { DuplicateCheckResponse } from '@/utils/types/messaging/DuplicateCheckResponse';
import type { IdentitySettingsResponse } from '@/utils/types/messaging/IdentitySettingsResponse';
import type { ItemsResponse } from '@/utils/types/messaging/ItemsResponse';
import type { PasswordSettingsResponse } from '@/utils/types/messaging/PasswordSettingsResponse';
import type { SaveLoginResponse } from '@/utils/types/messaging/SaveLoginResponse';
import type { StringResponse } from '@/utils/types/messaging/StringResponse';
import type { VaultResponse } from '@/utils/types/messaging/VaultResponse';
import type { VaultUploadResponse } from '@/utils/types/messaging/VaultUploadResponse';

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Protocol map enumerating every message that flows through the extension's
 * runtime messaging system. Each entry maps a message name to a function
 * signature where the argument is the request payload and the return value is
 * the response shape (promises are unwrapped automatically by the library).
 */
export interface IExtensionMessageProtocol {
  ADD_URL_TO_CREDENTIAL(data: { itemId: string; url: string }): { success: boolean; error?: string }; 
  AUTOFILL_CREATED_ITEM(data: { item: any; elementIdentifier?: string }): BoolResponse;
  CANCEL_CLIPBOARD_CLEAR(): void;
  CHECK_AUTH_STATUS(): { isLoggedIn: boolean; isVaultLocked: boolean; hasPendingMigrations: boolean; error?: string };
  CHECK_LOGIN_DUPLICATE(data: { domain: string; username: string }): DuplicateCheckResponse;
  CHECK_SYNC_STATUS(): SyncStatusCheckResult;
  CLEAR_LAST_AUTOFILLED(): { success: boolean };
  CLEAR_PERSISTED_FORM_VALUES(): void;
  CLEAR_SAVE_PROMPT_STATE(): { success: boolean };
  CLEAR_SESSION(): BoolResponse;
  CLEAR_TWO_FACTOR_STATE(): void;
  CLEAR_VAULT_DATA(): BoolResponse;
  CLIPBOARD_CLEARED(data: Record<string, never>): void;
  CLIPBOARD_COPIED(): void;
  CLIPBOARD_COPIED_FROM_CONTEXT(): void;
  CLIPBOARD_COUNTDOWN(data: { remaining: number; total: number; id: number }): void;
  CLIPBOARD_COUNTDOWN_CANCELLED(data: Record<string, never>): void;
  FULL_VAULT_SYNC(): FullVaultSyncResult;
  GENERATE_PASSWORD(data: { settings: PasswordSettings }): { success: boolean; password?: string; error?: string };
  GENERATE_TOTP_CODE(data: { itemId: string }): { success: boolean; code?: string; error?: string };
  GET_CLIPBOARD_CLEAR_TIMEOUT(): number;
  GET_CLIPBOARD_COUNTDOWN_STATE(): { remaining: number; total: number; id: number } | null;
  GET_DEFAULT_EMAIL_DOMAIN(): StringResponse;
  GET_DEFAULT_IDENTITY_SETTINGS(): IdentitySettingsResponse;
  GET_ENCRYPTED_VAULT(): string | null;
  GET_ENCRYPTION_KEY(): string | null;
  GET_ENCRYPTION_KEY_DERIVATION_PARAMS(): EncryptionKeyDerivationParams | null;
  GET_FILTERED_ITEMS(data: { currentUrl: string; pageTitle: string; matchingMode?: string; includeRecentlySelected?: boolean }): ItemsResponse;
  GET_ITEMS_WITH_TOTP(data: { currentUrl: string; pageTitle: string; matchingMode?: string }): ItemsResponse;
  GET_LAST_AUTOFILLED(data: { domain?: string; username?: string }): { success: boolean; credential: LastAutofilledCredential | null };
  GET_LOGIN_SAVE_SETTINGS(): { success: boolean; enabled: boolean; autoDismissSeconds: number; error?: string };
  GET_MATCHING_PASSKEYS(data: { rpId: string; allowCredentialIds?: string[] }): MatchingPasskeysResponse;
  GET_PASSWORD_SETTINGS(): PasswordSettingsResponse;
  GET_PERSISTED_FORM_VALUES(): any | null;
  GET_RECENTLY_SELECTED(data: { domain: string }): { success: boolean; itemId?: string | null };
  GET_REQUEST_DATA(data: any): PendingPasskeyRequest | null;
  GET_SAVE_PROMPT_STATE(): { success: boolean; state: SavePromptPersistedState | null };
  GET_SEARCH_ITEMS(data: { searchTerm: string }): ItemsResponse;
  GET_SERVER_REVISION(): number;
  GET_SYNC_STATE(): { isDirty: boolean; mutationSequence: number; serverRevision: number; isSyncInProgress: boolean };
  GET_TOTP_SECRETS(data: { itemIds: string[] }): { success: boolean; secrets?: Record<string, string>; error?: string };
  GET_TWO_FACTOR_STATE(): TwoFactorState | null;
  GET_VAULT(): VaultResponse;
  GET_WEBAUTHN_SETTINGS(data: any): WebAuthnSettingsResponse;
  IS_URL_LINKED_TO_CREDENTIAL(data: { itemId: string; url: string }): { linked: boolean };
  LOCK_VAULT(): BoolResponse;
  MARK_VAULT_CLEAN(data: { mutationSeqAtStart: number; newServerRevision: number }): { cleared: boolean; currentMutationSeq: number };
  OPEN_AUTOFILL_POPUP(data: { elementIdentifier: string; popupType?: string }): BoolResponse;
  OPEN_POPUP(): BoolResponse;
  OPEN_POPUP_CREATE_CREDENTIAL(data: { itemTitle?: string; currentUrl?: string; elementIdentifier?: string; left?: number; top?: number }): BoolResponse;
  OPEN_POPUP_WITH_ITEM(data: any): BoolResponse;
  PASSKEY_POPUP_RESPONSE(data: any): { success: boolean };
  PERSIST_FORM_VALUES(data: any): void;
  POPUP_HEARTBEAT(): void;
  RESET_AUTO_LOCK_TIMER(): void;
  SAVE_LOGIN_CREDENTIAL(data: { serviceName: string; username: string; password: string; url: string; domain: string; logoBase64?: string; faviconUrl?: string }): SaveLoginResponse;
  SEARCH_ITEMS_WITH_TOTP(data: { searchTerm: string }): ItemsResponse;
  SET_AUTO_LOCK_TIMEOUT(data: number): boolean;
  SET_CLIPBOARD_CLEAR_TIMEOUT(data: number): boolean;
  SET_LOGIN_SAVE_ENABLED(data: boolean): BoolResponse;
  SET_RECENTLY_SELECTED(data: { itemId: string; domain: string }): { success: boolean };
  STORE_ENCRYPTED_VAULT(data: { vaultBlob: string; markDirty?: boolean; serverRevision?: number; expectedMutationSeq?: number }): { success: boolean; mutationSequence: number };
  STORE_ENCRYPTION_KEY(data: string): BoolResponse;
  STORE_ENCRYPTION_KEY_DERIVATION_PARAMS(data: EncryptionKeyDerivationParams): BoolResponse;
  STORE_LAST_AUTOFILLED(data: LastAutofilledCredential): { success: boolean };
  STORE_SAVE_PROMPT_STATE(data: SavePromptPersistedState): { success: boolean };
  STORE_TWO_FACTOR_STATE(data: { username: string; loginResponse: LoginResponse; passwordHashString: string; passwordHashBase64: string; rememberMe: boolean }): void;
  STORE_VAULT_METADATA(data: { publicEmailDomainList?: string[]; privateEmailDomainList?: string[]; hiddenPrivateEmailDomainList?: string[] }): BoolResponse;
  SYNC_VAULT(): BoolResponse;
  TOGGLE_CONTEXT_MENU(data: any): BoolResponse;
  UPLOAD_VAULT(): VaultUploadResponse;
  VAULT_UNLOCKED(): void;
  WEBAUTHN_CREATE(data: any): any;
  WEBAUTHN_GET(data: any): any;
  WEBAUTHN_GET_ASSERTION(data: { passkeyId: string; origin: string; publicKey: WebAuthnPublicKeyGetPayload }): WebAuthnAssertionResponse;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const { sendMessage, onMessage } = defineExtensionMessaging<IExtensionMessageProtocol>();
