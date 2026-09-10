//-----------------------------------------------------------------------
// <copyright file="VaultSyncService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.VaultSync;

using System.Net;
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
/// Syncs the vault with the server: pulls and materializes the manifest snapshot, canonicalizes and pushes the local
/// vault, and merges the two when they diverged.
/// </summary>
/// <param name="httpClient">The HTTP client.</param>
/// <param name="authService">AuthService instance, the session's key holder.</param>
/// <param name="vaultKeyService">VaultKeyService instance.</param>
/// <param name="jsInteropService">JsInteropService instance.</param>
/// <param name="rustCoreService">RustCoreService instance.</param>
/// <param name="state">The sync state this service records the server's state into.</param>
/// <param name="config">Config instance, for the private email domains the routing push claims.</param>
/// <param name="logger">ILogger instance.</param>
public sealed class VaultSyncService(HttpClient httpClient, AuthService authService, VaultKeyService vaultKeyService, JsInteropService jsInteropService, RustCoreService rustCoreService, VaultSyncState state, Config config, ILogger<VaultSyncService> logger)
{
    private const string AttachmentBlobCategory = "attachment";
    private const string BlobRefMarker = "__blobRef";
    private const string BlobKindMarker = "__blobKind";

    /// <summary>
    /// Max amount of base64 characters transferred in a single blob transfer request or response body.
    /// </summary>
    private const int BlobTransferBatchMaxChars = 4 * 1024 * 1024;

    /// <summary>
    /// Upper bound on the number of blobs in one transfer batch.
    /// </summary>
    private const int BlobTransferBatchMaxCount = 100;

    private static readonly string VaultEndpoint = ApiRoute("Vault");
    private static readonly string BlobsEndpoint = ApiRoute("Vault/blobs");
    private static readonly string BlobsMissingEndpoint = ApiRoute("Vault/blobs/missing");
    private static readonly string BlobsDownloadEndpoint = ApiRoute("Vault/blobs/download");

    private string? _schemaSql;
    private Dictionary<string, List<string>>? _schemaColumns;

    /// <summary>
    /// Gets the sync state recorded by the last pull or push.
    /// </summary>
    public VaultSyncState State => state;

    /// <summary>
    /// Retrieve the latest vault from the server.
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
        RecordServedManifests(snapshot);

        // LEGACY: a not-yet-migrated account's blob is passed through unchanged.
        if (state.LastSnapshotWasLegacySqliteBlob)
        {
            return OpenLegacySqliteBlobSnapshot(snapshot);
        }

