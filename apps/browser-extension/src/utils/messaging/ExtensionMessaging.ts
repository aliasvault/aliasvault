/**
 * Shared messaging contract for the extension. Every message that crosses a
 * popup/background/content-script boundary is declared here and dispatched via
 * the `sendMessage` / `onMessage` exported here.
 */

import { defineExtensionMessaging } from '@webext-core/messaging';

/**
 * A TOTP code generated in the background for the in-page preview; the secret itself never leaves the background.
 */
export type TotpCodePreview = {
  Code: string;
  Period: number;
};

import type { TwoFactorPrompt } from '@/entrypoints/background/TwoFactorStateHandler';

import type { SavePromptPersistedState, LastAutofilledCredential } from '@/utils/loginDetector';
import type { PendingPasskeyRequest, WebAuthnSettingsResponse, WebAuthnPublicKeyGetPayload, MatchingPasskeysResponse, WebAuthnAssertionResponse } from '@/utils/passkey/types';
import type { BackgroundAuthResult } from '@/utils/types/messaging/BackgroundAuthResult';
import type { BoolResponse } from '@/utils/types/messaging/BoolResponse';
import type { ContentSettings } from '@/utils/types/messaging/ContentSettings';
import type { DuplicateCheckResponse } from '@/utils/types/messaging/DuplicateCheckResponse';
import type { FullVaultSyncRequest } from '@/utils/types/messaging/FullVaultSyncRequest';
import type { ItemsResponse } from '@/utils/types/messaging/ItemsResponse';
import type { SaveLoginResponse } from '@/utils/types/messaging/SaveLoginResponse';
import type { VaultSyncPhase } from '@/utils/types/messaging/VaultSyncPhase';
import type { VaultSyncState } from '@/utils/types/messaging/VaultSyncState';

import type { ItemUsageAction } from '@aliasvault/client/database';
import type { ItemRef } from '@aliasvault/client/database/ItemRef';
import type { VaultMigrationKind } from '@aliasvault/client/sync/VaultManifestMigration';
import type { VaultMutationScope } from '@aliasvault/client/sync/VaultMutationScope';
import type { FullVaultSyncResult, SharedManifestDetails, VaultManifestMigrationResult } from '@aliasvault/client/sync/VaultSync';
import type { UnlockKeyDerivationParams } from '@aliasvault/models/metadata';
import type { Credential } from '@aliasvault/models/vault';

/**
 * How the background stores an encrypted vault blob, sent along with its last chunk (see VaultBlobTransfer).
 */
export type VaultBlobStoreOptions = {
  markDirty?: boolean;
  expectedMutationSeq?: number;
  scopes?: VaultMutationScope[];
};

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Protocol map enumerating every message that flows through the extension's
 * runtime messaging system. Each entry maps a message name to a function
 * signature where the argument is the request payload and the return value is
 * the response shape (promises are unwrapped automatically by the library).
 */
