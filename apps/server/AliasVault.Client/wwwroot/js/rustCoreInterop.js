// Rust Core WASM Interop for Blazor
// This module provides JavaScript functions that Blazor can call via JSInterop
// to access the Rust WASM merge and credential matching functionality.

let wasmModule = null;
let isInitialized = false;
let initPromise = null;

// Get cache buster from global variable set by index.html
const cacheBuster = window.__CACHE_BUSTER__ || 'dev';
const wasmUrl = `/wasm/aliasvault_core_bg.wasm?v=${cacheBuster}`;
const wasmJsUrl = `/wasm/aliasvault_core.js?v=${cacheBuster}`;

/**
 * Fetch with retry for more robust WASM loading.
 * @param {string} url - URL to fetch.
 * @param {number} maxRetries - Maximum retry attempts.
 * @param {number} baseDelay - Base delay in ms for exponential backoff.
 * @returns {Promise<Response>} The fetch response.
 */
async function fetchWithRetry(url, maxRetries = 3, baseDelay = 100) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url);
            if (response.ok) {
                return response;
            }
            lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
        } catch (error) {
            lastError = error;
        }

        if (i < maxRetries - 1) {
            const delay = baseDelay * Math.pow(2, i);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}

/**
 * Initialize the Rust WASM module.
 * @returns {Promise<boolean>} True if initialization succeeded.
 */
async function initRustCore() {
    if (isInitialized) {
        return true;
    }

    // If we have a pending promise, wait for it
    if (initPromise) {
        return initPromise;
    }

    initPromise = (async () => {
        try {
            // Fetch the WASM binary with retry (uses same URL as preload hint for cache hit)
            const wasmResponse = await fetchWithRetry(wasmUrl);
            const wasmBytes = await wasmResponse.arrayBuffer();

            // Dynamically import the ES module (uses same URL as modulepreload hint)
            const module = await import(wasmJsUrl);

            // Initialize the WASM module with the binary bytes
            await module.default(wasmBytes);

            // Call init to set up panic hook
            if (typeof module.init === 'function') {
                module.init();
            }

            wasmModule = module;
            isInitialized = true;
            console.log('[RustCore] WASM module initialized successfully');
            return true;
        } catch (error) {
            console.error('[RustCore] Failed to initialize WASM module:', error);
            isInitialized = false;
            initPromise = null; // Allow retry on failure
            return false;
        }
    })();

    return initPromise;
}

/**
 * Check if the Rust WASM module is available.
 * @returns {Promise<boolean>} True if available.
 */
window.rustCoreIsAvailable = async function() {
    return await initRustCore();
};

/**
 * Merge two vaults using LWW strategy.
 * @param {string} inputJson - JSON string containing MergeInput.
 * @returns {Promise<string>} JSON string containing MergeOutput.
 */
window.rustCoreMergeVaults = async function(inputJson) {
    if (!await initRustCore()) {
        return JSON.stringify({
            success: false,
            error: 'Rust WASM module not available',
            statements: [],
            stats: {}
        });
    }

    try {
        const result = wasmModule.mergeVaultsJson(inputJson);
        return result;
    } catch (error) {
        console.error('[RustCore] Merge failed:', error);
        return JSON.stringify({
            success: false,
            error: error.toString(),
            statements: [],
            stats: {}
        });
    }
};

/**
 * Filter credentials for autofill.
 * @param {string} inputJson - JSON string containing CredentialMatcherInput.
 * @returns {Promise<string>} JSON string containing CredentialMatcherOutput.
 */
window.rustCoreFilterCredentials = async function(inputJson) {
    if (!await initRustCore()) {
        return JSON.stringify({
            matches: [],
            error: 'Rust WASM module not available'
        });
    }

    try {
        const result = wasmModule.filterCredentialsJson(inputJson);
        return result;
    } catch (error) {
        console.error('[RustCore] Filter credentials failed:', error);
        return JSON.stringify({
            matches: [],
            error: error.toString()
        });
    }
};

/**
 * Get the list of syncable table names.
 * @returns {Promise<string[]>} Array of table names.
 */