        var personalDto = SelectPersonalManifest(snapshot) ?? throw new VaultProcessingException("vault-pull", new InvalidOperationException("The server returned no personal manifest, refusing to assemble."));
        if (string.IsNullOrEmpty(personalDto.Blob))
        {
            // The personal manifest exists but was never written (fresh account): the client creates the vault.
            RecordEmptyPersonalManifest(personalDto);
            logger.LogInformation("[V2Pull] Personal manifest {ManifestId} has no content yet; a new vault will be created.", personalDto.ManifestId);
            return new PullResult { Kind = PullKind.Empty };
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
            var opened = await OpenManifestsAndRecordSyncStateAsync(snapshot, personalDto);
            var blobs = await DownloadReferencedBlobsAsync(opened);

            logger.LogInformation("[V2Pull] Step 3/3: materializing {ManifestCount} manifest(s) into a fresh SQLite database...", opened.Resolved.Count);
            var database = await MaterializeAsync(opened.Resolved.Select(entry => entry.ManifestJson), opened.DataBuckets, blobs);
            return new PullResult { Kind = PullKind.Materialized, Database = database };
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "[V2Pull] FAILED: the last logged step above is where it broke.");
            throw new VaultProcessingException("vault-pull", ex);
        }
    }

    /// <summary>
    /// Pull the latest snapshot and merge the local vault onto it at canonical level, one manifest at a time. The
    /// server side is the base; the local side is canonicalized from the given connection.
    /// </summary>
    /// <param name="localConnection">The local vault holding the changes to keep.</param>
    /// <returns>The merged database, or the signal that the server holds nothing to merge with.</returns>
    /// <exception cref="VaultProcessingException">Thrown when the snapshot could not be opened or the merge failed.</exception>
    public async Task<PullAndMergeResult> PullAndMergeAsync(SqliteConnection localConnection)
    {
        logger.LogInformation("[V2Merge] Fetching vault snapshot for canonical merge (GET /v2/Vault)...");
        var snapshot = await FetchSnapshotAsync();
        RecordServedManifests(snapshot);

        // LEGACY: a server still on the sqlite-blob format cannot merge with a manifest-v1 vault; the caller pushes over it.
        if (state.LastSnapshotWasLegacySqliteBlob)
        {
            OpenLegacySqliteBlobSnapshot(snapshot);
            return new PullAndMergeResult { Kind = PullAndMergeKind.NothingToMergeWith };
        }

        var personalDto = SelectPersonalManifest(snapshot) ?? throw new VaultProcessingException("vault-merge", new InvalidOperationException("The server returned no personal manifest, refusing to merge."));
        if (string.IsNullOrEmpty(personalDto.Blob))
        {
            RecordEmptyPersonalManifest(personalDto);
            return new PullAndMergeResult { Kind = PullAndMergeKind.NothingToMergeWith };
        }

        var stateBeforeMerge = state.Clone();
        try
        {
            var opened = await OpenManifestsAndRecordSyncStateAsync(snapshot, personalDto);
            var serverBlobs = await DownloadReferencedBlobsAsync(opened);
            var local = await CanonicalizeAsync(localConnection, authService.GetEncryptionKeyAsBase64Async(), null);
            return await MergeOntoOpenedManifestsAsync(opened, serverBlobs, local);
        }
        catch (Exception ex)
        {
            // The local vault is still the live one, so the state must keep describing what it was pulled from.
            state.CopyFrom(stateBeforeMerge);
            logger.LogError(ex, "[V2Merge] FAILED: the last logged step above is where it broke.");
            throw new VaultProcessingException("vault-merge", ex);
        }
    }

    /// <summary>
    /// Migrate the local vault onto the current full schema canonicalize the database into
    /// manifest-v1 form (adopting rows that predate the manifest stamp into the personal manifest) and materialize
    /// it straight back out again. This is the permanent delivery path for client schema changes.
    /// </summary>
    /// <param name="connection">The local vault to migrate.</param>
    /// <returns>The migrated in-memory database; the caller owns it.</returns>
    /// <exception cref="VaultProcessingException">Thrown when the vault could not be canonicalized or materialized.</exception>
    public async Task<SqliteConnection> MigrateVaultToCurrentSchemaAsync(SqliteConnection connection)
    {
        logger.LogInformation("[ManifestMigration] Migrating the local vault onto the current schema (local round-trip, no server involved)...");
        try
        {
            var personalManifestId = state.PersonalManifestId ?? throw new InvalidOperationException("No personal manifest id is recorded; pull once before migrating.");
            var vault = await CanonicalizeAsync(connection, authService.GetEncryptionKeyAsBase64Async(), personalManifestId);

            // Canonicalize already extracted every favicon and attachment as plaintext bytes, so materialize resolves its references without a fetch.
            var blobs = new Dictionary<string, byte[]>(StringComparer.Ordinal);
            foreach (var manifest in vault.Manifests)
            {
                foreach (var (hash, blob) in manifest.Blobs)
                {
                    blobs[hash] = blob.Bytes;
                }
            }

            var database = await MaterializeAsync(vault.Manifests.Select(manifest => manifest.ManifestJson), vault.Buckets.Select(bucket => bucket.BucketJson), blobs);
            logger.LogInformation("[ManifestMigration] Migration complete: {BlobCount} blob(s) re-embedded.", blobs.Count);
            return database;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "[ManifestMigration] FAILED to migrate the local vault.");
            throw new VaultProcessingException("vault-storage-migration", ex);
        }
    }

    /// <summary>
    /// Canonicalize the local vault, validate, encrypt and POST /v2/Vault.
    /// </summary>
    /// <param name="connection">The local vault to push.</param>
    /// <param name="options">How to write.</param>
    /// <returns>The outcome. Revisions, fingerprints and the blob caches are updated on success.</returns>
    /// <exception cref="VaultTooLargeException">Thrown when the server refuses an upload as too large.</exception>
    public async Task<PushResult> PushAsync(SqliteConnection connection, PushOptions options)
    {
        var personalManifestId = state.PersonalManifestId ?? throw new InvalidOperationException("No personal manifest id is recorded; pull once before pushing.");

        var unwritable = await FindUnwritableManifestsAsync(connection, personalManifestId);
        if (unwritable.Count > 0)
        {
            logger.LogWarning("[V2Push] Vault holds rows for manifest(s) this session cannot write ({Manifests}); refusing the write until a pull restores them.", string.Join(", ", unwritable));
            return new PushResult(PushStatus.Outdated, [$"Manifest(s) {string.Join(", ", unwritable)} are not open to this session"]);
        }

        // LEGACY: the one-time migration push creates the account key hierarchy and re-keys the personal manifest under the new VEK.
        var migration = options.CreateVaultKey ? await vaultKeyService.CreateAccountKeyHierarchyAsync(authService.GetEncryptionKeyAsBase64Async()) : null;
        var contentKey = migration?.VaultEncryptionKey ?? authService.GetEncryptionKeyAsBase64Async();
        if (migration is not null)
        {
            logger.LogInformation("[V2Push] Account-key migration: generated a new VEK, AK and account keypair; vault content and all blobs will be re-encrypted and re-uploaded.");
        }

        var vault = await CanonicalizeAsync(connection, contentKey, null);
        var emailRouting = EmailRoutingBuilder.Build(vault.Manifests.Select(manifest => manifest.ManifestJson), PrivateEmailDomains());
        logger.LogInformation("[V2Push] Canonicalize produced {ManifestCount} manifest(s) and {BucketCount} data bucket(s).", vault.Manifests.Count, vault.Buckets.Count);

        // Content-fingerprint gating: compare every canonicalized target against the fingerprint of its last-known server state and only write the targets that changed.
        var keyByManifestId = vault.Manifests.ToDictionary(manifest => manifest.Record.ManifestId, manifest => manifest.Record.VaultEncryptionKey);
        var bucketWrites = new List<BucketWrite>();
        var writtenBucketFingerprints = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var bucket in vault.Buckets)
        {
            var label = $"Data bucket \"{bucket.Category}\" of manifest {bucket.ManifestId}";
            var fingerprintKey = VaultSyncState.BucketFingerprintKey(bucket.ManifestId, bucket.Category);
            var fingerprint = await rustCoreService.VaultCodecComputeContentFingerprintAsync(bucket.BucketJson);
            if (!options.ForceFullWrite && migration is null && state.ContentFingerprints.TryGetValue(fingerprintKey, out var baseline) && baseline == fingerprint)
            {
                continue;
            }

            if (!keyByManifestId.TryGetValue(bucket.ManifestId, out var bucketKey))
            {
                logger.LogWarning("[V2Push] {Label} names a manifest this vault cannot write; leaving it out of this write.", label);
                continue;
            }

            if (!Enum.TryParse<VaultDataBucketCategory>(bucket.Category, true, out var category))
            {
                logger.LogWarning("[V2Push] {Label} has a category this client does not know; leaving it out of this write.", label);
                continue;
            }

            var validation = await rustCoreService.VaultCodecValidateDataBucketAsync(bucket.BucketJson);
            if (!validation.Ok)
            {
                return new PushResult(PushStatus.Rejected, [$"{label} validation failed: {string.Join(", ", validation.FailedRules)}. {validation.Message}".Trim()]);
            }

            var ciphertext = await rustCoreService.VaultCodecPackAndEncryptPayloadAsync(bucket.BucketJson, bucketKey);
            bucketWrites.Add(new BucketWrite
            {
                ManifestId = bucket.ManifestId,
                Category = category,
                Blob = ciphertext,
                CiphertextHash = await rustCoreService.VaultCodecComputeCiphertextHashAsync(ciphertext),
                CurrentRevision = state.BucketRevisions.GetValueOrDefault(VaultSyncState.BucketRevisionKey(bucket.ManifestId, bucket.Category), 0),
            });
            writtenBucketFingerprints[fingerprintKey] = fingerprint;
        }

        // Gate, validate, pack and encrypt every candidate manifest into the write, each with its own VEK.
        var blobEntries = new Dictionary<string, UploadBlobEntry>(StringComparer.Ordinal);
        var manifestWrites = new List<ManifestWrite>();
        var writtenManifestFingerprints = new Dictionary<Guid, string>();
        foreach (var manifest in vault.Manifests)
        {
            foreach (var (hash, blob) in manifest.Blobs)
            {
                blobEntries.TryAdd(hash, new UploadBlobEntry(blob.Kind, blob.Bytes, manifest.Record.VaultEncryptionKey, manifest.Record.IsPersonal));
            }

            var label = manifest.Record.IsPersonal ? "Personal manifest" : $"Shared manifest \"{manifest.Record.Name ?? manifest.Record.ManifestId.ToString()}\"";
            var fingerprint = await rustCoreService.VaultCodecComputeContentFingerprintAsync(manifest.ManifestJson);
            var rekeyed = migration is not null && manifest.Record.IsPersonal;
            if (!options.ForceFullWrite && !rekeyed && state.ContentFingerprints.TryGetValue(VaultSyncState.ManifestFingerprintKey(manifest.Record.ManifestId), out var baseline) && baseline == fingerprint)
            {
                continue;
            }

            var validation = await rustCoreService.VaultCodecValidateManifestAsync(manifest.ManifestJson);
            if (!validation.Ok)
            {
                if (manifest.Record.IsPersonal)
                {
                    return new PushResult(PushStatus.Rejected, [$"Manifest validation failed: {string.Join(", ", validation.FailedRules)}. {validation.Message}".Trim()]);
                }

                logger.LogWarning("[V2Push] {Label} failed validation ({Rules}), dropping it from this write.", label, string.Join(", ", validation.FailedRules));
                continue;
            }

            var ciphertext = await rustCoreService.VaultCodecPackAndEncryptPayloadAsync(manifest.ManifestJson, manifest.Record.VaultEncryptionKey);

            // Publish the public half of the manifest's email delivery keypair; only admins may publish a shared manifest's key.
            var mayPublish = manifest.Record.IsPersonal || manifest.Record.CanAdminister;
            var publicKey = mayPublish ? await VaultTableReader.ReadActivePublicKeyAsync(connection, manifest.Record.ManifestId) : null;
            if (mayPublish && publicKey is null && !manifest.Record.IsPersonal)
            {
                logger.LogWarning("[V2Push] {Label} is missing its email keypair; its aliases stay personal until sharing is re-enabled.", label);
            }

            manifestWrites.Add(new ManifestWrite
            {
                ManifestId = manifest.Record.ManifestId,
                ManifestBlob = ciphertext,
                ManifestCiphertextHash = await rustCoreService.VaultCodecComputeCiphertextHashAsync(ciphertext),
                CurrentRevision = state.ManifestRevisions.GetValueOrDefault(manifest.Record.ManifestId, 0),
                CredentialsCount = manifest.ItemCount,
                BlobReferences = manifest.Blobs.Select(pair => new BlobReference { Hash = pair.Key, Category = pair.Value.Kind }).ToList(),
                EncryptionPublicKey = publicKey,
            });
            writtenManifestFingerprints[manifest.Record.ManifestId] = fingerprint;
            logger.LogInformation("[V2Push] {Label}: {Items} item(s), {Blobs} blob reference(s), {Chars} encrypted characters.", label, manifest.ItemCount, manifest.Blobs.Count, ciphertext.Length);
        }

        // Nothing changed versus the server baselines: skip the write (and the blob diff) entirely.
        if (manifestWrites.Count == 0 && bucketWrites.Count == 0)
        {
            logger.LogInformation("[V2Push] No content changes detected (every manifest and data bucket matches the server baselines); skipping upload.");
            return new PushResult(PushStatus.Ok);
        }

        // Blob diff across every manifest in this write: only encrypt and upload blobs the server does not already have.
        var allBlobHashes = blobEntries.Keys.ToList();
        var personalHashes = allBlobHashes.Where(hash => blobEntries[hash].FromPersonal).ToList();
        var sharedHashes = allBlobHashes.Where(hash => !blobEntries[hash].FromPersonal).ToList();
        List<string> personalToUpload;
        List<string> sharedToUpload;
        if (migration is not null)
        {
            personalToUpload = personalHashes;
            sharedToUpload = await MissingOnServerAsync(sharedHashes.Where(hash => !state.ServerBlobHashes.Contains(hash)));
        }
        else
        {
            var toUpload = new HashSet<string>(await MissingOnServerAsync(allBlobHashes.Where(hash => !state.ServerBlobHashes.Contains(hash))), StringComparer.Ordinal);
            personalToUpload = personalHashes.Where(toUpload.Contains).ToList();
            sharedToUpload = sharedHashes.Where(toUpload.Contains).ToList();
        }

        logger.LogInformation("[V2Push] Blob diff: {Total} blob(s) across {Manifests} manifest(s), uploading {Personal} personal and {Shared} shared.", allBlobHashes.Count, vault.Manifests.Count, personalToUpload.Count, sharedToUpload.Count);
        var uploadedCiphertexts = new Dictionary<string, string>(StringComparer.Ordinal);
        await UploadBlobsAsync(blobEntries, personalToUpload, migration is not null, uploadedCiphertexts);
        await UploadBlobsAsync(blobEntries, sharedToUpload, false, uploadedCiphertexts);

        var request = new VaultWriteRequest
        {
            Username = await authService.GetUsernameAsync(),
            Manifests = manifestWrites,
            Buckets = bucketWrites,
            NewBlobs = [],
            EmailRouting = emailRouting,
            AccountKeys = migration?.Keys,
        };

        var response = await PostWriteAsync(request);
        if (response.MissingBlobHashes.Count > 0)
        {
            // Upload any blobs the server reports as missing and retry the write.
            var unsatisfiable = response.MissingBlobHashes.Where(hash => !blobEntries.ContainsKey(hash)).ToList();
            if (unsatisfiable.Count > 0)
            {
                return new PushResult(PushStatus.MissingBlobs, unsatisfiable);
            }

            logger.LogWarning("[V2Push] Server reported {Count} missing blob(s); uploading and retrying once.", response.MissingBlobHashes.Count);
            await UploadBlobsAsync(blobEntries, response.MissingBlobHashes.Where(hash => blobEntries[hash].FromPersonal), migration is not null, uploadedCiphertexts);
            await UploadBlobsAsync(blobEntries, response.MissingBlobHashes.Where(hash => !blobEntries[hash].FromPersonal), false, uploadedCiphertexts);
            response = await PostWriteAsync(request);
            if (response.MissingBlobHashes.Count > 0)
            {
                return new PushResult(PushStatus.MissingBlobs, response.MissingBlobHashes);
            }
        }

        if (response.Status != VaultStatus.Ok)
        {
            // A single stale manifest or bucket rejected the whole write; the caller pulls, merges and retries.
            return new PushResult(PushStatus.Outdated);
        }

        // Advance the baselines of exactly the targets this write carried.
        foreach (var bucketRevision in response.BucketRevisions)
        {
            state.BucketRevisions[VaultSyncState.BucketRevisionKey(bucketRevision.ManifestId, bucketRevision.Category.ToString())] = bucketRevision.Revision;
        }

        foreach (var manifestRevision in response.ManifestRevisions)
        {
            state.ManifestRevisions[manifestRevision.ManifestId] = manifestRevision.Revision;
        }

        foreach (var (key, fingerprint) in writtenBucketFingerprints)
        {
            state.ContentFingerprints[key] = fingerprint;
        }

        foreach (var (manifestId, fingerprint) in writtenManifestFingerprints)
        {
            state.ContentFingerprints[VaultSyncState.ManifestFingerprintKey(manifestId)] = fingerprint;
        }

        // Every referenced hash is now known to be on the server; refresh the diff baseline and the cache.
        state.ServerBlobHashes.Clear();
        state.ServerBlobHashes.UnionWith(allBlobHashes);
        var refreshedCache = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var hash in allBlobHashes)
        {
            if (uploadedCiphertexts.TryGetValue(hash, out var uploaded))
            {
                refreshedCache[hash] = uploaded;
            }
            else if (state.BlobCipherCache.TryGetValue(hash, out var cached))
            {
                refreshedCache[hash] = cached;
            }
        }

        state.BlobCipherCache.Clear();
        foreach (var (hash, ciphertext) in refreshedCache)
        {
            state.BlobCipherCache[hash] = ciphertext;
        }

        state.LastSnapshotWasLegacySqliteBlob = false;

        // Adopt the newly created account keys if this push included the one-time sqlite-blob to manifest-v1 migration.
        if (migration is not null)
        {
            await vaultKeyService.AdoptLocalAccountKeysAsync(migration);
            await authService.StoreSessionKeysAsync(Convert.FromBase64String(migration.VaultEncryptionKey), migration.AccountPrivateKey);
            logger.LogInformation("[V2Push] Account-key migration complete: hierarchy created server-side, chain cached locally.");
        }

        logger.LogInformation("[V2Push] Pushed {Manifests} manifest(s), {Buckets} bucket(s) and {Blobs} blob(s).", manifestWrites.Count, bucketWrites.Count, uploadedCiphertexts.Count);
        return new PushResult(PushStatus.Ok);
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
            WriteRawArray(writer, "manifests", manifestJsons);
            WriteRawArray(writer, "dataBuckets", bucketJsons);
            WriteSchemaColumns(writer, schemaColumns);
            writer.WriteEndObject();
        }

        return Encoding.UTF8.GetString(stream.ToArray());
    }

    /// <summary>
    /// Build the JSON input of the Rust canonical merge call.
    /// </summary>
    /// <param name="opened">The opened server manifests, the merge base.</param>
    /// <param name="local">The canonicalized local vault, the incoming side.</param>
    /// <param name="schemaColumns">The column set of the local schema, per table.</param>
    /// <returns>The canonical merge input JSON.</returns>
    private static string BuildMergeInput(OpenedManifestSet opened, CanonicalizedVault local, IReadOnlyDictionary<string, List<string>> schemaColumns)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            WriteRawArray(writer, "serverManifests", opened.Resolved.Select(entry => entry.ManifestJson));
            WriteRawArray(writer, "serverBuckets", opened.DataBuckets);
            writer.WriteStartArray("contentlessServerManifestIds");
            foreach (var id in opened.ContentlessManifestIds)
            {
                writer.WriteStringValue(id.ToString());
            }

            writer.WriteEndArray();
            WriteRawArray(writer, "localManifests", local.Manifests.Select(manifest => manifest.ManifestJson));
            WriteRawArray(writer, "localBuckets", local.Buckets.Select(bucket => bucket.BucketJson));
            WriteSchemaColumns(writer, schemaColumns);
            writer.WriteEndObject();
        }

        return Encoding.UTF8.GetString(stream.ToArray());
    }

    /// <summary>
    /// Write a named array of pre-serialized JSON values.
    /// </summary>
    /// <param name="writer">The writer.</param>
    /// <param name="name">The property name.</param>
    /// <param name="rawValues">The JSON values.</param>
    private static void WriteRawArray(Utf8JsonWriter writer, string name, IEnumerable<string> rawValues)
    {
        writer.WriteStartArray(name);
        foreach (var rawValue in rawValues)
        {
            writer.WriteRawValue(rawValue, skipInputValidation: true);
        }

        writer.WriteEndArray();
    }

    /// <summary>
    /// Write the schemaColumns object.
    /// </summary>
    /// <param name="writer">The writer.</param>
    /// <param name="schemaColumns">The column set of the local schema, per table.</param>
    private static void WriteSchemaColumns(Utf8JsonWriter writer, IReadOnlyDictionary<string, List<string>> schemaColumns)
    {
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
    }

    /// <summary>
    /// Every blob reference marker in a manifest payload: hash and kind.
    /// </summary>
    /// <param name="manifestJson">The manifest payload JSON.</param>
    /// <returns>The references.</returns>
    private static List<(string Hash, string? Kind)> BlobReferencesOf(string manifestJson)
    {
        var references = new List<(string Hash, string? Kind)>();
        using var document = JsonDocument.Parse(manifestJson);
        if (!document.RootElement.TryGetProperty("tables", out var tables) || tables.ValueKind != JsonValueKind.Object)
        {
            return references;
        }

        foreach (var table in tables.EnumerateObject())
        {
            if (table.Value.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            foreach (var row in table.Value.EnumerateArray())
            {
                foreach (var cell in row.EnumerateObject())
                {
                    if (cell.Value.ValueKind == JsonValueKind.Object && cell.Value.TryGetProperty(BlobRefMarker, out var hash) && hash.ValueKind == JsonValueKind.String)
                    {
                        var kind = cell.Value.TryGetProperty(BlobKindMarker, out var kindElement) && kindElement.ValueKind == JsonValueKind.String ? kindElement.GetString() : null;
                        references.Add((hash.GetString()!, kind));
                    }
                }
            }
        }

        return references;
    }

    /// <summary>
    /// Turn a failed upload response into an exception that names the failure.
    /// </summary>
    /// <param name="response">The response.</param>
    /// <param name="what">What was uploaded, for the message.</param>
    /// <returns>Task.</returns>
    private static async Task EnsureUploadSucceededAsync(HttpResponseMessage response, string what)
    {
        if (response.StatusCode == HttpStatusCode.RequestEntityTooLarge)
        {
            throw new VaultTooLargeException();
        }

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync();
            throw new HttpRequestException($"{what} failed with HTTP {(int)response.StatusCode}: {body}", null, response.StatusCode);
        }
    }

    /// <summary>
    /// The domains the server hosts mail for; addresses outside them are never claimed.
    /// </summary>
    /// <returns>The domains.</returns>
    private List<string> PrivateEmailDomains()
    {
        // "DISABLED.TLD" was a placeholder used before 0.22.0 that has been replaced by an empty string. TODO: remove in a future release.
        return config.PrivateEmailDomains.Where(domain => !string.IsNullOrWhiteSpace(domain) && !string.Equals(domain, "DISABLED.TLD", StringComparison.OrdinalIgnoreCase)).ToList();
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
    /// Record which manifests a snapshot served, before any of them is opened: it is the authority for held access.
    /// </summary>
    /// <param name="snapshot">The raw snapshot.</param>
    private void RecordServedManifests(GetResponse snapshot)
    {
        state.LastServedManifestIds.Clear();
        state.LastServedManifestIds.AddRange(snapshot.Manifests.Select(m => m.ManifestId));
        state.LastSnapshotWasLegacySqliteBlob = snapshot.StorageFormat != StorageFormat.Manifest;
    }

    /// <summary>
    /// Record a personal manifest that exists but was never written: its id and revision are the baseline the first push rebases on.
    /// </summary>
    /// <param name="personalDto">The personal manifest.</param>
    private void RecordEmptyPersonalManifest(Manifest personalDto)
    {
        state.PersonalManifestId = personalDto.ManifestId;
        state.ContentFingerprints.Clear();
        state.SharedManifests.Clear();
        state.BucketRevisions.Clear();
        state.ManifestRevisions.Clear();
        state.ManifestRevisions[personalDto.ManifestId] = personalDto.Revision;
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
        return new PullResult { Kind = PullKind.LegacySqliteBlob, LegacyVaultBlob = snapshot.LegacyVaultBlob ?? string.Empty, LegacyVersion = snapshot.Version ?? string.Empty };
    }

    /// <summary>
    /// Open every manifest a snapshot carries (the personal one plus each shared one) and record the snapshot as this device's sync state.
    /// </summary>
    /// <param name="snapshot">The raw snapshot.</param>
    /// <param name="personalDto">The caller's own manifest.</param>
    /// <returns>The opened set.</returns>
    private async Task<OpenedManifestSet> OpenManifestsAndRecordSyncStateAsync(GetResponse snapshot, Manifest personalDto)
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

        // 3) Record the snapshot as local truth.
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

        logger.LogInformation("[V2Pull] Recorded revisions of {ManifestCount} manifest(s) and {BucketCount} bucket(s); {FingerprintCount} fingerprint baseline(s) stored.", state.ManifestRevisions.Count, state.BucketRevisions.Count, state.ContentFingerprints.Count);
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
    /// The merge core: run the Rust canonical merge of the local side against the manifests just opened, validate the
    /// result per manifest (the server's copy stands for one that fails), and materialize it.
    /// </summary>
    /// <param name="opened">The opened server manifests, the merge base.</param>
    /// <param name="serverBlobs">The plaintext blobs the server manifests reference.</param>
    /// <param name="local">The canonicalized local vault, the incoming side.</param>
    /// <returns>The merged result.</returns>
    private async Task<PullAndMergeResult> MergeOntoOpenedManifestsAsync(OpenedManifestSet opened, Dictionary<string, byte[]> serverBlobs, CanonicalizedVault local)
    {
        logger.LogInformation("[V2Merge] Merging {Local} local manifest(s) onto {Server} server manifest(s)...", local.Manifests.Count, opened.Resolved.Count);
        var mergeOutputJson = await rustCoreService.MergeCanonicalAsync(BuildMergeInput(opened, local, await GetSchemaColumnsAsync()));

        var serverManifestById = opened.Resolved.ToDictionary(entry => entry.ManifestId, entry => entry.ManifestJson);
        var serverBucketsById = new Dictionary<Guid, List<string>>();
        foreach (var bucketJson in opened.DataBuckets)
        {
            var owner = ReadPayloadHeader(bucketJson).ManifestId ?? Guid.Empty;
            serverBucketsById.TryAdd(owner, []);
            serverBucketsById[owner].Add(bucketJson);
        }

        var contentless = new HashSet<Guid>(opened.ContentlessManifestIds);
        var manifestJsons = new List<(Guid ManifestId, string Json)>();
        var bucketJsons = new List<string>();
        var fallbackManifestIds = new List<Guid>();
        var droppedLocalManifestIds = new List<Guid>();
        using (var document = JsonDocument.Parse(mergeOutputJson))
        {
            var root = document.RootElement;
            foreach (var entry in root.GetProperty("manifests").EnumerateArray())
            {
                var manifestId = Guid.Parse(entry.GetProperty("manifestId").GetString()!);
                var manifestJson = entry.GetProperty("manifest").GetRawText();
                var mergedBuckets = entry.TryGetProperty("buckets", out var buckets) && buckets.ValueKind == JsonValueKind.Array ? buckets.EnumerateArray().Select(bucket => bucket.GetRawText()).ToList() : [];
                var failure = await ValidateMergedManifestAsync(manifestJson, mergedBuckets);
                if (failure is not null && !contentless.Contains(manifestId))
                {
                    logger.LogWarning("[V2Merge] Merged manifest {ManifestId} failed validation ({Failure}); the server's version stands and local changes to it are dropped.", manifestId, failure);
                    fallbackManifestIds.Add(manifestId);
                    if (serverManifestById.TryGetValue(manifestId, out var serverJson))
                    {
                        manifestJsons.Add((manifestId, serverJson));
                        bucketJsons.AddRange(serverBucketsById.GetValueOrDefault(manifestId, []));
                    }

                    continue;
                }

                if (failure is not null)
                {
                    // A contentless pass-through has no server base to fall back to; keep the local rows, the push gate decides.
                    logger.LogWarning("[V2Merge] Pass-through manifest {ManifestId} failed validation ({Failure}); keeping its local rows.", manifestId, failure);
                }

                manifestJsons.Add((manifestId, manifestJson));
                bucketJsons.AddRange(mergedBuckets);
                if (entry.TryGetProperty("stats", out var stats))
                {
                    logger.LogInformation("[V2Merge] Manifest {ManifestId}: {Stats}", manifestId, stats.GetRawText());
                }
            }

            if (root.TryGetProperty("droppedLocalManifestIds", out var dropped) && dropped.ValueKind == JsonValueKind.Array)
            {
                foreach (var id in dropped.EnumerateArray())
                {
                    if (Guid.TryParse(id.GetString(), out var droppedId))
                    {
                        droppedLocalManifestIds.Add(droppedId);
                        logger.LogWarning("[V2Merge] Local manifest {ManifestId} is no longer served; its rows are dropped from the merged vault.", droppedId);
                    }
                }
            }
        }

        // Blob bytes for materialize: the server download plus everything the local canonicalize extracted.
        var blobMap = new Dictionary<string, byte[]>(serverBlobs, StringComparer.Ordinal);
        foreach (var manifest in local.Manifests)
        {
            foreach (var (hash, blob) in manifest.Blobs)
            {
                blobMap.TryAdd(hash, blob.Bytes);
            }
        }

        var personalManifestId = opened.Resolved[0].ManifestId;
        foreach (var (manifestId, manifestJson) in manifestJsons)
        {
            foreach (var (hash, kind) in BlobReferencesOf(manifestJson))
            {
                if (blobMap.ContainsKey(hash))
                {
                    continue;
                }

                if (manifestId == personalManifestId && string.Equals(kind, AttachmentBlobCategory, StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidOperationException($"The merged vault references attachment blob {hash} with no bytes available, refusing to materialize an incomplete vault.");
                }

                logger.LogWarning("[V2Merge] Merged {Kind} blob {Hash} has no bytes available; it will materialize as empty.", kind ?? "blob", hash);
            }
        }

        var database = await MaterializeAsync(manifestJsons.Select(entry => entry.Json), bucketJsons, blobMap);
        logger.LogInformation("[V2Merge] Canonical merge complete: {Fallbacks} validation fallback(s), {Dropped} dropped local manifest(s).", fallbackManifestIds.Count, droppedLocalManifestIds.Count);
        return new PullAndMergeResult { Kind = PullAndMergeKind.Merged, Database = database, FallbackManifestIds = fallbackManifestIds, DroppedLocalManifestIds = droppedLocalManifestIds };
    }

    /// <summary>
    /// Validate one merged manifest and its buckets.
    /// </summary>
    /// <param name="manifestJson">The merged manifest.</param>
    /// <param name="bucketJsons">Its merged buckets.</param>
    /// <returns>The failed rules, or null when valid.</returns>
    private async Task<string?> ValidateMergedManifestAsync(string manifestJson, List<string> bucketJsons)
    {
        var validation = await rustCoreService.VaultCodecValidateManifestAsync(manifestJson);
        if (!validation.Ok)
        {
            return string.Join(", ", validation.FailedRules);
        }

        foreach (var bucketJson in bucketJsons)
        {
            var bucketValidation = await rustCoreService.VaultCodecValidateDataBucketAsync(bucketJson);
            if (!bucketValidation.Ok)
            {
                return $"bucket \"{ReadPayloadHeader(bucketJson).Category}\": {string.Join(", ", bucketValidation.FailedRules)}";
            }
        }

        return null;
    }

    /// <summary>
    /// Canonicalize the local vault into the manifest-v1 format against every manifest this vault writes, routing each
    /// row into its own manifest by the ManifestId it carries.
    /// </summary>
    /// <param name="connection">The local vault.</param>
    /// <param name="personalVek">The key the personal manifest encrypts with.</param>
    /// <param name="adoptUnstampedInto">One-time migration only: the manifest rows without a stamp are adopted into.</param>
    /// <returns>The canonicalized vault, personal manifest first.</returns>
    private async Task<CanonicalizedVault> CanonicalizeAsync(SqliteConnection connection, string personalVek, Guid? adoptUnstampedInto)
    {
        var records = await ResolveManifestRecordsAsync(connection, personalVek);
        var tablesJson = await VaultTableReader.ReadTablesAsCodecJsonAsync(connection);

        string inputJson;
        using (var stream = new MemoryStream())
        {
            using (var writer = new Utf8JsonWriter(stream))
            {
                writer.WriteStartObject();
                writer.WritePropertyName("tables");
                writer.WriteRawValue(tablesJson, skipInputValidation: true);
                writer.WriteString("canonicalizedAt", DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", System.Globalization.CultureInfo.InvariantCulture));
                writer.WriteStartArray("manifests");
                foreach (var record in records)
                {
                    writer.WriteStartObject();
                    writer.WriteString("manifestId", record.ManifestId.ToString());
                    writer.WriteString("manifestSalt", record.Salt);
                    if (record.Name is not null)
                    {
                        writer.WriteString("name", record.Name);
                    }

                    writer.WriteEndObject();
                }

                writer.WriteEndArray();
                if (adoptUnstampedInto is { } adoptInto)
                {
                    writer.WriteString("adoptUnstampedInto", adoptInto.ToString());
                }

                writer.WriteEndObject();
            }

            inputJson = Encoding.UTF8.GetString(stream.ToArray());
        }

        var outputJson = await rustCoreService.VaultCodecCanonicalizeFromSqliteAsync(inputJson);
        return ParseCanonicalized(outputJson, records);
    }

    /// <summary>
    /// Read the codec's canonicalize output into the shapes the push works with.
    /// </summary>
    /// <param name="outputJson">The CanonicalizedVault JSON.</param>
    /// <param name="records">The records the vault was split against.</param>
    /// <returns>The canonicalized vault.</returns>
    private CanonicalizedVault ParseCanonicalized(string outputJson, List<ManifestRecord> records)
    {
        using var document = JsonDocument.Parse(outputJson);
        var root = document.RootElement;
        var manifests = new List<CanonicalizedManifest>();
        foreach (var entry in root.GetProperty("manifests").EnumerateArray())
        {
            var manifest = entry.GetProperty("manifest");
            var manifestId = Guid.Parse(manifest.GetProperty("manifestId").GetString()!);
            var record = records.FirstOrDefault(candidate => candidate.ManifestId == manifestId);
            if (record is null)
            {
                logger.LogWarning("[V2Push] Canonicalize produced manifest {ManifestId}, which is not in the write set; leaving it out.", manifestId);
                continue;
            }

            var itemCount = manifest.TryGetProperty("tables", out var tables) && tables.TryGetProperty("Items", out var items) && items.ValueKind == JsonValueKind.Array ? items.GetArrayLength() : 0;
            var blobs = new Dictionary<string, CanonicalizedBlob>(StringComparer.Ordinal);
            if (entry.TryGetProperty("blobs", out var blobsElement) && blobsElement.ValueKind == JsonValueKind.Object)
            {
                foreach (var blob in blobsElement.EnumerateObject())
                {
                    blobs[blob.Name] = new CanonicalizedBlob(blob.Value.GetProperty("kind").GetString() ?? string.Empty, blob.Value.GetProperty("bytesBase64").GetBytesFromBase64());
                }
            }

            manifests.Add(new CanonicalizedManifest(record, manifest.GetRawText(), itemCount, blobs));
        }

        var buckets = new List<CanonicalizedBucket>();
        if (root.TryGetProperty("dataBuckets", out var dataBuckets) && dataBuckets.ValueKind == JsonValueKind.Array)
        {
            foreach (var bucket in dataBuckets.EnumerateArray())
            {
                buckets.Add(new CanonicalizedBucket(Guid.Parse(bucket.GetProperty("manifestId").GetString()!), bucket.GetProperty("category").GetString() ?? string.Empty, bucket.GetRawText()));
            }
        }

        return new CanonicalizedVault(manifests, buckets);
    }

    /// <summary>
    /// Resolve every manifest this vault can write, personal manifest first.
    /// </summary>
    /// <param name="connection">The local vault.</param>
    /// <param name="personalVek">The key the personal manifest encrypts with.</param>
    /// <returns>The records.</returns>
    private async Task<List<ManifestRecord>> ResolveManifestRecordsAsync(SqliteConnection connection, string personalVek)
    {
        var personalManifestId = state.PersonalManifestId ?? throw new InvalidOperationException("No personal manifest id is recorded; pull once before pushing.");
        state.PersonalManifestSalt ??= await rustCoreService.VaultCodecGenerateManifestSaltAsync();

        var opened = state.SharedManifests.Values.Where(record => !string.IsNullOrEmpty(record.VaultEncryptionKey)).ToList();
        var request = new
        {
            personalManifestId = personalManifestId.ToString(),
            personalManifestSalt = state.PersonalManifestSalt,
            stampedManifestIds = (await VaultTableReader.ManifestIdsInVaultAsync(connection)).ToList(),
            openedManifestIds = opened.Select(record => record.ManifestId.ToString()).ToList(),
            heldRecords = state.SharedManifests.Values.Select(record => new { manifestId = record.ManifestId.ToString(), salt = record.Salt, name = record.Name, canAdminister = record.CanAdminister }).ToList(),
            displayNames = await VaultTableReader.ReadDisplayNamesAsync(connection),
        };

        var writeSetJson = await rustCoreService.VaultSharingResolveManifestWriteSetAsync(JsonSerializer.Serialize(request));
        using var document = JsonDocument.Parse(writeSetJson);
        var root = document.RootElement;
        if (root.TryGetProperty("skipped", out var skipped) && skipped.ValueKind == JsonValueKind.Array)
        {
            foreach (var entry in skipped.EnumerateArray())
            {
                logger.LogInformation("[V2Push] Shared manifest {ManifestId} is left out of the write: {Reason}.", entry.GetProperty("manifestId").GetString(), entry.GetProperty("reason").GetString());
            }
        }

        var records = new List<ManifestRecord>();
        foreach (var entry in root.GetProperty("records").EnumerateArray())
        {
            var manifestId = Guid.Parse(entry.GetProperty("manifestId").GetString()!);
            var isPersonal = entry.GetProperty("isPersonal").GetBoolean();
            var name = entry.TryGetProperty("name", out var nameElement) && nameElement.ValueKind == JsonValueKind.String ? nameElement.GetString() : null;
            var canAdminister = entry.TryGetProperty("canAdminister", out var adminElement) && adminElement.ValueKind == JsonValueKind.True;
            var vek = isPersonal ? personalVek : state.SharedManifests.GetValueOrDefault(manifestId)?.VaultEncryptionKey;
            if (string.IsNullOrEmpty(vek))
            {
                throw new InvalidOperationException($"Manifest {manifestId} is in the write set without a key, refusing to write it.");
            }

            records.Add(new ManifestRecord(manifestId, isPersonal, entry.GetProperty("salt").GetString()!, vek, name, canAdminister));
        }

        return records;
    }

    /// <summary>
    /// The manifests the local vault holds rows for that this session cannot write.
    /// </summary>
    /// <param name="connection">The local vault.</param>
    /// <param name="personalManifestId">The caller's own manifest.</param>
    /// <returns>The manifest ids, empty when the vault and the session agree.</returns>
    private async Task<List<string>> FindUnwritableManifestsAsync(SqliteConnection connection, Guid personalManifestId)
    {
        var writable = state.SharedManifests.Values.Where(record => !string.IsNullOrEmpty(record.VaultEncryptionKey)).Select(record => record.ManifestId.ToString()).Append(personalManifestId.ToString()).ToList();
        var request = new
        {
            manifestIdsInVault = (await VaultTableReader.ManifestIdsInVaultAsync(connection)).ToList(),
            writableManifestIds = writable,
            grantedManifestIds = Array.Empty<string>(),
        };

        var partitionJson = await rustCoreService.VaultSharingPartitionManifestAccessAsync(JsonSerializer.Serialize(request));
        using var document = JsonDocument.Parse(partitionJson);
        return document.RootElement.TryGetProperty("unwritable", out var unwritable) && unwritable.ValueKind == JsonValueKind.Array ? unwritable.EnumerateArray().Select(id => id.GetString() ?? string.Empty).ToList() : [];
    }

    /// <summary>
    /// Ask the server which of the given blobs it does not hold.
    /// </summary>
    /// <param name="hashes">The candidate hashes.</param>
    /// <returns>The hashes unknown to the server.</returns>
    private async Task<List<string>> MissingOnServerAsync(IEnumerable<string> hashes)
    {
        var candidates = hashes.ToList();
        if (candidates.Count == 0)
        {
            return [];
        }

        using var response = await httpClient.PostAsJsonAsync(BlobsMissingEndpoint, new BlobHashesRequest { Hashes = candidates });
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<MissingBlobsResponse>();
        return body?.Missing ?? [];
    }

    /// <summary>
    /// Encrypt the given blobs, each with the key of the manifest that owns it, and upload them in size-capped batches
    /// ahead of the manifest write.
    /// </summary>
    /// <param name="entries">Every staged blob, by hash.</param>
    /// <param name="hashes">The subset to upload.</param>
    /// <param name="overwrite">Ask the server to replace the ciphertext of blobs it already has (the migration re-keys them).</param>
    /// <param name="uploaded">Receives the uploaded ciphertext per hash, for the local cipher cache.</param>
    /// <returns>Task.</returns>
    private async Task UploadBlobsAsync(Dictionary<string, UploadBlobEntry> entries, IEnumerable<string> hashes, bool overwrite, Dictionary<string, string> uploaded)
    {
        var batch = new List<Blob>();
        var batchChars = 0;
        foreach (var hash in hashes)
        {
            if (!entries.TryGetValue(hash, out var entry))
            {
                continue;
            }

            var ciphertext = Convert.ToBase64String(await jsInteropService.SymmetricEncryptBytes(entry.Bytes, Convert.FromBase64String(entry.VaultEncryptionKey)));
            uploaded[hash] = ciphertext;

            // Flush before adding when this blob would take the request past either bound.
            if (batch.Count > 0 && (batchChars + ciphertext.Length > BlobTransferBatchMaxChars || batch.Count >= BlobTransferBatchMaxCount))
            {
                await PostBlobBatchAsync(batch, overwrite);
                batch = [];
                batchChars = 0;
            }

            batch.Add(new Blob { Hash = hash, Category = entry.Kind, EncryptedDataBase64 = ciphertext });
            batchChars += ciphertext.Length;
        }

        if (batch.Count > 0)
        {
            await PostBlobBatchAsync(batch, overwrite);
        }
    }

    /// <summary>
    /// Upload one batch of encrypted blobs.
    /// </summary>
    /// <param name="batch">The blobs.</param>
    /// <param name="overwrite">Whether the server replaces ciphertext it already holds.</param>
    /// <returns>Task.</returns>
    private async Task PostBlobBatchAsync(List<Blob> batch, bool overwrite)
    {
        logger.LogInformation("[V2Push] Uploading blob batch: {Count} blob(s).", batch.Count);
        using var response = await httpClient.PostAsJsonAsync(BlobsEndpoint, new BlobUploadRequest { Blobs = batch, Overwrite = overwrite });
        await EnsureUploadSucceededAsync(response, "Blob upload");
    }

    /// <summary>
    /// POST the unified vault write.
    /// </summary>
    /// <param name="request">The write.</param>
    /// <returns>The server's response.</returns>
    private async Task<VaultWriteResponse> PostWriteAsync(VaultWriteRequest request)
    {
        using var response = await httpClient.PostAsJsonAsync(VaultEndpoint, request);
        await EnsureUploadSucceededAsync(response, "Vault write");
        return await response.Content.ReadFromJsonAsync<VaultWriteResponse>() ?? throw new InvalidOperationException("Empty vault write response.");
    }

    /// <summary>
    /// Materialize manifests and data buckets into a fresh in-memory SQLite database via the codec.
    /// </summary>
    /// <param name="manifestJsons">The manifests, the caller's own first.</param>
    /// <param name="bucketJsons">The data buckets belonging to those manifests.</param>
    /// <param name="blobs">Plaintext bytes for every blob hash the manifests reference.</param>
    /// <returns>The open database connection; the caller owns it.</returns>
    private async Task<SqliteConnection> MaterializeAsync(IEnumerable<string> manifestJsons, IEnumerable<string> bucketJsons, Dictionary<string, byte[]> blobs)
    {
        var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        try
        {
            await VaultMaterializer.ApplySchemaAsync(connection, await GetSchemaSqlAsync());

            // The local schema's column set routes anything a newer writer stored into the overflow carrier instead of crashing the insert.
            var inputJson = BuildMaterializeInput(manifestJsons, bucketJsons, await GetSchemaColumnsAsync());
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

    /// <summary>
    /// The complete client schema, read once.
    /// </summary>
    /// <returns>The COMPLETE_SCHEMA_SQL script.</returns>
    private async Task<string> GetSchemaSqlAsync()
    {
        return _schemaSql ??= await jsInteropService.GetCompleteSchemaSqlAsync();
    }

    /// <summary>
    /// The column set of the complete client schema, per table, read once from a scratch database.
    /// </summary>
    /// <returns>Column names per table.</returns>
    private async Task<Dictionary<string, List<string>>> GetSchemaColumnsAsync()
    {
        if (_schemaColumns is not null)
        {
            return _schemaColumns;
        }

        await using var scratch = new SqliteConnection("Data Source=:memory:");
        await scratch.OpenAsync();
        await VaultMaterializer.ApplySchemaAsync(scratch, await GetSchemaSqlAsync());
        _schemaColumns = await VaultMaterializer.ReadSchemaColumnsAsync(scratch);
        return _schemaColumns;
    }

    /// <summary>
    /// A plaintext blob staged for upload: its bytes plus the key that encrypts it.
    /// </summary>
    /// <param name="Kind">The blob kind.</param>
    /// <param name="Bytes">The plaintext bytes.</param>
    /// <param name="VaultEncryptionKey">The key of the manifest that owns it.</param>
    /// <param name="FromPersonal">Whether the personal manifest owns it.</param>
    private sealed record UploadBlobEntry(string Kind, byte[] Bytes, string VaultEncryptionKey, bool FromPersonal);
}
