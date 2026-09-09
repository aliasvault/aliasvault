//-----------------------------------------------------------------------
// <copyright file="VaultSyncService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.VaultSync;

using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using AliasVault.Client.Services.Auth;
using AliasVault.Client.Services.Database;
using AliasVault.Client.Services.JsInterop;
using AliasVault.Client.Services.JsInterop.RustCore;
using AliasVault.Client.Services.VaultSync.Exceptions;
using AliasVault.Client.Services.VaultSync.Models;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi.V2.Vault;
using Microsoft.Data.Sqlite;
using Microsoft.JSInterop;

/// <summary>
/// Syncs the vault with the server.
/// </summary>
/// <param name="httpClient">The HTTP client.</param>
/// <param name="authService">AuthService instance, the session's key holder.</param>
/// <param name="vaultKeyService">VaultKeyService instance.</param>
/// <param name="jsInteropService">JsInteropService instance.</param>
/// <param name="rustCoreService">RustCoreService instance.</param>
/// <param name="state">The sync state this pull adopts the snapshot into.</param>
/// <param name="logger">ILogger instance.</param>
public sealed class VaultSyncService(HttpClient httpClient, AuthService authService, VaultKeyService vaultKeyService, JsInteropService jsInteropService, RustCoreService rustCoreService, VaultSyncState state, ILogger<VaultSyncService> logger)
{
    private const string VaultEndpoint = "v2/Vault";
    private const string BlobsDownloadEndpoint = "v2/Vault/blobs/download";
    private const string AttachmentBlobCategory = "attachment";

    /// <summary>
    /// Max amount of base64 characters transferred in a single blob transfer request or response body.
    /// </summary>
    private const int BlobTransferBatchMaxChars = 4 * 1024 * 1024;

    /// <summary>
    /// Upper bound on the number of blobs in one transfer batch.
    /// </summary>
    private const int BlobTransferBatchMaxCount = 100;

    /// <summary>
    /// Gets the sync state adopted from the last pull.
    /// </summary>
    public VaultSyncState State => state;