window.rustCoreGetSyncableTableNames = async function() {
    if (!await initRustCore()) {
        // Return default list if WASM not available
        return [
            'Items', 'FieldValues', 'Folders', 'Tags', 'ItemTags',
            'Attachments', 'TotpCodes', 'Passkeys', 'FieldDefinitions',
            'FieldHistories', 'Logos'
        ];
    }

    try {
        return wasmModule.getSyncableTableNames();
    } catch (error) {
        console.error('[RustCore] Get syncable table names failed:', error);
        return [];
    }
};

/**
 * Get the per-table SELECT queries used to build prune input.
 * Blob columns are reduced to a 1-byte presence marker.
 * @returns {Promise<Array<{name: string, query: string}>>} Array of table queries.
 */
window.rustCoreGetPruneTableQueries = async function() {
    if (!await initRustCore()) {
        return [];
    }

    try {
        return wasmModule.getPruneTableQueries();
    } catch (error) {
        console.error('[RustCore] Get prune table queries failed:', error);
        return [];
    }
};

/**
 * Extract domain from URL.
 * @param {string} url - The URL to extract domain from.
 * @returns {Promise<string>} The extracted domain.
 */
window.rustCoreExtractDomain = async function(url) {
    if (!await initRustCore()) {
        return '';
    }

    try {
        return wasmModule.extractDomain(url);
    } catch (error) {
        console.error('[RustCore] Extract domain failed:', error);
        return '';
    }
};

/**
 * The Logos.Id to use for a source domain inside a given manifest scope.
 *
 * Logo identity is derived, not random: two clients that fetch the same favicon independently produce
 * the same row and merge by LWW, instead of two rows that collide on UNIQUE(ManifestId, Source).
 * The same domain in two different manifests deliberately yields two different ids, so a shared
 * manifest's icon and the user's own icon for that domain never overwrite each other.
 * @param {string|null} manifestId - Owning manifest, or null for the user's own vault.
 * @param {string} source - The normalized source domain (e.g. 'github.com').
 * @returns {Promise<string>} The logo id, or '' when the WASM module is unavailable.
 */
window.rustCoreVaultCodecLogoIdForSource = async function(manifestId, source) {
    if (!await initRustCore()) {
        return '';
    }

    try {
        return wasmModule.vaultCodecLogoIdForSource(manifestId ?? undefined, source);
    } catch (error) {
        console.error('[RustCore] Logo id derivation failed:', error);
        return '';
    }
};

/**
 * Extract root domain from a domain string.
 * @param {string} domain - The domain to extract root from.
 * @returns {Promise<string>} The root domain.
 */
window.rustCoreExtractRootDomain = async function(domain) {
    if (!await initRustCore()) {
        return '';
    }

    try {
        return wasmModule.extractRootDomain(domain);
    } catch (error) {
        console.error('[RustCore] Extract root domain failed:', error);
        return '';
    }
};

/**
 * Pick which of an item's URLs a favicon should be fetched from, and the Logos.Source key
 * it is stored under.
 * @param {string[]} urls - The item's URLs, in the order the item lists them.
 * @returns {Promise<{url: string, source: string} | null>} The target, or null when no URL qualifies.
 */
window.rustCoreSelectFaviconTarget = async function(urls) {
    if (!await initRustCore()) {
        return null;
    }

    try {
        return wasmModule.selectFaviconTarget(urls) ?? null;
    } catch (error) {
        console.error('[RustCore] Select favicon target failed:', error);
        return null;
    }
};

/**
 * Generate a password or passphrase from JSON-serialized PasswordSettings.
 * The "Type" field selects the generator ("basic" or "diceware").
 * @param {string} settingsJson - JSON string containing PasswordSettings.
 * @returns {Promise<string>} The generated password/passphrase.
 */
window.rustCoreGeneratePassword = async function(settingsJson) {
    if (!await initRustCore()) {
        throw new Error('Rust WASM module not available');
    }

    try {
        return wasmModule.generatePassword(settingsJson);
    } catch (error) {
        console.error('[RustCore] Generate password failed:', error);
        throw error;
    }
};

