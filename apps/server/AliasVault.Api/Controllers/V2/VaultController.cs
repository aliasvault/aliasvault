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

        // Current revision per logical manifest: everything the user owns plus manifests shared with them,
        // so revision-based pull detection covers shared folders too.
        var ownedManifestRevisions = await context.VaultManifests
            .Where(x => x.OwnerUserId == user.Id && x.StorageFormat == ManifestFormat)
            .Select(x => new ManifestRevision { ManifestId = x.ManifestId, IsRoot = x.IsRoot, Revision = x.RevisionNumber })
            .ToListAsync();

        // Migration status is judged solely by the user's own root manifest. A shared-with-me manifest (always
        // IsRoot=false, owned by another user) must never make a not-yet-migrated user look migrated, or the client
        // would push without CreateVaultKey and the upload would fail with VAULT_KEY_NOT_FOUND.
        var isMigrated = ownedManifestRevisions.Any(x => x.IsRoot);

        var manifestRevisions = ownedManifestRevisions;
        var grantedManifestIds = await GetGrantedManifestIdsAsync(context, user.Id);
        manifestRevisions.AddRange(await context.VaultManifests
            .Where(x => grantedManifestIds.Contains(x.ManifestId) && x.StorageFormat == ManifestFormat)
            .Select(x => new ManifestRevision { ManifestId = x.ManifestId, IsRoot = false, Revision = x.RevisionNumber })
            .ToListAsync());

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
            .Select(x => new { x.ManifestId, x.IsRoot, x.Name, x.ManifestBlob, x.ManifestCiphertextHash, x.RevisionNumber })
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

        // The caller's own grants on the non-root manifests they own: the folder VEK wrapped with their own public
        // key.
        var ownedNonRootIds = latestManifests.Where(m => !m.IsRoot).Select(m => m.ManifestId).ToList();
        var selfGrantsByManifest = ownedNonRootIds.Count == 0
            ? new Dictionary<Guid, VaultKey>()
            : await context.VaultKeys
                .Where(k => k.UserId == user.Id && k.KeyType == AuthHelper.VaultKeyTypeShared && k.VaultManifestId != null && ownedNonRootIds.Contains(k.VaultManifestId.Value))
                .ToDictionaryAsync(k => k.VaultManifestId!.Value);

        var manifests = latestManifests.Select(m => new Manifest
        {
            ManifestId = m.ManifestId,
            IsRoot = m.IsRoot,
            Name = m.Name,
            Blob = m.ManifestBlob,
            CiphertextHash = m.ManifestCiphertextHash,
            Revision = m.RevisionNumber,
            BlobReferences = refsByManifest.TryGetValue(m.ManifestId, out var refs) ? refs : [],
            WrappedVek = selfGrantsByManifest.TryGetValue(m.ManifestId, out var selfGrant) ? selfGrant.WrappedVek : null,
            WrapScheme = selfGrantsByManifest.TryGetValue(m.ManifestId, out var selfGrant2) ? selfGrant2.WrapScheme : null,
        }).ToList();

        // Append manifests shared with this user by other owners, each carrying the wrapped VEK the caller
        // unwraps with its private key. (OwnerUsername left null on the caller's own manifests above marks them
        // as owned rather than shared-with-me.)
        manifests.AddRange(await BuildSharedWithMeManifestsAsync(context, user.Id));

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

        // The caller can fetch a manifest it owns, or one another user granted to it (a shared folder).
        var latest = await context.VaultManifests
            .Where(x => x.StorageFormat == ManifestFormat && x.ManifestId == manifestId && (x.OwnerUserId == user.Id || context.VaultKeys.Any(k => k.UserId == user.Id && k.KeyType == AuthHelper.VaultKeyTypeShared && k.VaultManifestId == x.ManifestId)))
            .FirstOrDefaultAsync();

        if (latest == null)
        {
            return NotFound();
        }

        var blobRefs = (await context.VaultBlobReferences
                .Where(r => r.ManifestId == latest.ManifestId && r.RevisionNumber == latest.RevisionNumber)
                .Join(context.VaultBlobObjects, r => r.BlobHash, b => b.Hash, (r, b) => new { b.Hash, b.Category })
                .Distinct()
                .ToListAsync())
            .Select(x => new BlobReference { Hash = x.Hash, Category = x.Category })
            .ToList();

        var manifest = new Manifest
        {
            ManifestId = latest.ManifestId,
            IsRoot = latest.IsRoot,
            Name = latest.Name,
            Blob = latest.ManifestBlob,
            CiphertextHash = latest.ManifestCiphertextHash,
            Revision = latest.RevisionNumber,
            BlobReferences = blobRefs,
        };

        // A non-root manifest is unlocked via the caller's grant (their wrapped VEK), whether they own it (self-grant)
        // or another user shared it with them. Attach that grant; only stamp OwnerUsername when it is shared with them.
        if (!latest.IsRoot)
        {
            var grant = await context.VaultKeys.FirstOrDefaultAsync(k => k.UserId == user.Id && k.KeyType == AuthHelper.VaultKeyTypeShared && k.VaultManifestId == latest.ManifestId);
            manifest.WrappedVek = grant?.WrappedVek;
            manifest.WrapScheme = grant?.WrapScheme;
            if (latest.OwnerUserId != user.Id)
            {
                manifest.OwnerUsername = await context.AliasVaultUsers.Where(u => u.Id == latest.OwnerUserId).Select(u => u.UserName).FirstOrDefaultAsync();
            }
        }

        return Ok(manifest);
    }

    /// <summary>
    /// Unified atomic write. Applies any number of changed manifests (root and/or shared folders), changed data
    /// buckets, and new blobs in a single all-or-nothing DB transaction.
    /// </summary>
    /// <param name="model">Vault write request DTO.</param>
    /// <param name="clientHeader">Client header.</param>
    /// <returns>Vault write response DTO.</returns>
    [HttpPost("")]
    public async Task<IActionResult> Write(
        [FromBody] VaultWriteRequest model,
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

        // Each manifest and bucket may appear at most once.
        if (model.Manifests.Select(m => m.ManifestId).Distinct().Count() != model.Manifests.Count
            || model.Buckets.Select(b => b.Category).Distinct().Count() != model.Buckets.Count)
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_NOT_UP_TO_DATE, 400));
        }

        var rootWrite = model.Manifests.FirstOrDefault(m => m.IsRoot);

        // KEK/VEK migration (CreateVaultKey) is a full root push and only valid alongside a root manifest.
        var hasExistingVaultKey = await context.VaultKeys.AnyAsync(x => x.UserId == user.Id && x.KeyType == AuthHelper.VaultKeyTypePassword);
        if (model.CreateVaultKey != null && (rootWrite == null || model.CreateVaultKey.KeyType != AuthHelper.VaultKeyTypePassword))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_KEY_NOT_FOUND, 400));
        }

        if (model.CreateVaultKey != null && hasExistingVaultKey)
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_KEY_ALREADY_EXISTS, 400));
        }

        // A root push from a not-yet-migrated user must carry CreateVaultKey.
        // TODO: remove this guard once every user has migrated to the KEK/VEK model (no keyless users remain).
        if (rootWrite != null && model.CreateVaultKey == null && !hasExistingVaultKey)
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_KEY_NOT_FOUND, 400));
        }

        // Resolve + authorize each manifest write to its stored row.
        var resolved = new List<(ManifestWrite Write, VaultManifest Row)>();
        foreach (var mw in model.Manifests)
        {
            if (mw.IsRoot)
            {
                if (mw.ManifestId != null)
                {
                    // Contradictory target (root + an id): refuse rather than guess which was intended.
                    return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_NOT_UP_TO_DATE, 400));
                }

                var rootRow = await context.VaultManifests.FirstOrDefaultAsync(x => x.OwnerUserId == user.Id && x.IsRoot);
                if (rootRow == null)
                {
                    return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_NOT_UP_TO_DATE, 400));
                }

                resolved.Add((mw, rootRow));
                continue;
            }

            if (mw.ManifestId == null)
            {
                // A non-root write must name its manifest; a missing id must never fall through to the root.
                return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_NOT_UP_TO_DATE, 400));
            }

            var row = await context.VaultManifests.FirstOrDefaultAsync(x => x.ManifestId == mw.ManifestId && !x.IsRoot);
            var canWrite = row != null && (row.OwnerUserId == user.Id || await context.VaultKeys.AnyAsync(k => k.UserId == user.Id && k.KeyType == AuthHelper.VaultKeyTypeShared && k.VaultManifestId == mw.ManifestId));
            if (row == null || !canWrite)
            {
                return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404));
            }

            resolved.Add((mw, row));
        }

        // All-or-nothing revision gate: every manifest and bucket must be exactly one ahead of the server's current.
        // On any staleness, reject the whole write with Outdated and hand back the current revisions to pull/merge.
        var bucketCurrentRevisions = new Dictionary<VaultDataBucketCategory, long>();
        foreach (var bw in model.Buckets)
        {
            bucketCurrentRevisions[bw.Category] = await context.VaultDataBuckets
                .Where(x => x.OwnerUserId == user.Id && x.Category == bw.Category)
                .MaxAsync(x => (long?)x.RevisionNumber) ?? 0;
        }

        var manifestStale = resolved.Any(r => r.Row.RevisionNumber >= r.Write.CurrentRevision + 1);
        var bucketStale = model.Buckets.Any(b => bucketCurrentRevisions[b.Category] >= b.CurrentRevision + 1);
        if (manifestStale || bucketStale)
        {
            return Ok(new VaultWriteResponse
            {
                Status = VaultStatus.Outdated,
                ManifestRevisions = resolved.Select(r => new ManifestWriteResult { IsRoot = r.Write.IsRoot, ManifestId = r.Write.ManifestId, Revision = r.Row.RevisionNumber }).ToList(),
                BucketRevisions = model.Buckets.Select(b => new BucketRevision { Category = b.Category, Revision = bucketCurrentRevisions[b.Category] }).ToList(),
            });
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
                    await tx.RollbackAsync();
                    return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_NOT_UP_TO_DATE, 400));
                }

                await context.SaveChangesAsync();
            }

            // 2) Validate every referenced hash exists.
            var ownScopeHashes = resolved.Where(r => r.Write.IsRoot).SelectMany(r => r.Write.BlobReferences).Select(br => br.Hash).Distinct().ToList();
            var anyScopeHashes = resolved.Where(r => !r.Write.IsRoot).SelectMany(r => r.Write.BlobReferences).Select(br => br.Hash).Distinct().ToList();
            var missing = new List<string>();
            if (ownScopeHashes.Count > 0)
            {
                var present = await context.VaultBlobObjects.Where(b => b.OwnerUserId == user.Id && ownScopeHashes.Contains(b.Hash)).Select(b => b.Hash).ToListAsync();
                missing.AddRange(ownScopeHashes.Except(present));
            }

            if (anyScopeHashes.Count > 0)
            {
                var present = await context.VaultBlobObjects.Where(b => anyScopeHashes.Contains(b.Hash)).Select(b => b.Hash).Distinct().ToListAsync();
                missing.AddRange(anyScopeHashes.Except(present));
            }

            missing = missing.Distinct().ToList();
            if (missing.Count > 0)
            {
                await tx.RollbackAsync();
                return Ok(new VaultWriteResponse
                {
                    Status = VaultStatus.Ok,
                    MissingBlobHashes = missing,
                    ManifestRevisions = resolved.Select(r => new ManifestWriteResult { IsRoot = r.Write.IsRoot, ManifestId = r.Write.ManifestId, Revision = r.Row.RevisionNumber }).ToList(),
                });
            }

            // 3) Apply each manifest: archive the current revision into history, update the row in place, run the
            // root-only side effects (email claims count + KEK/VEK key creation), and prune history per retention.
            var manifestResults = new List<ManifestWriteResult>();
            foreach (var (mw, row) in resolved)
            {
                var archivedRevision = VaultManifestsHistory.CreateFrom(row);
                context.VaultManifestsHistory.Add(archivedRevision);

                row.VaultBlob = string.Empty;
                row.StorageFormat = ManifestFormat;
                row.ManifestBlob = mw.ManifestBlob;
                row.ManifestCiphertextHash = mw.ManifestCiphertextHash;
                row.Version = mw.Version;
                row.RevisionNumber = mw.CurrentRevision + 1;
                row.FileSize = FileHelper.Base64StringToKilobytes(mw.ManifestBlob);
                row.CredentialsCount = mw.CredentialsCount;
                row.Client = clientHeader;
                row.UpdatedAt = timeProvider.UtcNow;

                if (row.IsRoot)
                {
                    row.CreatedAt = timeProvider.UtcNow;
                    if (model.EmailRouting != null)
                    {
                        row.EmailClaimsCount = model.EmailRouting.EmailAddressList.Count;
                    }

                    // Create the VaultKey row atomically with this write on the KEK/VEK migration (first push after the
                    // client re-encrypted the vault under a fresh VEK). Move the SRP credentials off the manifest row.
                    if (model.CreateVaultKey != null)
                    {
                        context.VaultKeys.Add(new VaultKey
                        {
                            Id = Guid.NewGuid(),
                            UserId = user.Id,
                            VaultManifestId = row.ManifestId,
                            KeyType = AuthHelper.VaultKeyTypePassword,
                            WrapScheme = AuthHelper.WrapSchemeAesGcmKek,
                            WrappedVek = model.CreateVaultKey.WrappedVek,
                            Salt = row.Salt,
                            Verifier = row.Verifier,
                            EncryptionType = row.EncryptionType,
                            EncryptionSettings = row.EncryptionSettings,
                            CreatedAt = timeProvider.UtcNow,
                            UpdatedAt = timeProvider.UtcNow,
                        });

                        row.Salt = string.Empty;
                        row.Verifier = string.Empty;
                        row.EncryptionType = string.Empty;
                        row.EncryptionSettings = string.Empty;
                    }
                }

                await ApplyVaultRetention(context, row, archivedRevision);
                manifestResults.Add(new ManifestWriteResult { IsRoot = mw.IsRoot, ManifestId = mw.ManifestId, Revision = row.RevisionNumber });
            }

            await context.SaveChangesAsync();

            // 4) Add blob references for each manifest's new revision.
            foreach (var (mw, row) in resolved)
            {
                foreach (var dto in mw.BlobReferences)
                {
                    context.VaultBlobReferences.Add(new VaultBlobReference
                    {
                        ManifestId = row.ManifestId,
                        RevisionNumber = row.RevisionNumber,
                        BlobHash = dto.Hash,
                    });
                }
            }

            // 5) Data bucket upserts (settings, etc.). Each insert adds a new revision row (history).
            var newBucketRevisions = new List<BucketRevision>();
            foreach (var bucket in model.Buckets)
            {
                if (string.IsNullOrEmpty(bucket.Blob))
                {
                    continue;
                }

                var rev = await UpsertBucketAsync(context, user.Id, bucket.Category, bucket.Blob, bucket.CiphertextHash, bucket.CurrentRevision);
                newBucketRevisions.Add(new BucketRevision { Category = bucket.Category, Revision = rev });
            }

            // 6) Root-scoped email routing + public key.
            if (model.EmailRouting != null && model.EmailRouting.EmailAddressList.Count > 0)
            {
                await UpdateUserEmailClaimsAsync(context, user, model.EmailRouting.EmailAddressList);
            }

            if (!string.IsNullOrEmpty(model.EncryptionPublicKey))
            {
                await UpdateUserPublicKeyAsync(context, user.Id, model.EncryptionPublicKey);
            }

            await context.SaveChangesAsync();
            await tx.CommitAsync();

            return Ok(new VaultWriteResponse
            {
                Status = VaultStatus.Ok,
                ManifestRevisions = manifestResults,
                BucketRevisions = newBucketRevisions,
            });
        });
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

        // Hashes not in the caller's own store may belong to a shared folder: any blob referenced by the current
        // revision of a manifest the caller can access (granted to them, or a manifest they own that another member
        // pushed blobs for) is downloadable regardless of which member's store holds the ciphertext.
        var missing = wanted.Except(rows.Select(r => r.Hash), StringComparer.Ordinal).ToList();
        if (missing.Count > 0)
        {
            var accessibleManifests = await context.VaultManifests
                .Where(m => m.StorageFormat == ManifestFormat && !m.IsRoot && (m.OwnerUserId == user.Id || context.VaultKeys.Any(k => k.UserId == user.Id && k.KeyType == AuthHelper.VaultKeyTypeShared && k.VaultManifestId == m.ManifestId)))
                .Select(m => new { m.ManifestId, m.RevisionNumber })
                .ToListAsync();
            var accessibleIds = accessibleManifests.Select(m => m.ManifestId).ToList();
            var currentRevisionById = accessibleManifests.ToDictionary(m => m.ManifestId, m => m.RevisionNumber);

            if (accessibleIds.Count > 0)
            {
                var referencedHashes = (await context.VaultBlobReferences
                        .Where(r => accessibleIds.Contains(r.ManifestId) && missing.Contains(r.BlobHash))
                        .Select(r => new { r.ManifestId, r.RevisionNumber, r.BlobHash })
                        .ToListAsync())
                    .Where(r => currentRevisionById.TryGetValue(r.ManifestId, out var rev) && rev == r.RevisionNumber)
                    .Select(r => r.BlobHash)
                    .Distinct()
                    .ToList();

                if (referencedHashes.Count > 0)
                {
                    var sharedRows = await context.VaultBlobObjects
                        .Where(b => referencedHashes.Contains(b.Hash))
                        .Select(b => new Blob
                        {
                            Hash = b.Hash,
                            Category = b.Category,
                            EncryptedDataBase64 = Convert.ToBase64String(b.EncryptedData),
                        })
                        .ToListAsync();
                    rows.AddRange(sharedRows.GroupBy(b => b.Hash, StringComparer.Ordinal).Select(g => g.First()));
                }
            }
        }

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
    /// The ids of manifests <b>other</b> users have granted to <paramref name="userId"/> via a <c>shared</c> VaultKey
    /// row. The user's own self-grants are excluded, those manifests are already covered as owned manifests.
    /// </summary>
    private static async Task<List<Guid>> GetGrantedManifestIdsAsync(AliasServerDbContext context, string userId)
    {
        return await context.VaultKeys
            .Where(k => k.UserId == userId && k.KeyType == AuthHelper.VaultKeyTypeShared && k.VaultManifestId != null
                && context.VaultManifests.Any(m => m.ManifestId == k.VaultManifestId && m.OwnerUserId != userId))
            .Select(k => k.VaultManifestId!.Value)
            .ToListAsync();
    }

    /// <summary>
    /// Builds the manifest DTOs for every shared folder granted to <paramref name="userId"/> by other users: the
    /// encrypted manifest blob plus the grant's wrapped VEK, wrap scheme, and owner identity. Blob references are
    /// taken straight from the manifest's current revision, unscoped by store owner (see DownloadBlobs).
    /// </summary>
    private static async Task<List<Manifest>> BuildSharedWithMeManifestsAsync(AliasServerDbContext context, string userId)
    {
        // Only manifests owned by OTHER users. The user's own self-grant (their own shared folders) must be
        // excluded here — those are already returned as owned manifests, and re-listing them as shared-with-me
        // would stamp them with an OwnerUsername, flipping the owner's own share detection off.
        var grants = await context.VaultKeys
            .Where(k => k.UserId == userId && k.KeyType == AuthHelper.VaultKeyTypeShared && k.VaultManifestId != null
                && context.VaultManifests.Any(m => m.ManifestId == k.VaultManifestId && m.OwnerUserId != userId))
            .ToListAsync();
        if (grants.Count == 0)
        {
            return [];
        }

        var manifestIds = grants.Select(g => g.VaultManifestId!.Value).ToList();
        var manifestsById = await context.VaultManifests
            .Where(m => manifestIds.Contains(m.ManifestId) && m.StorageFormat == ManifestFormat)
            .ToDictionaryAsync(m => m.ManifestId);

        var ownerIds = manifestsById.Values.Select(m => m.OwnerUserId).Distinct().ToList();
        var ownerUsernamesById = await context.AliasVaultUsers
            .Where(u => ownerIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.UserName);

        var refRows = await context.VaultBlobReferences
            .Where(r => manifestIds.Contains(r.ManifestId))
            .Join(context.VaultBlobObjects, r => r.BlobHash, b => b.Hash, (r, b) => new { r.ManifestId, r.RevisionNumber, b.Hash, b.Category })
            .ToListAsync();

        var result = new List<Manifest>();
        foreach (var grant in grants)
        {
            if (!manifestsById.TryGetValue(grant.VaultManifestId!.Value, out var manifestRow))
            {
                continue;
            }

            var blobRefs = refRows
                .Where(r => r.ManifestId == manifestRow.ManifestId && r.RevisionNumber == manifestRow.RevisionNumber)
                .GroupBy(r => r.Hash, StringComparer.Ordinal)
                .Select(g => new BlobReference { Hash = g.Key, Category = g.First().Category })
                .ToList();

            result.Add(new Manifest
            {
                ManifestId = manifestRow.ManifestId,
                IsRoot = false,
                Name = manifestRow.Name,
                Blob = manifestRow.ManifestBlob,
                CiphertextHash = manifestRow.ManifestCiphertextHash,
                Revision = manifestRow.RevisionNumber,
                BlobReferences = blobRefs,
                OwnerUsername = ownerUsernamesById.GetValueOrDefault(manifestRow.OwnerUserId),
                WrappedVek = grant.WrappedVek,
                WrapScheme = grant.WrapScheme,
            });
        }

        return result;
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