    /// <summary>
    /// Retrieve the latest vault from the server
    /// </summary>
    /// <returns>The pull result.</returns>
    /// <exception cref="VaultProcessingException">Thrown when the snapshot was fetched but could not be opened or materialized.</exception>
    public async Task<PullResult> PullAsync()
    {
        /*
         * Step 1: network fetch. Failures here (server unreachable, HTTP error) are "can't reach the server" conditions,
         * not vault-processing problems, so they propagate unchanged.
         */
        logger.LogInformation("[V2Pull] Step 1/3: fetching vault snapshot (GET /v2/Vault)...");
        var snapshot = await FetchSnapshotAsync();
        state.LastServedManifestIds.Clear();
        state.LastServedManifestIds.AddRange(snapshot.Manifests.Select(m => m.ManifestId));
        state.LastSnapshotWasLegacySqliteBlob = snapshot.StorageFormat != StorageFormat.Manifest;

        // LEGACY: a not-yet-migrated account's blob is passed through unchanged.
        if (state.LastSnapshotWasLegacySqliteBlob)
        {
            return OpenLegacySqliteBlobSnapshot(snapshot);
        }

        var personalDto = SelectPersonalManifest(snapshot) ?? throw new VaultProcessingException("vault-pull", new InvalidOperationException("The server returned no personal manifest, refusing to assemble."));
        if (string.IsNullOrEmpty(personalDto.Blob))
        {
            // The personal manifest exists but was never written (fresh account): the client creates the vault.
            state.PersonalManifestId = personalDto.ManifestId;
            logger.LogInformation("[V2Pull] Personal manifest {ManifestId} has no content yet; a new vault will be created.", personalDto.ManifestId);
            return new PullResult { Kind = PullKind.Empty, Revision = personalDto.Revision };
        }

        logger.LogInformation("[V2Pull] Step 1/3 done: manifests={ManifestCount}, personalRevision={Revision}, buckets={BucketCount}, blobRefs={BlobRefCount}.", snapshot.Manifests.Count, personalDto.Revision, snapshot.Buckets.Count, personalDto.BlobReferences.Count);

        /*
         * Steps 2 and 3: decrypt, download blobs, materialize. Any failure here is a client-side vault-processing
         * error (codec/format mismatch, integrity failure, corrupt blob) and is wrapped so the UI can surface the real
         * technical detail.
         */
        try
        {
            logger.LogInformation("[V2Pull] Step 2/3: decrypting manifests, buckets and blobs...");
            var opened = await OpenManifestsAndAdoptSyncStateAsync(snapshot, personalDto);
            var blobs = await DownloadReferencedBlobsAsync(opened);

            logger.LogInformation("[V2Pull] Step 3/3: materializing {ManifestCount} manifest(s) into a fresh SQLite database...", opened.Resolved.Count);
            var database = await MaterializeAsync(opened, blobs);
            return new PullResult { Kind = PullKind.Materialized, Database = database, Revision = opened.PersonalRevision };
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "[V2Pull] FAILED: the last logged step above is where it broke.");
            throw new VaultProcessingException("vault-pull", ex);
        }
    }

    /// <summary>
    /// Pick the user's personal manifest out of a snapshot.
    /// </summary>
    /// <param name="snapshot">The raw snapshot.</param>
    /// <returns>The personal manifest, or null.</returns>
    private static Manifest? SelectPersonalManifest(GetResponse snapshot)
    {
        return snapshot.PersonalManifestId is { } personalId ? snapshot.Manifests.FirstOrDefault(m => m.ManifestId == personalId) : null;
    }

    /// <summary>
    /// The grant a shared manifest is remembered by, or null when the snapshot carries none.
    /// </summary>
    /// <param name="dto">The snapshot manifest.</param>
    /// <returns>Tuple with the sealed VEK, the public key it was sealed with and the algorithm token.</returns>
    private static (string EncryptedVek, string EncryptionPublicKey, string Algorithm)? GrantOf(Manifest dto)
    {
        if (string.IsNullOrEmpty(dto.EncryptedVek) || string.IsNullOrEmpty(dto.EncryptionPublicKey))
        {
            return null;
        }

        return (dto.EncryptedVek, dto.EncryptionPublicKey, dto.Algorithm ?? VaultKeyAlgorithms.ToToken(VaultKeyAlgorithm.RsaOaepSha256));
    }

    /// <summary>
    /// The number of base64 characters a payload of the given raw size occupies on the wire.
    /// </summary>
    /// <param name="sizeBytes">Raw byte count.</param>
    /// <returns>Base64 character count.</returns>
    private static int Base64Chars(int sizeBytes)
    {
        return (int)Math.Ceiling(sizeBytes / 3.0) * 4;
    }

    /// <summary>
    /// Split items into request batches bounded by both the byte budget and the item count. An item larger than the
    /// byte budget itself is transferred on its own.
    /// </summary>
    /// <typeparam name="T">Item type.</typeparam>
    /// <param name="items">The items to batch.</param>
    /// <param name="costOf">The base64 character cost one item adds to the body.</param>
    /// <returns>The batches.</returns>
    private static List<List<T>> BatchByTransferCost<T>(IEnumerable<T> items, Func<T, int> costOf)
    {
        var batches = new List<List<T>>();
        var batch = new List<T>();
        var chars = 0;
        foreach (var item in items)
        {
            var cost = costOf(item);
            if (batch.Count > 0 && (chars + cost > BlobTransferBatchMaxChars || batch.Count >= BlobTransferBatchMaxCount))
            {
                batches.Add(batch);
                batch = [];
                chars = 0;
            }

            batch.Add(item);
            chars += cost;
        }

        if (batch.Count > 0)
        {
            batches.Add(batch);
        }

        return batches;
    }

    /// <summary>
    /// Read the addressing fields off a decrypted manifest or bucket payload without materializing its rows.
    /// </summary>
    /// <param name="payloadJson">The payload JSON.</param>
    /// <returns>The manifest id the payload declares, its salt, its name, its category and a row count summary per table.</returns>
    private static (Guid? ManifestId, string? Salt, string? Name, string? Category, string TableSummary) ReadPayloadHeader(string payloadJson)
    {
        using var document = JsonDocument.Parse(payloadJson);
        var root = document.RootElement;
        Guid? manifestId = root.TryGetProperty("manifestId", out var idElement) && idElement.ValueKind == JsonValueKind.String && Guid.TryParse(idElement.GetString(), out var parsed) ? parsed : null;
        var salt = root.TryGetProperty("manifestSalt", out var saltElement) && saltElement.ValueKind == JsonValueKind.String ? saltElement.GetString() : null;
        var name = root.TryGetProperty("name", out var nameElement) && nameElement.ValueKind == JsonValueKind.String ? nameElement.GetString() : null;
        var category = root.TryGetProperty("category", out var categoryElement) && categoryElement.ValueKind == JsonValueKind.String ? categoryElement.GetString() : null;

        var summary = new StringBuilder();
        if (root.TryGetProperty("tables", out var tables) && tables.ValueKind == JsonValueKind.Object)
        {
            foreach (var table in tables.EnumerateObject())
            {
                summary.Append(summary.Length > 0 ? ", " : string.Empty).Append(table.Name).Append('=').Append(table.Value.ValueKind == JsonValueKind.Array ? table.Value.GetArrayLength() : 0);
            }
        }

        return (manifestId, salt, name, category, summary.ToString());
    }

    /// <summary>
    /// Build the JSON input of the Rust materialize call from the raw payload strings.
    /// </summary>
    /// <param name="manifestJsons">The decrypted manifests, the caller's own first.</param>
    /// <param name="bucketJsons">The decrypted data buckets.</param>
    /// <param name="schemaColumns">The column set of the local schema, per table.</param>
    /// <returns>The MaterializeInput JSON.</returns>
    private static string BuildMaterializeInput(IEnumerable<string> manifestJsons, IEnumerable<string> bucketJsons, IReadOnlyDictionary<string, List<string>> schemaColumns)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteStartArray("manifests");
            foreach (var manifestJson in manifestJsons)
            {
                writer.WriteRawValue(manifestJson, skipInputValidation: true);
            }

            writer.WriteEndArray();
            writer.WriteStartArray("dataBuckets");
            foreach (var bucketJson in bucketJsons)
            {
                writer.WriteRawValue(bucketJson, skipInputValidation: true);
            }

            writer.WriteEndArray();
            writer.WriteStartObject("schemaColumns");
            foreach (var (table, columns) in schemaColumns)
            {
                writer.WriteStartArray(table);
                foreach (var column in columns)
                {
                    writer.WriteStringValue(column);
                }

                writer.WriteEndArray();
            }

            writer.WriteEndObject();
            writer.WriteEndObject();
        }

        return Encoding.UTF8.GetString(stream.ToArray());
    }

    /// <summary>
    /// Fetch the raw snapshot (GET /v2/Vault).
    /// </summary>
    /// <returns>The snapshot.</returns>
    private async Task<GetResponse> FetchSnapshotAsync()
    {
        return await httpClient.GetFromJsonAsync<GetResponse>(VaultEndpoint) ?? throw new InvalidOperationException("Empty vault snapshot response.");
    }

    /// <summary>
    /// Take a legacy snapshot apart: the blob passes through untouched. TODO: remove when all accounts have been migrated to the new manifest-v1 format.
    /// </summary>
    /// <param name="snapshot">The raw snapshot.</param>
    /// <returns>The pass-through result.</returns>
    private PullResult OpenLegacySqliteBlobSnapshot(GetResponse snapshot)
    {
        // Clear any manifest-v1 state from the sync state in case there is any.
        state.ContentFingerprints.Clear();
        state.SharedManifests.Clear();
        state.BucketRevisions.Clear();

        var revision = snapshot.LegacyRevision ?? 0;
        state.ManifestRevisions.Clear();
        if (snapshot.PersonalManifestId is { } personalId)
        {
            // A legacy vault is one logical manifest; seed the per-manifest baseline with the server's reserved id.
            state.PersonalManifestId = personalId;
            state.ManifestRevisions[personalId] = revision;
        }

        logger.LogInformation("[V2Pull] Legacy sqlite-blob pass-through (account not yet migrated), returning the blob as-is.");
        return new PullResult { Kind = PullKind.LegacySqliteBlob, LegacyVaultBlob = snapshot.LegacyVaultBlob ?? string.Empty, LegacyVersion = snapshot.Version ?? string.Empty, Revision = revision };
    }

    /// <summary>
    /// Open every manifest a snapshot carries (the personal one plus each shared one) and adopt the snapshot as this device's sync state.
    /// </summary>
    /// <param name="snapshot">The raw snapshot.</param>
    /// <param name="personalDto">The caller's own manifest.</param>
    /// <returns>The opened set.</returns>
    private async Task<OpenedManifestSet> OpenManifestsAndAdoptSyncStateAsync(GetResponse snapshot, Manifest personalDto)
    {
        var personalVek = authService.GetEncryptionKeyAsBase64Async();
        var resolved = new List<ResolvedManifest>();
        var sharedRecords = new Dictionary<Guid, SharedManifestRecord>();
        var contentlessRevisions = new Dictionary<Guid, long>();
        var fingerprints = new Dictionary<string, string>(StringComparer.Ordinal);

        // 1) Open every manifest through one path, personal manifest first.
        var ordered = new List<Manifest> { personalDto };
        ordered.AddRange(snapshot.Manifests.Where(m => m.ManifestId != personalDto.ManifestId));
        foreach (var dto in ordered)
        {
            var isPersonal = dto.ManifestId == personalDto.ManifestId;
            var manifestKey = await ResolveManifestVekAsync(dto, personalVek, isPersonal, resolved.Count > 0 ? resolved[0] : null);
            if (string.IsNullOrEmpty(dto.Blob))
            {
                // A shared manifest served without content yet (created but never written); its grant and revision are still tracked.
                var contentlessGrant = GrantOf(dto) ?? throw new InvalidOperationException($"Shared manifest {dto.ManifestId} was served without content and without a grant, refusing to assemble.");
                sharedRecords[dto.ManifestId] = new SharedManifestRecord(dto.ManifestId, contentlessGrant.EncryptedVek, contentlessGrant.EncryptionPublicKey, contentlessGrant.Algorithm, await rustCoreService.VaultCodecGenerateManifestSaltAsync(), null, dto.CanAdminister, manifestKey);
                contentlessRevisions[dto.ManifestId] = dto.Revision;
                continue;
            }

            var entry = await OpenManifestAsync(dto, manifestKey, isPersonal);
            resolved.Add(entry);
            fingerprints[VaultSyncState.ManifestFingerprintKey(entry.ManifestId)] = entry.ContentFingerprint;

            if (isPersonal)
            {
                state.PersonalManifestSalt = entry.ManifestSalt;
                state.PersonalManifestId = entry.ManifestId;
                continue;
            }

            var grant = GrantOf(dto) ?? throw new InvalidOperationException($"Shared manifest {entry.ManifestId} carries no grant this account can re-open, refusing to assemble.");
            sharedRecords[entry.ManifestId] = new SharedManifestRecord(entry.ManifestId, grant.EncryptedVek, grant.EncryptionPublicKey, grant.Algorithm, entry.ManifestSalt, entry.Name, dto.CanAdminister, manifestKey);
        }

        // 2) Open the data buckets belonging to those manifests.
        var (dataBuckets, bucketRevisions) = await OpenDataBucketsAsync(snapshot, resolved, fingerprints);

        // 3) Adopt the snapshot as local truth.
        state.SharedManifests.Clear();
        foreach (var (id, record) in sharedRecords)
        {
            state.SharedManifests[id] = record;
        }

        state.ManifestRevisions.Clear();
        foreach (var entry in resolved)
        {
            state.ManifestRevisions[entry.ManifestId] = entry.Revision;
        }

        foreach (var (id, revision) in contentlessRevisions)
        {
            state.ManifestRevisions[id] = revision;
        }

        state.BucketRevisions.Clear();
        foreach (var (key, revision) in bucketRevisions)
        {
            state.BucketRevisions[key] = revision;
        }

        state.ContentFingerprints.Clear();
        foreach (var (key, fingerprint) in fingerprints)
        {
            state.ContentFingerprints[key] = fingerprint;
        }

        logger.LogInformation("[V2Pull] Adopted revisions of {ManifestCount} manifest(s) and {BucketCount} bucket(s); {FingerprintCount} fingerprint baseline(s) stored.", state.ManifestRevisions.Count, state.BucketRevisions.Count, state.ContentFingerprints.Count);
        return new OpenedManifestSet(resolved, dataBuckets, contentlessRevisions.Keys.ToList(), resolved[0].Revision);
    }

    /// <summary>
    /// Verify one snapshot manifest's ciphertext, decrypt and open it.
    /// </summary>
    /// <param name="dto">The snapshot manifest (must carry a blob).</param>
    /// <param name="vek">The key that decrypts it.</param>
    /// <param name="isPersonal">Whether this is the caller's own manifest.</param>
    /// <returns>The opened manifest.</returns>
    private async Task<ResolvedManifest> OpenManifestAsync(Manifest dto, string vek, bool isPersonal)
    {
        var label = isPersonal ? "manifest" : $"shared manifest {dto.ManifestId}";
        var manifestJson = await VerifyDecryptUnpackAsync(dto.Blob!, vek, dto.CiphertextHash, label);
        var header = ReadPayloadHeader(manifestJson);

        // Bind the payload to the address the server delivered it under (anti-rehoming).
        if (header.ManifestId != dto.ManifestId)
        {
            throw new InvalidOperationException($"Manifest {dto.ManifestId} declares a different id ({header.ManifestId?.ToString() ?? "none"}) inside its encrypted payload, refusing to open it.");
        }

        if (string.IsNullOrEmpty(header.Salt))
        {
            throw new InvalidOperationException($"Manifest {dto.ManifestId} carries no manifest salt, refusing to open it.");
        }

        logger.LogInformation("[V2Pull] Opened {Label} (content hash verified): tables: {Tables}", label, header.TableSummary);
        return new ResolvedManifest(dto.ManifestId, isPersonal, manifestJson, header.Salt, header.Name, vek, dto.Revision, dto.BlobReferences, await rustCoreService.VaultCodecComputeContentFingerprintAsync(manifestJson));
    }

    /// <summary>
    /// Verify a ciphertext against the hash the server stored, then decrypt and unpack it via the Rust codec.
    /// </summary>
    /// <param name="base64Ciphertext">The ciphertext as served.</param>
    /// <param name="vek">The symmetric key.</param>
    /// <param name="expectedCiphertextHash">The ciphertext hash the server stored, when available.</param>
    /// <param name="label">What is being opened, for the error message.</param>
    /// <returns>The payload JSON.</returns>
    private async Task<string> VerifyDecryptUnpackAsync(string base64Ciphertext, string vek, string? expectedCiphertextHash, string label)
    {
        if (!string.IsNullOrEmpty(expectedCiphertextHash) && await rustCoreService.VaultCodecComputeCiphertextHashAsync(base64Ciphertext) != expectedCiphertextHash)
        {
            throw new InvalidOperationException($"The {label} ciphertext hash does not match what the server stored, refusing to load. Possible storage corruption.");
        }

        try
        {
            return await rustCoreService.VaultCodecDecryptAndUnpackPayloadAsync(base64Ciphertext, vek);
        }
        catch (JSException ex)
        {
            throw new InvalidOperationException($"The {label} could not be decrypted or unpacked: {ex.Message}", ex);
        }
    }

    /// <summary>
    /// The key that opens one snapshot manifest.
    /// </summary>
    /// <param name="dto">The snapshot manifest.</param>
    /// <param name="personalVek">The session's VEK, which opens the manifest the account key hierarchy is filed under.</param>
    /// <param name="isPersonal">Whether this is the caller's own manifest.</param>
    /// <param name="personalManifest">The already-opened personal manifest (the durable home of rotated private keys), or null when none is open yet.</param>
    /// <returns>The manifest's VEK. Throws when this client holds no key for it.</returns>
    private async Task<string> ResolveManifestVekAsync(Manifest dto, string personalVek, bool isPersonal, ResolvedManifest? personalManifest)
    {
        // Without an explicit key type the home manifest is the account-key one by definition, any other manifest a grant.
        var keyTypeToken = dto.KeyType ?? ManifestKeyTypes.ToToken(isPersonal ? ManifestKeyType.AccountKey : ManifestKeyType.GrantKey);
        if (!ManifestKeyTypes.TryParse(keyTypeToken, out var keyType))
        {
            throw new InvalidOperationException($"Manifest {dto.ManifestId} states an unknown key type \"{keyTypeToken}\" (newer server?), refusing to assemble.");
        }

        if (keyType == ManifestKeyType.AccountKey)
        {
            if (!isPersonal)
            {
                // Our unlock chain produced a VEK for a different manifest than the one this key is filed under.
                throw new InvalidOperationException($"Manifest {dto.ManifestId} is unlocked by the account key hierarchy, but this session holds no key for it, refusing to assemble.");
            }

            return personalVek;
        }

        if (personalManifest is null)
        {
            throw new InvalidOperationException($"Manifest {dto.ManifestId} is opened through a grant, but no personal manifest is open to resolve the private key from, refusing to assemble.");
        }

        return await ResolveGrantedVekAsync(personalManifest, dto);
    }

    /// <summary>
    /// Decrypt the VEK the server granted the caller on a manifest.
    /// </summary>
    /// <param name="personalManifest">The opened personal manifest, the durable home of rotated private keys.</param>
    /// <param name="dto">The snapshot manifest carrying the grant.</param>
    /// <returns>The manifest's VEK.</returns>
    private async Task<string> ResolveGrantedVekAsync(ResolvedManifest personalManifest, Manifest dto)
    {
        if (string.IsNullOrEmpty(dto.EncryptedVek) || string.IsNullOrEmpty(dto.EncryptionPublicKey))
        {
            throw new InvalidOperationException($"Shared manifest {dto.ManifestId} carries no grant to open it with, refusing to assemble.");
        }

        // The algorithm, not the key type, decides how the ciphertext opens; RSA-OAEP is the default when none is stated.
        var algorithmToken = dto.Algorithm ?? VaultKeyAlgorithms.ToToken(VaultKeyAlgorithm.RsaOaepSha256);
        if (!VaultKeyAlgorithms.TryParse(algorithmToken, out var algorithm) || algorithm != VaultKeyAlgorithm.RsaOaepSha256)
        {
            throw new InvalidOperationException($"Shared manifest {dto.ManifestId} grants its VEK under an unsupported algorithm \"{algorithmToken}\" (newer server?), refusing to assemble.");
        }

        var privateKeyJwk = await ResolvePrivateKeyJwkAsync(personalManifest, dto.EncryptionPublicKey) ?? throw new InvalidOperationException($"No private key in this vault opens the grant on shared manifest {dto.ManifestId}, refusing to assemble.");
        try
        {
            var plaintextBase64 = await jsInteropService.DecryptWithPrivateKey(dto.EncryptedVek, privateKeyJwk);
            return Encoding.UTF8.GetString(Convert.FromBase64String(plaintextBase64));
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Failed to decrypt the VEK of shared manifest {dto.ManifestId}, refusing to assemble. Underlying: {ex.Message}", ex);
        }
    }

    /// <summary>
    /// Resolve the private key (JWK) that opens a grant.
    /// </summary>
    /// <param name="personalManifest">The opened personal manifest.</param>
    /// <param name="encryptionPublicKey">The public key the grant was sealed with.</param>
    /// <returns>The private key as a JWK JSON string, or null.</returns>
    private async Task<string?> ResolvePrivateKeyJwkAsync(ResolvedManifest personalManifest, string encryptionPublicKey)
    {
        var accountPublicKey = await vaultKeyService.GetAccountPublicKeyAsync();
        if (accountPublicKey == encryptionPublicKey && authService.GetAccountPrivateKey() is { } sessionPrivateKey)
        {
            return sessionPrivateKey;
        }

        var keyRowJson = await rustCoreService.VaultCodecExtractEncryptionKeyForPublicKeyAsync(personalManifest.ManifestJson, encryptionPublicKey);
        if (keyRowJson is null)
        {
            return null;
        }

        using var document = JsonDocument.Parse(keyRowJson);
        return document.RootElement.TryGetProperty("PrivateKey", out var privateKey) && privateKey.ValueKind == JsonValueKind.String ? privateKey.GetString() : null;
    }

    /// <summary>
    /// Open the data buckets a snapshot carries.
    /// </summary>
    /// <param name="snapshot">The raw snapshot.</param>
    /// <param name="resolved">The manifests already opened; a bucket addressed to any other manifest is refused.</param>
    /// <param name="fingerprints">The fingerprint map to add one entry per bucket to.</param>
    /// <returns>The decrypted bucket payloads and the snapshot's bucket revisions.</returns>
    private async Task<(List<string> DataBuckets, Dictionary<string, long> BucketRevisions)> OpenDataBucketsAsync(GetResponse snapshot, List<ResolvedManifest> resolved, Dictionary<string, string> fingerprints)
    {
        var keyByManifestId = resolved.ToDictionary(entry => entry.ManifestId, entry => entry.VaultEncryptionKey);
        var dataBuckets = new List<string>();
        var bucketRevisions = new Dictionary<string, long>(StringComparer.Ordinal);
        foreach (var bucketDto in snapshot.Buckets)
        {
            if (string.IsNullOrEmpty(bucketDto.Blob))
            {
                continue;
            }

            var category = bucketDto.Category.ToString();
            if (!keyByManifestId.TryGetValue(bucketDto.ManifestId, out var bucketKey))
            {
                throw new InvalidOperationException($"Data bucket \"{category}\" belongs to manifest {bucketDto.ManifestId}, which this vault did not open, refusing to assemble.");
            }

            var label = $"\"{category}\" bucket of manifest {bucketDto.ManifestId}";
            var bucketJson = await VerifyDecryptUnpackAsync(bucketDto.Blob, bucketKey, bucketDto.CiphertextHash, label);
            var header = ReadPayloadHeader(bucketJson);

            // Bind the payload to the address the server delivered it under.
            if (header.ManifestId != bucketDto.ManifestId || !string.Equals(header.Category, category, StringComparison.Ordinal))
            {
                throw new InvalidOperationException($"The {label} declares a different address (manifest {header.ManifestId?.ToString() ?? "none"}, category \"{header.Category}\") inside its encrypted payload, refusing to assemble.");
            }

            dataBuckets.Add(bucketJson);
            fingerprints[VaultSyncState.BucketFingerprintKey(bucketDto.ManifestId, category)] = await rustCoreService.VaultCodecComputeContentFingerprintAsync(bucketJson);
            bucketRevisions[VaultSyncState.BucketRevisionKey(bucketDto.ManifestId, category)] = bucketDto.Revision;
            logger.LogInformation("[V2Pull] Opened {Label} (revision {Revision}): tables: {Tables}", label, bucketDto.Revision, header.TableSummary);
        }

        return (dataBuckets, bucketRevisions);
    }

    /// <summary>
    /// Fetch every blob the opened manifests reference that is not cached yet, decrypt it with the owning manifest's
    /// key, and prune the cache to exactly the referenced set.
    /// </summary>
    /// <param name="opened">The opened manifests.</param>
    /// <returns>Plaintext bytes per blob hash, for the codec to re-embed.</returns>
    private async Task<Dictionary<string, byte[]>> DownloadReferencedBlobsAsync(OpenedManifestSet opened)
    {
        var refOwners = new Dictionary<string, ResolvedManifest>(StringComparer.Ordinal);
        var refs = new List<BlobReference>();
        foreach (var entry in opened.Resolved)
        {
            foreach (var reference in entry.BlobReferences)
            {
                if (refOwners.TryAdd(reference.Hash, entry))
                {
                    refs.Add(reference);
                }
            }
        }

        var cache = state.BlobCipherCache;
        var missingRefs = refs.Where(reference => !cache.ContainsKey(reference.Hash)).ToList();
        logger.LogInformation("[V2Pull] Blob refs: {Referenced} referenced, {Cached} cached, {Missing} to download.", refs.Count, refs.Count - missingRefs.Count, missingRefs.Count);

        // Batch downloads by the bytes each blob adds to the response, not by hash count.
        var batches = BatchByTransferCost(missingRefs, reference => Base64Chars(reference.SizeBytes));
        for (var index = 0; index < batches.Count; index++)
        {
            var batch = batches[index];
            using var response = await httpClient.PostAsJsonAsync(BlobsDownloadEndpoint, new BlobHashesRequest { Hashes = batch.Select(reference => reference.Hash).ToList() });
            response.EnsureSuccessStatusCode();
            var blobs = await response.Content.ReadFromJsonAsync<List<Blob>>() ?? [];
            foreach (var blob in blobs)
            {
                cache[blob.Hash] = blob.EncryptedDataBase64;
            }

            logger.LogInformation("[V2Pull] Downloaded blob batch {Index}/{Total}: requested {Requested}, received {Received}.", index + 1, batches.Count, batch.Count, blobs.Count);
        }

        // Decrypt the referenced blobs and prune the cache to the referenced set, so it stays bounded by the current vault size.
        var prunedCache = new Dictionary<string, string>(StringComparer.Ordinal);
        var blobMap = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        foreach (var reference in refs)
        {
            var owner = refOwners[reference.Hash];
            if (!cache.TryGetValue(reference.Hash, out var ciphertext))
            {
                HandleUnavailableBlob(reference, owner, "is missing on the server");
                continue;
            }

            try
            {
                blobMap[reference.Hash] = await jsInteropService.SymmetricDecryptBase64ToBytes(ciphertext, owner.VaultEncryptionKey);
                prunedCache[reference.Hash] = ciphertext;
            }
            catch (JSException)
            {
                HandleUnavailableBlob(reference, owner, "failed to decrypt with the current key");
            }
        }

        cache.Clear();
        foreach (var (hash, ciphertext) in prunedCache)
        {
            cache[hash] = ciphertext;
        }

        // The server demonstrably has every blob it just served or referenced, seed the upload diff with them.
        state.ServerBlobHashes.Clear();
        state.ServerBlobHashes.UnionWith(refs.Select(reference => reference.Hash));
        return blobMap;
    }

    /// <summary>
    /// A referenced blob that cannot be materialized. A personal attachment is fatal: materializing it as empty would
    /// propagate silent data loss on the next push. A favicon or a shared manifest's blob is skipped with a warning.
    /// </summary>
    /// <param name="reference">The blob reference.</param>
    /// <param name="owner">The manifest that references it.</param>
    /// <param name="reason">Why it is unavailable.</param>
    private void HandleUnavailableBlob(BlobReference reference, ResolvedManifest owner, string reason)
    {
        if (owner.IsPersonal && string.Equals(reference.Category, AttachmentBlobCategory, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException($"Referenced attachment blob {reference.Hash} {reason}, refusing to materialize an incomplete vault.");
        }

        logger.LogWarning("[V2Pull] Referenced {Category} blob {Hash} {Reason}, continuing without it.", reference.Category, reference.Hash, reason);
    }

    /// <summary>
    /// Materialize manifests and data buckets into a fresh in-memory SQLite database via the codec.
    /// </summary>
    /// <param name="opened">The opened manifests and buckets.</param>
    /// <param name="blobs">Plaintext bytes for every blob hash the manifests reference.</param>
    /// <returns>The open database connection; the caller owns it.</returns>
    private async Task<SqliteConnection> MaterializeAsync(OpenedManifestSet opened, Dictionary<string, byte[]> blobs)
    {
        var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        try
        {
            var schemaSql = await jsInteropService.GetCompleteSchemaSqlAsync();
            await VaultMaterializer.ApplySchemaAsync(connection, schemaSql);

            // The local schema's column set routes anything a newer writer stored into the overflow carrier instead of crashing the insert.
            var schemaColumns = await VaultMaterializer.ReadSchemaColumnsAsync(connection);
            var inputJson = BuildMaterializeInput(opened.Resolved.Select(entry => entry.ManifestJson), opened.DataBuckets, schemaColumns);
            var materializedJson = await rustCoreService.VaultCodecMaterializeAsSqliteAsync(inputJson);
            await VaultMaterializer.InsertMaterializedTablesAsync(connection, materializedJson, blobs, logger);
            return connection;
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }
    }
}