/**
 * Get the list of bundled Diceware language codes (first is the default, English).
 * @returns {Promise<string[]>} Array of language codes.
 */
window.rustCoreGetDicewareLanguages = async function() {
    if (!await initRustCore()) {
        return ['en'];
    }

    try {
        const languages = wasmModule.getDicewareLanguages();
        return (languages && languages.length > 0) ? languages : ['en'];
    } catch (error) {
        console.error('[RustCore] Get diceware languages failed:', error);
        return ['en'];
    }
};

/**
 * Prune expired items from trash.
 * Items that have been in trash (DeletedAt set) for longer than the retention period
 * are permanently deleted (IsDeleted = true).
 * @param {string} inputJson - JSON string containing PruneInput.
 * @returns {Promise<string>} JSON string containing PruneOutput.
 */
window.rustCorePruneVault = async function(inputJson) {
    if (!await initRustCore()) {
        return JSON.stringify({
            success: false,
            error: 'Rust WASM module not available',
            statements: [],
            stats: {}
        });
    }

    try {
        const result = wasmModule.pruneVaultJson(inputJson);
        return result;
    } catch (error) {
        console.error('[RustCore] Prune failed:', error);
        return JSON.stringify({
            success: false,
            error: error.toString(),
            statements: [],
            stats: {}
        });
    }
};

// ============================================================================
// Identity Generator Functions
// ============================================================================

/**
 * Generate a random identity from a JSON-serialized request.
 * @param {string} requestJson - JSON string with language, gender and ageRange.
 * @returns {Promise<object>} The generated identity object (camelCase fields).
 */
window.rustCoreGenerateIdentity = async function(requestJson) {
    if (!await initRustCore()) {
        throw new Error('Rust WASM module not available');
    }

    try {
        return JSON.parse(wasmModule.generateIdentity(requestJson));
    } catch (error) {
        console.error('[RustCore] Generate identity failed:', error);
        throw error;
    }
};

/**
 * Generate a username from an identity's name fields.
 * @param {object} identity - Object with firstName, lastName and birthDate.
 * @returns {Promise<string>} The generated username.
 */
window.rustCoreGenerateIdentityUsername = async function(identity) {
    if (!await initRustCore()) {
        throw new Error('Rust WASM module not available');
    }

    try {
        return wasmModule.generateIdentityUsername(JSON.stringify(identity));
    } catch (error) {
        console.error('[RustCore] Generate identity username failed:', error);
        throw error;
    }
};

/**
 * Generate an email prefix from an identity's name fields.
 * @param {object} identity - Object with firstName, lastName and birthDate.
 * @returns {Promise<string>} The generated email prefix.
 */
window.rustCoreGenerateIdentityEmailPrefix = async function(identity) {
    if (!await initRustCore()) {
        throw new Error('Rust WASM module not available');
    }

    try {
        return wasmModule.generateIdentityEmailPrefix(JSON.stringify(identity));
    } catch (error) {
        console.error('[RustCore] Generate identity email prefix failed:', error);
        throw error;
    }
};

/**
 * Generate a random alphanumeric email prefix that is not based on any identity.
 * @param {number} length - The desired prefix length.
 * @returns {Promise<string>} The generated prefix.
 */
window.rustCoreGenerateRandomEmailPrefix = async function(length) {
    if (!await initRustCore()) {
        throw new Error('Rust WASM module not available');
    }

    try {
        return wasmModule.generateRandomEmailPrefix(length);
    } catch (error) {
        console.error('[RustCore] Generate random email prefix failed:', error);
        throw error;
    }
};

/**
 * Get the list of bundled identity dictionary language codes.
 * @returns {Promise<string[]>} Array of language codes.
 */
window.rustCoreGetIdentityLanguages = async function() {
    if (!await initRustCore()) {
        return ['en'];
    }

    try {
        const languages = wasmModule.getIdentityLanguages();
        return (languages && languages.length > 0) ? languages : ['en'];
    } catch (error) {
        console.error('[RustCore] Get identity languages failed:', error);
        return ['en'];
    }
};