export interface IExtensionMessageProtocol {
  AUTH_AWAIT_PENDING(): BackgroundAuthResult | null;
  AUTH_LOGIN(data: { username: string; password: string; rememberMe: boolean }): BackgroundAuthResult;
  AUTH_LOGIN_TWO_FACTOR(data: { code: string }): BackgroundAuthResult;
  AUTH_UNLOCK_PASSWORD(data: { password: string }): BackgroundAuthResult;
  AUTH_UNLOCK_PIN(data: { pin: string }): BackgroundAuthResult;
  ADD_URL_TO_CREDENTIAL(data: { itemId: string; manifestId: string; url: string }): { success: boolean; error?: string }; 
  AUTOFILL_CREATED_ITEM(data: { item: any; elementIdentifier?: string }): BoolResponse;
  BLOCK_LOGIN_SAVE_FOR_DOMAIN(data: { domain: string }): void;
  CHECK_AUTH_STATUS(): { isLoggedIn: boolean; isVaultLocked: boolean; requiresLegacySqliteBlobMigration: boolean; requiresManifestMigration: boolean; error?: string };
  CHECK_LOGIN_DUPLICATE(data: { domain: string; username: string }): DuplicateCheckResponse;
  CLEAR_LAST_AUTOFILLED(): { success: boolean };
  CLEAR_PERSISTED_FORM_VALUES(): void;
  CLEAR_SAVE_PROMPT_STATE(): { success: boolean };
  CLEAR_SESSION(): BoolResponse;
  CLEAR_TWO_FACTOR_STATE(): void;
  CLEAR_VAULT_DATA(): BoolResponse;
  CLIPBOARD_CLEARED(data: Record<string, never>): void;
  CLIPBOARD_COPIED(): void;
  CLIPBOARD_COUNTDOWN(data: { remaining: number; total: number; id: number }): void;
  DISABLE_AUTOFILL_FOR_SITE(data: { temporary: boolean }): void;
  DISMISS_VAULT_LOCKED_POPUP(): void;
  FULL_VAULT_SYNC(data: FullVaultSyncRequest): FullVaultSyncResult;
  GENERATE_TOTP_CODE(data: { itemId: string; manifestId: string; autofill?: boolean }): { success: boolean; code?: string; error?: string };
  GET_CLIPBOARD_COUNTDOWN_STATE(): { remaining: number; total: number; id: number } | null;
  GET_CONTENT_SETTINGS(): ContentSettings;
  GET_ENCRYPTION_KEY(): string | null;
  GET_UNLOCK_KEY_DERIVATION_PARAMS(): UnlockKeyDerivationParams | null;
  GET_AUTOFILL_CREDENTIAL(data: { itemId: string; manifestId: string }): { success: boolean; credential?: Credential; error?: string };
  GET_FILTERED_ITEMS(data: { pageTitle: string; matchingMode?: string; includeRecentlySelected?: boolean }): ItemsResponse;
  GET_ITEMS_WITH_TOTP(data: { pageTitle: string; matchingMode?: string }): ItemsResponse;
  GET_LANGUAGE(): string;
  GET_LAST_AUTOFILLED(data: { domain?: string; username?: string }): { success: boolean; credential: LastAutofilledCredential | null };
  GET_LOGIN_SAVE_SETTINGS(): { success: boolean; enabled: boolean; autoDismissSeconds: number; error?: string };
  GET_MATCHING_PASSKEYS(data: { rpId: string; allowCredentialIds?: string[] }): MatchingPasskeysResponse;
  GET_PERSISTED_FORM_VALUES(): any | null;
  GET_REQUEST_DATA(data: any): PendingPasskeyRequest | null;
  GET_SAVE_PROMPT_STATE(data: { currentDomain: string }): { success: boolean; state: SavePromptPersistedState | null };
  GET_SEARCH_ITEMS(data: { searchTerm: string }): ItemsResponse;
  GET_SYNC_STATE(): VaultSyncState;
  GET_TOTP_CODES(data: { items: ItemRef[] }): { success: boolean; codes?: Record<string, TotpCodePreview>; error?: string };
  GET_TWO_FACTOR_STATE(): TwoFactorPrompt | null;
  GET_VAULT_MIGRATION_STATUS(): VaultMigrationKind;
  GET_WEBAUTHN_SETTINGS(data: any): WebAuthnSettingsResponse;
  GROUP_CREATE_VAULT(data: { groupId: string; name: string }): { success: boolean; error?: string; apiErrorCode?: string };
  GROUP_UPDATE_VAULT(data: { groupId: string; manifestId: string; details: SharedManifestDetails }): { success: boolean; error?: string; apiErrorCode?: string };
  GROUP_INVITE_MEMBER(data: { groupId: string; manifestId: string; userId: string }): { success: boolean; error?: string; apiErrorCode?: string };
  GROUP_REVOKE_ACCESS(data: { groupId: string; manifestId: string; userId: string }): { success: boolean; error?: string; apiErrorCode?: string };
  IS_URL_LINKED_TO_CREDENTIAL(data: { itemId: string; manifestId: string; url: string }): { linked: boolean };
  IS_LOGIN_SAVE_BLOCKED(data: { domain: string }): boolean;
  LOCK_VAULT(): BoolResponse;
  MIGRATE_VAULT_MANIFEST(): VaultManifestMigrationResult;
  OPEN_AUTOFILL_POPUP(data: { elementIdentifier: string; popupType?: string }): BoolResponse;
  OPEN_POPUP(): BoolResponse;
  OPEN_POPUP_CREATE_CREDENTIAL(data: { itemTitle?: string; currentUrl?: string; elementIdentifier?: string; left?: number; top?: number }): BoolResponse;
  OPEN_POPUP_WITH_ITEM(data: { itemId: string; manifestId: string }): BoolResponse;
  PASSKEY_POPUP_RESPONSE(data: any): { success: boolean };
  PERSIST_FORM_VALUES(data: any): void;
  POPUP_HEARTBEAT(): void;
  RECORD_ITEM_USAGE(data: { itemId: string; manifestId: string; action: ItemUsageAction }): { success: boolean };
  RESET_AUTO_LOCK_TIMER(): void;
  SAVE_LOGIN_CREDENTIAL(data: { serviceName: string; username: string; password: string; url: string; domain: string }): SaveLoginResponse;
  SEARCH_ITEMS_WITH_TOTP(data: { searchTerm: string }): ItemsResponse;
  SET_AUTO_LOCK_TIMEOUT(data: number): boolean;
  SET_CLIPBOARD_CLEAR_TIMEOUT(data: number): boolean;
  START_VAULT_SYNC(): BoolResponse;
  STORE_ENCRYPTED_VAULT(data: { transferId: string; index: number; chunk: string; commit?: VaultBlobStoreOptions }): { success: boolean; mutationSequence: number } | null;
  STORE_ACCOUNT_KEY(data: string): BoolResponse;
  STORE_UNLOCK_KEY_DERIVATION_PARAMS(data: UnlockKeyDerivationParams): BoolResponse;
  STORE_SAVE_PROMPT_STATE(data: SavePromptPersistedState): { success: boolean };
  TOGGLE_CONTEXT_MENU(data: any): BoolResponse;
  VAULT_SYNC_PHASE(data: { phase: VaultSyncPhase }): void;
  VAULT_UNLOCKED(): void;
  WEBAUTHN_CREATE(data: any): any;
  WEBAUTHN_GET(data: any): any;
  WEBAUTHN_GET_ASSERTION(data: { passkeyId: string; manifestId: string; origin: string; publicKey: WebAuthnPublicKeyGetPayload }): WebAuthnAssertionResponse;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const { sendMessage, onMessage } = defineExtensionMessaging<IExtensionMessageProtocol>();
