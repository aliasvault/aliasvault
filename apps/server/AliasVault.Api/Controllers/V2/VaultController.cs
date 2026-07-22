//-----------------------------------------------------------------------
// <copyright file="VaultController.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.V2;

using AliasServerDb;
using AliasVault.Api.Controllers.Abstracts;
using AliasVault.Api.Helpers;
using AliasVault.Api.Services;
using AliasVault.Api.Vault;
using AliasVault.Api.Vault.RetentionRules;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi;
using AliasVault.Shared.Models.WebApi.V2.Vault;
using AliasVault.Shared.Providers.Time;
using Asp.Versioning;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Vault v2 controller. This controller implements the manifest-v1 storage format with separate encrypted manifest,
/// metadata, and content-addressed blob storage.
/// </summary>
/// <param name="logger">ILogger instance.</param>
/// <param name="dbContextFactory">DbContext factory.</param>
/// <param name="userManager">UserManager.</param>
/// <param name="timeProvider">Time provider.</param>
/// <param name="config">Server config.</param>
/// <param name="rateLimitService">RateLimitService instance.</param>
[ApiVersion("2")]

public class VaultController(
    ILogger<VaultController> logger,
    IAliasServerDbContextFactory dbContextFactory,
    UserManager<AliasVaultUser> userManager,
    ITimeProvider timeProvider,
    Config config,
    RateLimitService rateLimitService) : AuthenticatedRequestController(userManager)
{
    private const string ManifestFormat = "manifest-v1";
    private const string LegacyFormat = "sqlite-blob";

    private readonly RetentionPolicy _retentionPolicy = new()
    {
        Rules =
        [
            new RevisionRetentionRule { RevisionsToKeep = 3 },
            new DailyRetentionRule { DaysToKeep = 2 },
            new WeeklyRetentionRule { WeeksToKeep = 1 },
            new MonthlyRetentionRule { MonthsToKeep = 1 },
            new DbVersionRetentionRule { VersionsToKeep = 2 },
            new LoginCredentialRetentionRule { CredentialsToKeep = 2 },
        ],
    };

    /// <summary>
    /// Status endpoint. Tells the client which storage format the server has for this user so the client can
    /// pick the v1 (legacy) or v2 (new) sync path.
    /// </summary>
    /// <returns>Status DTO.</returns>
    [HttpGet("status")]
    public async Task<IActionResult> Status()
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return Unauthorized();
        }

        // Current revision per logical manifest.
        var manifestRevisions = await context.VaultManifests
            .Where(x => x.OwnerUserId == user.Id && x.StorageFormat == ManifestFormat)
            .Select(x => new ManifestRevision { ManifestId = x.ManifestId, IsRoot = x.IsRoot, Revision = x.RevisionNumber })
            .ToListAsync();

        // Migration status is judged solely by the user's own root manifest. A shared-with-me manifest (always
        // IsRoot=false, owned by another user) must never make a not-yet-migrated user look migrated, or the client
        // would push without CreateVaultKey and the upload would fail with VAULT_KEY_NOT_FOUND.
        var isMigrated = ownedManifestRevisions.Any(x => x.IsRoot);
        // Latest revision per bucket kind.
        var bucketRevisions = await context.VaultDataBuckets
            .Where(x => x.OwnerUserId == user.Id)
            .GroupBy(x => x.Category)
            .Select(g => new BucketRevision { Category = g.Key, Revision = g.Max(b => b.RevisionNumber) })
            .ToListAsync();

        return Ok(new StatusResponse
        {
            StorageFormat = isMigrated ? StorageFormat.Manifest : StorageFormat.SqliteBlob,
            ManifestRevisions = manifestRevisions,
            BucketRevisions = bucketRevisions,
        });
    }

    /// <summary>
    /// Atomic snapshot. Returns the latest encrypted manifest + metadata + blob refs + email routing in one shot.
    /// Convenient for fresh client init.
    /// </summary>
    /// <returns>Snapshot DTO.</returns>
    [HttpGet("")]
    public async Task<IActionResult> Get()
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return Unauthorized();
        }

        var emailRouting = await BuildEmailRoutingAsync(context, user);

        // Current revision per logical manifest (one row per manifest in the VaultManifests table).
        var latestManifests = await context.VaultManifests
            .Where(x => x.OwnerUserId == user.Id && x.StorageFormat == ManifestFormat)
            .Select(x => new { x.ManifestId, x.IsRoot, x.ManifestBlob, x.ManifestCiphertextHash, x.RevisionNumber })
            .ToListAsync();

        if (latestManifests.Count == 0)
        {
            // User hasn't migrated to manifest-v1 yet. Rather than forcing the client onto the v1 endpoint (which
            // would round-trip through the 426 guard), we serve the latest legacy SQLite blob from here with a
            // "sqlite-blob" discriminator. A v2-capable client takes it as-is and upgrades its schema locally;
            // it migrates to manifest-v1 on its next save. Brand-new users with no vault get an empty blob.
            var legacy = await context.VaultManifests
                .Where(x => x.OwnerUserId == user.Id)
                .OrderByDescending(x => x.RevisionNumber)
                .FirstOrDefaultAsync();

            return Ok(new GetResponse
            {
                Status = VaultStatus.Ok,
                StorageFormat = StorageFormat.SqliteBlob,
                LegacyVaultBlob = legacy?.VaultBlob ?? string.Empty,
                Version = legacy?.Version ?? string.Empty,
                LegacyRevision = legacy?.RevisionNumber ?? 0,
                EmailRouting = emailRouting,
            });
        }

        // Latest revision per bucket kind: keep only rows whose RevisionNumber equals the max for their kind.
        var buckets = await context.VaultDataBuckets
            .Where(x => x.OwnerUserId == user.Id
                && x.RevisionNumber == context.VaultDataBuckets
                    .Where(y => y.OwnerUserId == user.Id && y.Category == x.Category)
                    .Max(y => y.RevisionNumber))
            .Select(x => new Bucket
            {
                Category = x.Category,
                Blob = x.EncryptedData,
                CiphertextHash = x.CiphertextHash,
                Revision = x.RevisionNumber,
            })
            .ToListAsync();

        // Blob references are scoped per manifest revision. Fetch them for all manifests in one query, then keep
        // only the refs belonging to each manifest's current revision (older refs belong to history revisions).
        var manifestIds = latestManifests.Select(m => m.ManifestId).ToList();
        var currentRevisionByManifest = latestManifests.ToDictionary(m => m.ManifestId, m => m.RevisionNumber);
        var refsByManifest = (await context.VaultBlobReferences
                .Where(r => manifestIds.Contains(r.ManifestId))
                .Join(
                    context.VaultBlobObjects.Where(b => b.OwnerUserId == user.Id),
                    r => r.BlobHash,
                    b => b.Hash,
                    (r, b) => new { r.ManifestId, r.RevisionNumber, b.Hash, b.Category })
                .ToListAsync())
            .Where(x => currentRevisionByManifest.TryGetValue(x.ManifestId, out var rev) && rev == x.RevisionNumber)
            .GroupBy(x => x.ManifestId)
            .ToDictionary(g => g.Key, g => g.Select(x => new BlobReference { Hash = x.Hash, Category = x.Category }).ToList());

        var manifests = latestManifests.Select(m => new Manifest
        {
            ManifestId = m.ManifestId,
            IsRoot = m.IsRoot,
            Blob = m.ManifestBlob,
            CiphertextHash = m.ManifestCiphertextHash,
            Revision = m.RevisionNumber,
            BlobReferences = refsByManifest.TryGetValue(m.ManifestId, out var refs) ? refs : [],
        }).ToList();

        return Ok(new GetResponse
        {
            Status = VaultStatus.Ok,
            StorageFormat = StorageFormat.Manifest,
            Manifests = manifests,
            Buckets = buckets,
            EmailRouting = emailRouting,
        });
    }

    /// <summary>
    /// Single-manifest fetch. Returns the latest revision of one logical manifest (by ManifestId) plus its blob
    /// references, without the rest of the snapshot. Lets a client incrementally refresh just one manifest (e.g. a
    /// single shared folder) instead of re-pulling the whole vault. The bundled <see cref="Get"/> stays the
    /// one-round-trip path for fresh init.
    /// </summary>
    /// <param name="manifestId">The stable identifier of the logical manifest to fetch.</param>
    /// <returns>The manifest DTO, or 404 when the user has no such manifest-v1 manifest.</returns>
    [HttpGet("manifest/{manifestId:guid}")]
    public async Task<IActionResult> GetManifest(Guid manifestId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return Unauthorized();
        }

        var latest = await context.VaultManifests
            .Where(x => x.OwnerUserId == user.Id && x.StorageFormat == ManifestFormat && x.ManifestId == manifestId)
            .FirstOrDefaultAsync();

        if (latest == null)
        {
            return NotFound();
        }

        var blobRefs = await context.VaultBlobReferences
            .Where(r => r.ManifestId == latest.ManifestId && r.RevisionNumber == latest.RevisionNumber)
            .Join(
                context.VaultBlobObjects.Where(b => b.OwnerUserId == user.Id),
                r => r.BlobHash,
                b => b.Hash,
                (r, b) => new BlobReference { Hash = b.Hash, Category = b.Category })
            .ToListAsync();

        return Ok(new Manifest
        {
            ManifestId = latest.ManifestId,
            IsRoot = latest.IsRoot,
            Blob = latest.ManifestBlob,
            CiphertextHash = latest.ManifestCiphertextHash,
            Revision = latest.RevisionNumber,
            BlobReferences = blobRefs,
        });
    }

    /// <summary>
    /// Atomic upload. Inserts any new blobs, validates every referenced hash exists, archives the current manifest
    /// revision into history, updates the current manifest row in place, adds blob references, optionally upserts
    /// metadata, optionally syncs email routing, all in a single DB transaction on purpose.
    /// </summary>
    /// <param name="model">Upload request DTO.</param>
    /// <param name="clientHeader">Client header.</param>
    /// <returns>Upload response DTO.</returns>
    [HttpPost("")]
    public async Task<IActionResult> Upload(
        [FromBody] UploadRequest model,
        [FromHeader(Name = "X-AliasVault-Client")] string? clientHeader)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return Unauthorized();
        }

        if (!string.Equals(user.UserName, model.Username, StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.USERNAME_MISMATCH, 400));
        }

        // The v2 upload targets the user's root manifest. Registration guarantees a root manifest row exists.
        var currentManifest = await context.VaultManifests.FirstOrDefaultAsync(x => x.OwnerUserId == user.Id && x.IsRoot);
        if (currentManifest == null)
        {
            // No root manifest exists yet. TODO: test v2 registration flow to ensure this ensures a vault record always is created during registration.
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_NOT_UP_TO_DATE, 400));
        }

        // Optimistic concurrency against the single monotonic RevisionNumber counter, which is shared across
        // legacy ("sqlite-blob") and "manifest-v1" revisions. A migrating client sends the legacy revision it last
        // synced as CurrentManifestRevision, so the first manifest-v1 revision continues the sequence (e.g. legacy
        // 50 --> manifest-v1 51) rather than resetting to 1 and sorting below the legacy revisions.
        var serverRevision = currentManifest.RevisionNumber;
        var newManifestRevision = model.CurrentManifestRevision + 1;
        if (serverRevision >= newManifestRevision)
        {
            return Ok(new UploadResponse
            {
                Status = VaultStatus.Outdated,
                NewManifestRevision = serverRevision,
            });
        }

        // Sanity check if user already has a vault key (when providing vault key creation request).
        var hasExistingVaultKey = await context.VaultKeys.AnyAsync(x => x.UserId == user.Id && x.KeyType == AuthHelper.VaultKeyTypePassword);
        if (model.CreateVaultKey != null && hasExistingVaultKey)
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_KEY_ALREADY_EXISTS, 400));
        }

        // Sanity check that the user has a vault key (when not providing vault key creation request).
        // TODO: remove this guard once every user has migrated to the KEK/VEK model (no keyless users remain).
        if (model.CreateVaultKey == null && !hasExistingVaultKey)
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_KEY_NOT_FOUND, 400));
        }

        // The DbContext uses a retrying execution strategy (EnableRetryOnFailure), which forbids user-initiated
        // transactions unless the whole unit runs inside the strategy so it can be retried atomically.
        var strategy = context.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync<IActionResult>(async () =>
        {
            await using var tx = await context.Database.BeginTransactionAsync();

            // 1) Upsert any new blob objects.
            if (model.NewBlobs.Count > 0)
            {
                if (!await TryUpsertBlobObjectsAsync(context, user.Id, model.NewBlobs, overwrite: model.CreateVaultKey != null))
                {
                    return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_NOT_UP_TO_DATE, 400));
                }

                await context.SaveChangesAsync();
            }

            // 2) Validate every referenced hash exists for this user. If any missing, abort and tell the client which.
            if (model.BlobReferences.Count > 0)
            {
                var refHashes = model.BlobReferences.Select(r => r.Hash).Distinct().ToList();
                var presentHashes = await context.VaultBlobObjects
                    .Where(b => b.OwnerUserId == user.Id && refHashes.Contains(b.Hash))
                    .Select(b => b.Hash)
                    .ToListAsync();
                var missing = refHashes.Except(presentHashes).ToList();
                if (missing.Count > 0)
                {
                    await tx.RollbackAsync();
                    return Ok(new UploadResponse
                    {
                        Status = VaultStatus.Ok,
                        NewManifestRevision = serverRevision,
                        MissingBlobHashes = missing,
                    });
                }
            }

            // 3) Archive the current revision into history first, then update the current row in place with the new manifest-v1 revision.
            var archivedRevision = VaultManifestsHistory.CreateFrom(currentManifest);
            context.VaultManifestsHistory.Add(archivedRevision);

            currentManifest.VaultBlob = string.Empty;
            currentManifest.StorageFormat = ManifestFormat;
            currentManifest.ManifestBlob = model.ManifestBlob;
            currentManifest.ManifestCiphertextHash = model.ManifestCiphertextHash;
            currentManifest.Version = model.Version;
            currentManifest.RevisionNumber = newManifestRevision;
            currentManifest.FileSize = FileHelper.Base64StringToKilobytes(model.ManifestBlob);
            currentManifest.CredentialsCount = model.CredentialsCount;
            currentManifest.EmailClaimsCount = model.EmailRouting.EmailAddressList.Count;
            currentManifest.Client = clientHeader;
            currentManifest.CreatedAt = timeProvider.UtcNow;
            currentManifest.UpdatedAt = timeProvider.UtcNow;

            // Create VaultKey row atomically with this upload if provided (migration flow from old v1 encryption flow).
            if (model.CreateVaultKey != null)
            {
                if (model.CreateVaultKey.KeyType != AuthHelper.VaultKeyTypePassword)
                {
                    await tx.RollbackAsync();
                    return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_KEY_NOT_FOUND, 400));
                }

                context.VaultKeys.Add(new VaultKey
                {
                    Id = Guid.NewGuid(),
                    UserId = user.Id,
                    VaultManifestId = currentManifest.ManifestId,
                    KeyType = AuthHelper.VaultKeyTypePassword,
                    WrapScheme = AuthHelper.WrapSchemeAesGcmKek,
                    WrappedVek = model.CreateVaultKey.WrappedVek,
                    Salt = currentManifest.Salt,
                    Verifier = currentManifest.Verifier,
                    EncryptionType = currentManifest.EncryptionType,
                    EncryptionSettings = currentManifest.EncryptionSettings,
                    CreatedAt = timeProvider.UtcNow,
                    UpdatedAt = timeProvider.UtcNow,
                });

                currentManifest.Salt = string.Empty;
                currentManifest.Verifier = string.Empty;
                currentManifest.EncryptionType = string.Empty;
                currentManifest.EncryptionSettings = string.Empty;
            }

            await ApplyVaultRetention(context, currentManifest, archivedRevision);
            await context.SaveChangesAsync();

            // 4) Add blob references for the new revision.
            foreach (var dto in model.BlobReferences)
            {
                context.VaultBlobReferences.Add(new VaultBlobReference
                {
                    ManifestId = currentManifest.ManifestId,
                    RevisionNumber = newManifestRevision,
                    BlobHash = dto.Hash,
                });
            }

            // 5) Optional data bucket upserts (settings, etc.). Each insert adds a new revision row (history).
            var newBucketRevisions = new List<BucketRevision>();
            foreach (var bucket in model.Buckets)
            {
                if (string.IsNullOrEmpty(bucket.Blob))
                {
                    continue;
                }

                var rev = await UpsertBucketAsync(context, user.Id, bucket.Category, bucket.Blob, bucket.CiphertextHash, currentRevision: null);
                newBucketRevisions.Add(new BucketRevision { Category = bucket.Category, Revision = rev });
            }

            // 6) Email routing.
            if (model.EmailRouting.EmailAddressList.Count > 0)
            {
                await UpdateUserEmailClaimsAsync(context, user, model.EmailRouting.EmailAddressList);
            }

            if (!string.IsNullOrEmpty(model.EncryptionPublicKey))
            {
                await UpdateUserPublicKeyAsync(context, user.Id, model.EncryptionPublicKey);
            }

            await context.SaveChangesAsync();
            await tx.CommitAsync();

            return Ok(new UploadResponse
            {
                Status = VaultStatus.Ok,
                NewManifestRevision = newManifestRevision,
                NewBucketRevisions = newBucketRevisions,
            });
        });
    }

    /// <summary>
    /// Single data-bucket upload. For changes to one bucket kind (e.g. settings) that don't touch vault content.
    /// </summary>
    /// <param name="model">Bucket upload request.</param>
    /// <returns>Bucket upload response.</returns>
    [HttpPost("buckets")]
    public async Task<IActionResult> UpdateBucket([FromBody] BucketUploadRequest model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return Unauthorized();
        }

        var currentRev = await context.VaultDataBuckets
            .Where(x => x.OwnerUserId == user.Id && x.Category == model.Category)
            .MaxAsync(x => (long?)x.RevisionNumber) ?? 0;
        var newRev = model.CurrentRevision + 1;
        if (currentRev >= newRev)
        {
            return Ok(new BucketUploadResponse { Status = VaultStatus.Outdated, Category = model.Category, NewRevision = currentRev });
        }

        var stored = await UpsertBucketAsync(context, user.Id, model.Category, model.BucketBlob, model.BucketCiphertextHash, model.CurrentRevision);
        await context.SaveChangesAsync();

        return Ok(new BucketUploadResponse { Status = VaultStatus.Ok, Category = model.Category, NewRevision = stored });
    }

    /// <summary>
    /// Batch-upload encrypted blobs ahead of a manifest upload. Idempotent per blob on (hash, user): re-uploading
    /// an existing blob only bumps its LastReferencedAt so the GC grace period restarts. Clients chunk large blob
    /// sets across multiple calls to keep individual request bodies within server limits. A blob uploaded here but
    /// never referenced by a manifest is swept by the GC after its grace period.
    /// </summary>
    /// <param name="model">Blob upload request.</param>
    /// <returns>Blob upload response.</returns>
    [HttpPost("blobs")]
    public async Task<IActionResult> UploadBlobs([FromBody] BlobUploadRequest model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return Unauthorized();
        }

        if (model.Blobs.Count == 0)
        {
            return Ok(new BlobUploadResponse { AcceptedCount = 0 });
        }

        if (!await TryUpsertBlobObjectsAsync(context, user.Id, model.Blobs, model.Overwrite))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_NOT_UP_TO_DATE, 400));
        }

        await context.SaveChangesAsync();
        return Ok(new BlobUploadResponse { AcceptedCount = model.Blobs.Count });
    }

    /// <summary>
    /// Returns the subset of the supplied hashes the server is missing for this user. Lets a client upload only
    /// the blob bytes the server doesn't already have. POST with a body (not GET with a query string) because a
    /// vault can reference hundreds of 64-char hashes, which would exceed URL length limits.
    /// </summary>
    /// <param name="model">Hash list request.</param>
    /// <returns>Hashes the server lacks.</returns>
    [HttpPost("blobs/missing")]
    public async Task<IActionResult> GetMissingBlobs([FromBody] BlobHashesRequest model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return Unauthorized();
        }

        var hashes = model.Hashes.Distinct().ToList();
        if (hashes.Count == 0)
        {
            return Ok(new MissingBlobsResponse());
        }

        var present = await context.VaultBlobObjects
            .Where(b => b.OwnerUserId == user.Id && hashes.Contains(b.Hash))
            .Select(b => b.Hash)
            .ToListAsync();

        return Ok(new MissingBlobsResponse { Missing = hashes.Except(present).ToList() });
    }

    /// <summary>
    /// Download a batch of encrypted blobs by hash. TODO: Returns base64-encoded payloads in JSON
    /// because for now we kept the codec language-agnostic. Look into switching to multipart binary in the future.
    /// </summary>
    /// <param name="model">Hash list request.</param>
    /// <returns>List of blob DTOs.</returns>
    [HttpPost("blobs/download")]
    public async Task<IActionResult> DownloadBlobs([FromBody] BlobHashesRequest model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return Unauthorized();
        }

        var wanted = model.Hashes.Distinct().ToList();
        if (wanted.Count == 0)
        {
            return Ok(Array.Empty<Blob>());
        }

        var rows = await context.VaultBlobObjects
            .Where(b => b.OwnerUserId == user.Id && wanted.Contains(b.Hash))
            .Select(b => new Blob
            {
                Hash = b.Hash,
                Category = b.Category,
                EncryptedDataBase64 = Convert.ToBase64String(b.EncryptedData),
            })
            .ToListAsync();

        return Ok(rows);
    }

    /// <summary>
    /// Inserts a new revision row for a (user, bucket kind), keeping the prior revisions as history (pruned later
    /// by a retention policy). The new revision is one above the current latest; when no row exists yet it starts
    /// from <paramref name="currentRevision"/> (or 0). Returns the new revision number.
    /// </summary>
    private static async Task<long> UpsertBucketAsync(
        AliasServerDbContext context,
        string userId,
        VaultDataBucketCategory kind,
        string encryptedData,
        string? ciphertextHash,
        long? currentRevision)
    {
        var latestRev = await context.VaultDataBuckets
            .Where(x => x.OwnerUserId == userId && x.Category == kind)
            .MaxAsync(x => (long?)x.RevisionNumber);
        var now = DateTime.UtcNow;
        var newRev = (latestRev ?? currentRevision ?? 0) + 1;

        context.VaultDataBuckets.Add(new VaultDataBucket
        {
            RevisionId = Guid.NewGuid(),
            OwnerUserId = userId,
            Category = kind,
            EncryptedData = encryptedData,
            CiphertextHash = ciphertextHash,
            RevisionNumber = newRev,
            CreatedAt = now,
            UpdatedAt = now,
        });
        return newRev;
    }

    /// <summary>
    /// Upserts a batch of encrypted blob objects for a user in one round-trip. Existing blobs (same hash) only get
    /// their LastReferencedAt bumped, unless <paramref name="overwrite"/> is set (KEK/VEK migration) in which case
    /// their ciphertext is replaced with the re-encrypted bytes. Does not call SaveChanges, the caller owns the
    /// transaction boundary.
    /// </summary>
    /// <param name="context">DbContext to operate on.</param>
    /// <param name="userId">Owning user id.</param>
    /// <param name="blobs">Blobs to upsert.</param>
    /// <param name="overwrite">When true, existing blobs with the same hash get their ciphertext replaced.</param>
    /// <returns>True when every payload is structurally valid; false when any is malformed (caller should 400).</returns>
    private async Task<bool> TryUpsertBlobObjectsAsync(AliasServerDbContext context, string userId, List<Blob> blobs, bool overwrite = false)
    {
        var nowUtc = timeProvider.UtcNow;
        var hashes = blobs.Select(b => b.Hash).Distinct().ToList();
        var existing = await context.VaultBlobObjects
            .Where(b => b.OwnerUserId == userId && hashes.Contains(b.Hash))
            .ToDictionaryAsync(b => b.Hash, StringComparer.Ordinal);

        foreach (var dto in blobs)
        {
            byte[]? data = null;
            if (!existing.TryGetValue(dto.Hash, out var row) || overwrite)
            {
                try
                {
                    data = Convert.FromBase64String(dto.EncryptedDataBase64);
                }
                catch (FormatException)
                {
                    return false;
                }

                if (data.Length < 16)
                {
                    // Anything smaller than IV+tag overhead can't be valid AES-GCM ciphertext, reject the upload.
                    return false;
                }
            }

            if (row != null)
            {
                // Already have it (or a duplicate within this batch), bump LastReferencedAt so GC leaves it alone.
                // During a KEK/VEK migration the stored ciphertext is replaced (same plaintext hash, new key).
                row.LastReferencedAt = nowUtc;
                if (overwrite)
                {
                    row.Category = dto.Category;
                    row.EncryptedData = data!;
                    row.SizeBytes = data!.Length;
                }

                continue;
            }

            var entity = new VaultBlobObject
            {
                Hash = dto.Hash,
                OwnerUserId = userId,
                Category = dto.Category,
                EncryptedData = data!,
                SizeBytes = data!.Length,
                CreatedAt = nowUtc,
                LastReferencedAt = nowUtc,
            };
            context.VaultBlobObjects.Add(entity);
            existing[dto.Hash] = entity;
        }

        return true;
    }

    private async Task<EmailRouting> BuildEmailRoutingAsync(AliasServerDbContext context, AliasVaultUser user)
    {
        var claims = await context.UserEmailClaims
            .Where(c => c.UserId == user.Id && !c.Disabled)
            .Select(c => c.Address)
            .ToListAsync();

        return new EmailRouting
        {
            EmailAddressList = claims,
            PrivateEmailDomainList = config.PrivateEmailDomains,
            HiddenPrivateEmailDomainList = config.HiddenPrivateEmailDomains,
            PublicEmailDomainList = new List<string>
            {
                "spamok.com", "solarflarecorp.com", "spamok.nl", "3060.nl", "landmail.nl",
                "asdasd.nl", "spamok.de", "spamok.com.ua", "spamok.es", "spamok.fr",
            },
        };
    }

    /// <summary>
    /// Applies the retention policy to the history revisions of a manifest and removes the pruned revisions plus
    /// their blob references. Runs after the previous current revision has been archived (passed as
    /// <paramref name="justArchived"/>, still unsaved) and the current row has been updated in place.
    /// </summary>
    private async Task ApplyVaultRetention(AliasServerDbContext context, VaultManifest currentManifest, VaultManifestsHistory justArchived)
    {
        // Load existing history without the (potentially large) blob payload columns; the rules only need metadata.
        var historyRevisions = await context.VaultManifestsHistory
            .Where(x => x.ManifestId == currentManifest.ManifestId)
            .Select(x => new VaultManifestsHistory
            {
                ManifestId = x.ManifestId,
                OwnerUserId = x.OwnerUserId,
                VaultBlob = string.Empty,
                ManifestBlob = null,
                StorageFormat = x.StorageFormat,
                Version = x.Version,
                RevisionNumber = x.RevisionNumber,
                FileSize = x.FileSize,
                CredentialsCount = x.CredentialsCount,
                EmailClaimsCount = x.EmailClaimsCount,
                Salt = x.Salt,
                Verifier = x.Verifier,
                EncryptionType = x.EncryptionType,
                EncryptionSettings = x.EncryptionSettings,
                Client = x.Client,
                CreatedAt = x.CreatedAt,
                UpdatedAt = x.UpdatedAt,
            })
            .ToListAsync();
        historyRevisions.Add(justArchived);

        var revisionsToDelete = VaultRetentionManager.ApplyRetention(_retentionPolicy, historyRevisions, timeProvider.UtcNow, currentManifest);
        context.VaultManifestsHistory.RemoveRange(revisionsToDelete);

        // Blob references of pruned revisions are deleted explicitly (they only cascade with the whole manifest).
        var prunedRevisionNumbers = revisionsToDelete.Select(x => x.RevisionNumber).ToList();
        if (prunedRevisionNumbers.Count > 0)
        {
            await context.VaultBlobReferences.Where(r => r.ManifestId == currentManifest.ManifestId && prunedRevisionNumbers.Contains(r.RevisionNumber)).ExecuteDeleteAsync();
        }
    }

    private async Task UpdateUserEmailClaimsAsync(AliasServerDbContext context, AliasVaultUser user, List<string> newEmailAddresses)
    {
        newEmailAddresses = newEmailAddresses.Select(EmailHelper.SanitizeEmail).Distinct().ToList();
        var userOwnedEmailClaims = await context.UserEmailClaims.Where(x => x.UserId == user.Id).ToListAsync();
        var processed = new List<string>();
        var supportedDomains = config.PrivateEmailDomains;

        // Resolve the alias creation limits for this user.
        var rateLimits = await rateLimitService.ResolveAsync(user, RateLimitType.AliasCreation);

        // Calculate the current usage baseline per limit. addedThisSync is then added to each in the loop.
        var limitUsages = new List<(int MaxCount, int BaseCount)>();
        foreach (var limit in rateLimits)
        {
            int baseCount;
            if (limit.WindowSeconds == 0)
            {
                // Global absolute cap: every claim the user has ever made (including disabled ones).
                baseCount = userOwnedEmailClaims.Count;
            }
            else
            {
                // Time-based cap: aliases created within the rolling window (create-then-delete still counts).
                var windowStart = timeProvider.UtcNow.AddSeconds(-limit.WindowSeconds);
                baseCount = await context.UserEmailClaims.CountAsync(x => x.UserId == user.Id && x.CreatedAt >= windowStart);
            }

            limitUsages.Add((limit.MaxCount, baseCount));
        }

        var addedThisSync = 0;
        var aliasLimitLogged = false;

        foreach (var email in newEmailAddresses)
        {
            var sanitized = EmailHelper.SanitizeEmail(email);
            processed.Add(sanitized);

            if (!new System.ComponentModel.DataAnnotations.EmailAddressAttribute().IsValid(sanitized))
            {
                logger.LogWarning("{User} tried to claim invalid email: {Email}", user.UserName, sanitized);
                continue;
            }

            var domain = sanitized.Split('@')[1];
            if (!supportedDomains.Contains(domain))
            {
                logger.LogWarning("{User} tried to claim unsupported domain: {Email}", user.UserName, sanitized);
                continue;
            }

            var existing = userOwnedEmailClaims.FirstOrDefault(x => x.Address == sanitized);
            if (existing != null)
            {
                if (existing.Disabled)
                {
                    existing.Disabled = false;
                    existing.UpdatedAt = timeProvider.UtcNow;
                }

                continue;
            }

            var foreignClaim = await context.UserEmailClaims.FirstOrDefaultAsync(x => x.Address == sanitized);
            if (foreignClaim != null && foreignClaim.UserId != user.Id)
            {
                logger.LogWarning("{User} tried to claim email already owned by another user: {Email}", user.UserName, sanitized);
                continue;
            }

            // Once any limit is reached, silently skip creating further aliases (logged once for audits).
            if (limitUsages.Any(u => u.BaseCount + addedThisSync >= u.MaxCount))
            {
                if (!aliasLimitLogged)
                {
                    logger.LogWarning("{User} exceeded alias creation limit. Skipping creation of additional aliases.", user.UserName);
                    aliasLimitLogged = true;
                }

                continue;
            }

            context.UserEmailClaims.Add(new UserEmailClaim
            {
                UserId = user.Id,
                Address = sanitized,
                AddressLocal = sanitized.Split('@')[0],
                AddressDomain = sanitized.Split('@')[1],
                CreatedAt = timeProvider.UtcNow,
                UpdatedAt = timeProvider.UtcNow,
            });
            addedThisSync++;
        }

        foreach (var existing in userOwnedEmailClaims.Where(x => !x.Disabled).ToList())
        {
            if (!processed.Contains(existing.Address))
            {
                existing.Disabled = true;
                existing.UpdatedAt = timeProvider.UtcNow;
            }
        }
    }

    private async Task UpdateUserPublicKeyAsync(AliasServerDbContext context, string userId, string newPublicKey)
    {
        var exists = await context.UserEncryptionKeys.AnyAsync(x => x.UserId == userId && x.IsPrimary && x.PublicKey == newPublicKey);
        if (exists)
        {
            return;
        }

        var others = await context.UserEncryptionKeys.Where(x => x.UserId == userId).ToListAsync();
        foreach (var key in others)
        {
            key.IsPrimary = false;
            key.UpdatedAt = timeProvider.UtcNow;
        }

        var existingKey = await context.UserEncryptionKeys.FirstOrDefaultAsync(x => x.UserId == userId && x.PublicKey == newPublicKey);
        if (existingKey != null)
        {
            existingKey.IsPrimary = true;
            existingKey.UpdatedAt = timeProvider.UtcNow;
            return;
        }

        context.UserEncryptionKeys.Add(new UserEncryptionKey
        {
            UserId = userId,
            PublicKey = newPublicKey,
            IsPrimary = true,
            CreatedAt = timeProvider.UtcNow,
            UpdatedAt = timeProvider.UtcNow,
        });
    }
}