/**
 * Get the list of identity age range option values ("random" plus 5-year ranges).
 * @returns {Promise<string[]>} Array of age range values.
 */
window.rustCoreGetIdentityAgeRanges = async function() {
    if (!await initRustCore()) {
        return [];
    }

    try {
        return wasmModule.getIdentityAgeRanges();
    } catch (error) {
        console.error('[RustCore] Get identity age ranges failed:', error);
        return [];
    }
};

// ============================================================================
// Argon2id Key Derivation Functions
// ============================================================================

/**
 * Derive a key from a password using Argon2id.
 *
 * The salt is hashed as the characters of the string the server sent, not as the
 * bytes it decodes to, which is what every AliasVault client has always done.
 * @param {string} password - The password, hashed as its UTF-8 bytes.
 * @param {string} salt - The salt, hashed as its UTF-8 bytes.
 * @param {string} encryptionSettings - The EncryptionSettings JSON, or an empty string for the defaults.
 * @returns {Promise<Uint8Array>} The derived key as 32 bytes.
 */
window.rustCoreArgon2DeriveKey = async function(password, salt, encryptionSettings) {
    if (!await initRustCore()) {
        throw new Error('Rust WASM module not available');
    }

    try {
        return wasmModule.argon2DeriveKey(password, salt, encryptionSettings);
    } catch (error) {
        console.error('[RustCore] Argon2 derive key failed:', error);
        throw error;
    }
};

// ============================================================================
// SRP (Secure Remote Password) Functions
// ============================================================================

/**
 * Generate a random salt for SRP registration.
 * @returns {Promise<string>} 64-character uppercase hex string (32 bytes).
 */
window.rustCoreSrpGenerateSalt = async function() {
    if (!await initRustCore()) {
        throw new Error('Rust WASM module not available');
    }

    try {
        return wasmModule.srpGenerateSalt();
    } catch (error) {
        console.error('[RustCore] SRP generate salt failed:', error);
        throw error;
    }
};

/**
 * Derive a private key from salt, identity, and password hash.
 * @param {string} salt - The salt (hex string).
 * @param {string} identity - The SRP identity (username or GUID).
 * @param {string} passwordHash - The password hash (hex string).
 * @returns {Promise<string>} 64-character uppercase hex string (32 bytes).
 */
window.rustCoreSrpDerivePrivateKey = async function(salt, identity, passwordHash) {
    if (!await initRustCore()) {
        throw new Error('Rust WASM module not available');
    }

    try {
        return wasmModule.srpDerivePrivateKey(salt, identity, passwordHash);
    } catch (error) {
        console.error('[RustCore] SRP derive private key failed:', error);
        throw error;
    }
};

/**
 * Derive a verifier from a private key.
 * @param {string} privateKey - The private key (hex string).
 * @returns {Promise<string>} 512-character uppercase hex string (256 bytes).
 */
window.rustCoreSrpDeriveVerifier = async function(privateKey) {
    if (!await initRustCore()) {
        throw new Error('Rust WASM module not available');
    }

    try {
        return wasmModule.srpDeriveVerifier(privateKey);
    } catch (error) {
        console.error('[RustCore] SRP derive verifier failed:', error);
        throw error;
    }
};

/**
 * Generate client ephemeral keypair.
 * @returns {Promise<{public: string, secret: string}>} Object with public and secret hex strings.
 */
window.rustCoreSrpGenerateEphemeral = async function() {
    if (!await initRustCore()) {
        throw new Error('Rust WASM module not available');
    }

    try {
        const result = wasmModule.srpGenerateEphemeral();
        return {
            public: result.public,
            secret: result.secret
        };
    } catch (error) {
        console.error('[RustCore] SRP generate ephemeral failed:', error);
        throw error;
    }
};

/**
 * Derive client session from ephemeral values.
 * @param {string} clientSecret - Client ephemeral secret (hex string).
 * @param {string} serverPublic - Server ephemeral public (hex string).
 * @param {string} salt - The salt (hex string).
 * @param {string} identity - The SRP identity.
 * @param {string} privateKey - The private key (hex string).
 * @returns {Promise<{key: string, proof: string}>} Object with session key and proof hex strings.
 */
