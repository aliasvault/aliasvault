import type { CodecBucketLayoutEntry, CodecCanonicalized, CodecCanonicalizeInput, CodecCanonicalMergeInput, CodecCanonicalMergeOutput, CodecDataBucket, CodecExtractBucketsInput, CodecManifest, CodecMaterialized, CodecMaterializeInput, CodecValidation, FaviconTarget, FilterCredentialsInput, FilterCredentialsOutput, ParsedEmail, PruneTableQuery, PruneVaultInput, PruneVaultOutput, SharingAccessPartition, SharingPartitionAccessInput, SharingResolveWriteSetInput, SharingWriteSet, SrpEphemeral, SrpSession } from './RustCoreTypes';

/**
 * One running operation of the Rust vault sync engine.
 */
export interface IVaultSyncSession {
  /** The next command for the host, as JSON. */
  nextCommand(): Promise<string>;

  /** Hand the host's response to the last command back, as JSON. */
  resume(responseJson: string): Promise<void>;

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

  srpGenerateSalt(): Promise<string>;
  srpDerivePrivateKey(salt: string, identity: string, passwordHash: string): Promise<string>;
  srpDeriveVerifier(privateKey: string): Promise<string>;
  srpGenerateEphemeral(): Promise<SrpEphemeral>;
  srpDeriveSession(clientSecret: string, serverPublic: string, salt: string, identity: string, privateKey: string): Promise<SrpSession>;

  getSyncableTableNames(): Promise<string[]>;
  mergeCanonical(input: CodecCanonicalMergeInput): Promise<CodecCanonicalMergeOutput>;
  pruneVault(input: PruneVaultInput): Promise<PruneVaultOutput>;
  getPruneTableQueries(): Promise<PruneTableQuery[]>;

  vaultCodecCanonicalizeFromSqlite(input: CodecCanonicalizeInput): Promise<CodecCanonicalized>;
  vaultCodecMaterializeAsSqlite(input: CodecMaterializeInput): Promise<CodecMaterialized>;
  vaultCodecExtractBuckets(input: CodecExtractBucketsInput): Promise<CodecDataBucket[]>;
  vaultCodecBucketLayout(): Promise<CodecBucketLayoutEntry[]>;
  vaultCodecOverflowTable(): Promise<string>;
  vaultCodecGenerateManifestSalt(): Promise<string>;
  vaultCodecLogoIdForSource(manifestId: string, source: string): Promise<string>;
  vaultCodecLogoIdFor(manifestId: string, kind: string, source: string): Promise<string>;
  vaultCodecLogoContentHash(bytes: Uint8Array): Promise<string>;
  vaultCodecPackPayload(payloadJson: string): Promise<Uint8Array>;
  vaultCodecUnpackPayload(plainBytes: Uint8Array): Promise<string>;
  vaultCodecValidateManifest(manifest: CodecManifest): Promise<CodecValidation>;
  vaultCodecValidateDataBucket(bucket: CodecDataBucket): Promise<CodecValidation>;
  vaultCodecComputeCiphertextHash(base64Ciphertext: string): Promise<string>;
  vaultCodecComputeContentFingerprint(payloadJson: string): Promise<string>;
  vaultCodecExtractEncryptionKeyForPublicKey(manifest: CodecManifest, publicKey: string): Promise<Record<string, unknown> | null>;

  vaultSharingResolveManifestWriteSet(input: SharingResolveWriteSetInput): Promise<SharingWriteSet>;
  vaultSharingPartitionManifestAccess(input: SharingPartitionAccessInput): Promise<SharingAccessPartition>;

  createVaultSyncSession(requestJson: string): Promise<IVaultSyncSession>;
}
