/*
 * The Rust core bound to its WebAssembly build, for hosts with a WebAssembly runtime.
 */
/* eslint-disable jsdoc/require-jsdoc */
import initWasm, * as core from '../../wasm/aliasvault_core.js';

import type { IRustCore, IVaultSyncSession } from './RustCoreBinding';
import type { CodecCanonicalized, CodecCanonicalizeInput, FaviconTarget, FilterCredentialsInput, FilterCredentialsOutput, ParsedEmail, SrpEphemeral, SrpSession } from './RustCoreTypes';

/**
 * Where the host gets the `.wasm` binary from: bytes, or a fetch response for streaming instantiation.
 */
export type WasmLoader = () => Promise<BufferSource | Response>;

/**
 * Bind the Rust core to its WebAssembly build.
 * @param loadWasm - provides the WebAssembly binary
 */
export function createWasmRustCore(loadWasm: WasmLoader): IRustCore {
  let initPromise: Promise<void> | null = null;

  /**
   * Instantiate the module.
   */
  const init = (): Promise<void> => {
    if (!initPromise) {
      initPromise = (async (): Promise<void> => {
        await initWasm({ module_or_path: await loadWasm() });
      })().catch((error: unknown) => {
        initPromise = null;
        throw error;
      });
    }
    return initPromise;
  };

  /**
   * Run a Rust core function after initialization.
   * @param call - the synchronous core call
   */
  const ready = async <T>(call: () => T): Promise<T> => {
    await init();
    return call();
  };

  return {
    init,

    extractDomain: (url): Promise<string> => ready(() => core.extractDomain(url)),
    extractRootDomain: (domain): Promise<string> => ready(() => core.extractRootDomain(domain)),
    selectFaviconTarget: (urls): Promise<FaviconTarget | null> => ready(() => (core.selectFaviconTarget(urls) ?? null) as FaviconTarget | null),
    filterCredentials: (input: FilterCredentialsInput): Promise<FilterCredentialsOutput> => ready(() => core.filterCredentials(input) as FilterCredentialsOutput),

    generatePassword: (settingsJson): Promise<string> => ready(() => core.generatePassword(settingsJson)),
    getDicewareLanguages: (): Promise<string[]> => ready(() => core.getDicewareLanguages()),
    generateIdentity: (requestJson): Promise<string> => ready(() => core.generateIdentity(requestJson)),
    generateIdentityUsername: (inputJson): Promise<string> => ready(() => core.generateIdentityUsername(inputJson)),
    generateIdentityEmailPrefix: (inputJson): Promise<string> => ready(() => core.generateIdentityEmailPrefix(inputJson)),
    generateRandomEmailPrefix: (length): Promise<string> => ready(() => core.generateRandomEmailPrefix(length)),
    getIdentityLanguages: (): Promise<string[]> => ready(() => core.getIdentityLanguages()),
    getIdentityAgeRanges: (): Promise<string[]> => ready(() => core.getIdentityAgeRanges()),

    parseEmailSource: (source): Promise<ParsedEmail> => ready(() => core.parseEmailSource(source) as ParsedEmail),
    decodeEmailSource: (source): Promise<Uint8Array> => ready(() => core.decodeEmailSource(source)),
    extractEmailAttachment: (source, index, detachedBody): Promise<Uint8Array> => ready(() => core.extractEmailAttachment(source, index, detachedBody)),

    argon2DeriveKey: (password, salt, encryptionSettings): Promise<Uint8Array> => ready(() => core.argon2DeriveKey(password, salt, encryptionSettings)),

    srpGenerateSalt: (): Promise<string> => ready(() => core.srpGenerateSalt()),
    srpDerivePrivateKey: (salt, identity, passwordHash): Promise<string> => ready(() => core.srpDerivePrivateKey(salt, identity, passwordHash)),
    srpDeriveVerifier: (privateKey): Promise<string> => ready(() => core.srpDeriveVerifier(privateKey)),
    srpGenerateEphemeral: (): Promise<SrpEphemeral> => ready(() => core.srpGenerateEphemeral() as SrpEphemeral),
    srpDeriveSession: (clientSecret, serverPublic, salt, identity, privateKey): Promise<SrpSession> =>
      ready(() => core.srpDeriveSession(clientSecret, serverPublic, salt, identity, privateKey) as SrpSession),

    getSyncableTableNames: (): Promise<string[]> => ready(() => core.getSyncableTableNames()),

    vaultCodecCanonicalizeFromSqlite: (input: CodecCanonicalizeInput): Promise<CodecCanonicalized> => ready(() => core.vaultCodecCanonicalizeFromSqlite(input) as CodecCanonicalized),
    vaultCodecGenerateManifestSalt: (): Promise<string> => ready(() => core.vaultCodecGenerateManifestSalt()),
    vaultCodecLogoIdFor: (manifestId, kind, source): Promise<string> => ready(() => core.vaultCodecLogoIdFor(manifestId, kind, source)),
    vaultCodecLogoContentHash: (bytes): Promise<string> => ready(() => core.vaultCodecLogoContentHash(bytes)),
    vaultCodecPackPayload: (payloadJson): Promise<Uint8Array> => ready(() => core.vaultCodecPackPayload(payloadJson)),
    vaultCodecUnpackPayload: (plainBytes): Promise<string> => ready(() => core.vaultCodecUnpackPayload(plainBytes)),

    createVaultSyncSession: (requestJson): Promise<IVaultSyncSession> => ready((): IVaultSyncSession => {
      const session = new core.VaultSyncSession(requestJson);
      return {
        nextCommand: async (): Promise<string> => session.nextCommand(),
        resume: async (responseJson: string): Promise<void> => session.resume(responseJson),
        free: (): void => session.free(),
      };
    }),
  };
}