window.rustCoreSrpDeriveSession = async function(clientSecret, serverPublic, salt, identity, privateKey) {
    if (!await initRustCore()) {
        throw new Error('Rust WASM module not available');
    }

    try {
        const result = wasmModule.srpDeriveSession(clientSecret, serverPublic, salt, identity, privateKey);
        return {
            key: result.key,
            proof: result.proof
        };
    } catch (error) {
        console.error('[RustCore] SRP derive session failed:', error);
        throw error;
    }
};

/**
 * Verify the server's session proof on the client side.
 * @param {string} clientPublic - Client public ephemeral (A) as hex string.
 * @param {string} clientProof - Client proof (M1) as hex string.
 * @param {string} sessionKey - Session key (K) as hex string.
 * @param {string} serverProof - Server proof (M2) to verify as hex string.
 * @returns {Promise<boolean>} True if verification succeeds.
 */
window.rustCoreSrpVerifySession = async function(clientPublic, clientProof, sessionKey, serverProof) {
    if (!await initRustCore()) {
        throw new Error('Rust WASM module not available');
    }

    try {
        return wasmModule.srpVerifySession(clientPublic, clientProof, sessionKey, serverProof);
    } catch (error) {
        console.error('[RustCore] SRP verify session failed:', error);
        throw error;
    }
};

// ============================================================================
// Vault codec (manifest-v1 storage format)
// ============================================================================

/**
 * Resolve the initialized WASM module or throw.
 * @returns {Promise<object>} The WASM module.
 */
async function requireRustCore() {
    if (!await initRustCore()) {
        throw new Error('Rust WASM module not available');
    }
    return wasmModule;
}

/**
 * Canonicalize normalized vault tables into manifests + data buckets + blob maps.
 * @param {string} inputJson - JSON string containing CanonicalizeInput.
 * @returns {Promise<string>} JSON string containing CanonicalizedVault.
 */
window.rustCoreVaultCodecCanonicalizeFromSqlite = async function(inputJson) {
    const core = await requireRustCore();
    return JSON.stringify(core.vaultCodecCanonicalizeFromSqlite(JSON.parse(inputJson)));
};

/**
 * Materialize manifests + data buckets into the table set the platform inserts into a fresh SQLite DB.
 * @param {string} inputJson - JSON string containing MaterializeInput ({ manifests, dataBuckets, schemaColumns }).
 * @returns {Promise<string>} JSON string containing MaterializedTables ({ tables, overflow }).
 */
window.rustCoreVaultCodecMaterializeAsSqlite = async function(inputJson) {
    const core = await requireRustCore();
    return JSON.stringify(core.vaultCodecMaterializeAsSqlite(JSON.parse(inputJson)));
};

/**
 * Merge the local canonical vault onto the server canonical vault (the base), one manifest at a time.
 * @param {string} inputJson - JSON string containing the canonical merge input.
 * @returns {Promise<string>} JSON string containing the canonical merge output.
 */
window.rustCoreMergeCanonical = async function(inputJson) {
    const core = await requireRustCore();
    return JSON.stringify(core.mergeCanonical(JSON.parse(inputJson)));
};

/**
 * Extract the encryption-key row whose PublicKey matches from a decrypted manifest.
 * @param {string} manifestJson - JSON string of the decrypted manifest.
 * @param {string} publicKey - The public key to look up.
 * @returns {Promise<string|null>} JSON string of the key row, or null when the manifest holds no such key.
 */
window.rustCoreVaultCodecExtractEncryptionKeyForPublicKey = async function(manifestJson, publicKey) {
    const core = await requireRustCore();
    const row = core.vaultCodecExtractEncryptionKeyForPublicKey(JSON.parse(manifestJson), publicKey);
    return row ? JSON.stringify(row) : null;
};

/**
 * Build a bucket category's data buckets from its tables, one per manifest.
 * @param {string} inputJson - JSON string containing { category, manifestIds, tables }.
 * @returns {Promise<string>} JSON string containing the data bucket list.
 */
