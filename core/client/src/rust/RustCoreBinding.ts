import type { AccountKeyHierarchy, CodecCanonicalized, CodecCanonicalizeInput, FaviconTarget, FilterCredentialsInput, FilterCredentialsOutput, KeyChainOpenResult, ParsedEmail, ReencryptedAccountKey, SrpEphemeral, SrpSession } from './RustCoreTypes';

/**
 * One running operation of the Rust vault sync engine.
 */
export interface IVaultSyncSession {
  /** The next command for the host, as JSON. */
  nextCommand(): Promise<string>;

  /** Take the raw bytes attached to the last command (the body of a binary `http` request), if any. */
  commandBytes(): Promise<Uint8Array | null>;

  /** Hand the host's response to the last command back, as JSON, with raw bytes for a `dbExport`. */
  resume(responseJson: string, bytes: Uint8Array | null): Promise<void>;

  /** Release the session. */
  free(): void;
}

/**
 * The Rust core as the client core sees it: one function per exported core operation, every call asynchronous so a host may route it over a native bridge.
 */
export interface IRustCore {
  init(): Promise<void>;

  extractDomain(url: string): Promise<string>;
  extractRootDomain(domain: string): Promise<string>;
  isRpIdAllowedForHost(rpId: string, host: string): Promise<boolean>;
  isRelatedOriginAllowed(callerOrigin: string, origins: string[]): Promise<boolean>;
  selectFaviconTarget(urls: string[]): Promise<FaviconTarget | null>;
  filterCredentials(input: FilterCredentialsInput): Promise<FilterCredentialsOutput>;

  generatePassword(settingsJson: string): Promise<string>;
  getDicewareLanguages(): Promise<string[]>;
  generateIdentity(requestJson: string): Promise<string>;
  generateIdentityUsername(inputJson: string): Promise<string>;
  generateIdentityEmailPrefix(inputJson: string): Promise<string>;
  generateRandomEmailPrefix(length: number): Promise<string>;
  getIdentityLanguages(): Promise<string[]>;
  getIdentityAgeRanges(): Promise<string[]>;

  parseEmailSource(source: Uint8Array): Promise<ParsedEmail>;
  decodeEmailSource(source: Uint8Array): Promise<Uint8Array>;
  extractEmailAttachment(source: Uint8Array, index: number, detachedBody?: Uint8Array): Promise<Uint8Array>;

  argon2DeriveKey(password: string, salt: string, encryptionSettings: string): Promise<Uint8Array>;
  deriveSrpPasswordHash(unlockKeyBase64: string, encryptionType: string): Promise<string>;
  openAccountKeyChain(storedKey: string, encryptedAccountKey: string, encryptedVek: string, encryptedAccountPrivateKey: string | null): Promise<KeyChainOpenResult>;
  createAccountKeyHierarchy(unlockKeyBase64: string, publicKeyJwk: string, privateKeyJwk: string): Promise<AccountKeyHierarchy>;
  reencryptAccountKey(encryptedAccountKey: string, oldUnlockKeyBase64: string, newUnlockKeyBase64: string): Promise<ReencryptedAccountKey | null>;

  srpGenerateSalt(): Promise<string>;
  srpDerivePrivateKey(salt: string, identity: string, passwordHash: string): Promise<string>;
  srpDeriveVerifier(privateKey: string): Promise<string>;
  srpGenerateEphemeral(): Promise<SrpEphemeral>;
  srpDeriveSession(clientSecret: string, serverPublic: string, salt: string, identity: string, privateKey: string): Promise<SrpSession>;
  srpVerifySession(clientPublic: string, clientProof: string, sessionKey: string, serverProof: string): Promise<boolean>;

  getSyncableTableNames(): Promise<string[]>;

  vaultCodecCanonicalizeFromSqlite(input: CodecCanonicalizeInput): Promise<CodecCanonicalized>;
  vaultCodecGenerateManifestSalt(): Promise<string>;
  vaultCodecLogoIdFor(manifestId: string, kind: string, source: string): Promise<string>;
  vaultCodecLogoContentHash(bytes: Uint8Array): Promise<string>;
  vaultCodecPackPayload(payloadJson: string): Promise<Uint8Array>;
  vaultCodecUnpackPayload(plainBytes: Uint8Array): Promise<string>;

  createVaultSyncSession(requestJson: string): Promise<IVaultSyncSession>;
}