window.rustCoreVaultCodecExtractBuckets = async function(inputJson) {
    const core = await requireRustCore();
    return JSON.stringify(core.vaultCodecExtractBuckets(JSON.parse(inputJson)));
};

/**
 * The name of the client-local SQLite table that carries the codec overflow inside the vault DB.
 * @returns {Promise<string>} The table name.
 */
window.rustCoreVaultCodecOverflowTable = async function() {
    const core = await requireRustCore();
    return core.vaultCodecOverflowTable();
};

/**
 * The bucket layout: every category and the tables it owns.
 * @returns {Promise<string>} JSON string containing the layout entries.
 */
window.rustCoreVaultCodecBucketLayout = async function() {
    const core = await requireRustCore();
    return JSON.stringify(core.vaultCodecBucketLayout());
};

/**
 * The Logos.Id to use for the logo (kind, source) inside the given manifest.
 * @param {string} manifestId - Owning manifest id.
 * @param {string} kind - Logo kind (favicon, builtin, custom).
 * @param {string} source - Logo source (domain, icon key or content hash).
 * @returns {Promise<string>} The derived logo id.
 */
window.rustCoreVaultCodecLogoIdFor = async function(manifestId, kind, source) {
    const core = await requireRustCore();
    return core.vaultCodecLogoIdFor(manifestId, kind, source);
};

/**
 * The SHA-256 (lowercase hex) of an uploaded logo's bytes, the Source a custom logo row is stored under.
 * @param {Uint8Array} bytes - The image bytes.
 * @returns {Promise<string>} The content hash.
 */
window.rustCoreVaultCodecLogoContentHash = async function(bytes) {
    const core = await requireRustCore();
    return core.vaultCodecLogoContentHash(bytes);
};

/**
 * Generate a fresh 32-byte per-manifest blob-hashing salt (lowercase hex).
 * @returns {Promise<string>} The salt.
 */
window.rustCoreVaultCodecGenerateManifestSalt = async function() {
    const core = await requireRustCore();
    return core.vaultCodecGenerateManifestSalt();
};

/**
 * Pack a payload JSON string into gzip(envelope{contentHash, payload}). The caller encrypts the result.
 * @param {string} payloadJson - The manifest or data bucket JSON.
 * @returns {Promise<Uint8Array>} The packed bytes.
 */
window.rustCoreVaultCodecPackPayload = async function(payloadJson) {
    const core = await requireRustCore();
    return core.vaultCodecPackPayload(payloadJson);
};

/**
 * Unpack a decrypted payload: gunzip, verify the embedded content hash, return the payload JSON string.
 * @param {Uint8Array} plainBytes - The decrypted packed bytes.
 * @returns {Promise<string>} The payload JSON.
 */
window.rustCoreVaultCodecUnpackPayload = async function(plainBytes) {
    const core = await requireRustCore();
    return core.vaultCodecUnpackPayload(plainBytes);
};

/**
 * Structurally validate a manifest before upload.
 * @param {string} manifestJson - JSON string of the manifest.
 * @returns {Promise<string>} JSON string containing { ok, failedRules, message }.
 */
window.rustCoreVaultCodecValidateManifest = async function(manifestJson) {
    const core = await requireRustCore();
    return JSON.stringify(core.vaultCodecValidateManifest(JSON.parse(manifestJson)));
};

/**
 * Validate a data bucket before upload.
 * @param {string} bucketJson - JSON string of the data bucket.
 * @returns {Promise<string>} JSON string containing { ok, failedRules, message }.
 */
window.rustCoreVaultCodecValidateDataBucket = async function(bucketJson) {
    const core = await requireRustCore();
    return JSON.stringify(core.vaultCodecValidateDataBucket(JSON.parse(bucketJson)));
};

/**
 * SHA-256 (lowercase hex) of a base64 ciphertext string.
 * @param {string} base64Ciphertext - The ciphertext as served by / sent to the server.
 * @returns {Promise<string>} The hash.
 */
window.rustCoreVaultCodecComputeCiphertextHash = async function(base64Ciphertext) {
    const core = await requireRustCore();
    return core.vaultCodecComputeCiphertextHash(base64Ciphertext);
};

/**
 * Content fingerprint of a manifest / data bucket payload for change detection (canonical JSON minus canonicalizedAt).
 * @param {string} payloadJson - The payload JSON.
 * @returns {Promise<string>} The fingerprint.
 */
window.rustCoreVaultCodecComputeContentFingerprint = async function(payloadJson) {
    const core = await requireRustCore();
    return core.vaultCodecComputeContentFingerprint(payloadJson);
};

/**
 * Work out which manifests the next push writes, personal manifest first.
 * @param {string} inputJson - JSON string containing the write-set request.
 * @returns {Promise<string>} JSON string containing { records, skipped }.
 */
window.rustCoreVaultSharingResolveManifestWriteSet = async function(inputJson) {
    const core = await requireRustCore();
    return JSON.stringify(core.vaultSharingResolveManifestWriteSet(JSON.parse(inputJson)));
};

/**
 * Split what the local vault holds by what this account can still open.
 * @param {string} inputJson - JSON string containing the access partition request.
 * @returns {Promise<string>} JSON string containing { unwritable, lost }.
 */
window.rustCoreVaultSharingPartitionManifestAccess = async function(inputJson) {
    const core = await requireRustCore();
    return JSON.stringify(core.vaultSharingPartitionManifestAccess(JSON.parse(inputJson)));
};

// ============================================================================
// Email parser
// ============================================================================

/**
 * Parse a raw RFC 822 email source into its html/plain bodies and attachment metadata.
 * @param {Uint8Array} source - The decrypted message source.
 * @returns {Promise<string>} JSON string containing { htmlBody, textBody, attachments }.
 */
window.rustCoreParseEmailSource = async function(source) {
    const core = await requireRustCore();
    return JSON.stringify(core.parseEmailSource(source));
};

/**
 * Turn a stored email source into the raw RFC 822 message bytes for the source view.
 * @param {Uint8Array} source - The decrypted message source.
 * @returns {Promise<Uint8Array>} The raw message bytes.
 */
window.rustCoreDecodeEmailSource = async function(source) {
    const core = await requireRustCore();
    return core.decodeEmailSource(source);
};

/**
 * Extract the decoded bytes of one attachment, identified by its index in the parsed attachment list.
 * @param {Uint8Array} source - The decrypted message source.
 * @param {number} index - Attachment index.
 * @param {Uint8Array|null} detachedBody - The detached body fetched from the server, when the attachment is detached.
 * @returns {Promise<Uint8Array>} The attachment bytes.
 */
window.rustCoreExtractEmailAttachment = async function(source, index, detachedBody) {
    const core = await requireRustCore();
    return core.extractEmailAttachment(source, index, detachedBody ?? undefined);
};

/**
 * Decrypt a manifest or data bucket ciphertext (AES-GCM, base64(IV | ciphertext | tag)) and unpack it via the codec.
 * @param {string} base64Ciphertext - The ciphertext as served by the server.
 * @param {string} base64Key - The symmetric key.
 * @returns {Promise<string>} The payload JSON.
 */
window.rustCoreVaultCodecDecryptAndUnpackPayload = async function(base64Ciphertext, base64Key) {
    const core = await requireRustCore();
    const plainBytes = await window.cryptoInterop.decryptBytes(base64Ciphertext, base64Key);
    return core.vaultCodecUnpackPayload(plainBytes);
};

/**
 * Pack a manifest or data bucket payload via the codec and encrypt it (AES-GCM, base64(IV | ciphertext | tag)).
 * @param {string} payloadJson - The payload JSON.
 * @param {string} base64Key - The symmetric key.
 * @returns {Promise<string>} The base64 ciphertext.
 */
window.rustCoreVaultCodecPackAndEncryptPayload = async function(payloadJson, base64Key) {
    const core = await requireRustCore();
    const packed = core.vaultCodecPackPayload(payloadJson);
    const encrypted = await window.cryptoInterop.encryptBytes(packed, base64ToBytes(base64Key));
    return bytesToBase64(encrypted);
};
