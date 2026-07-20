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
[ApiVersion("2")]

public class VaultController(
    ILogger<VaultController> logger,
    IAliasServerDbContextFactory dbContextFactory,
    UserManager<AliasVaultUser> userManager,
    ITimeProvider timeProvider,
    Config config) : AuthenticatedRequestController(userManager)
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

        // Latest revision per logical manifest.
        var manifestRevisions = await context.VaultManifests
            .Where(x => x.OwnerUserId == user.Id && x.StorageFormat == ManifestFormat)
            .GroupBy(x => new { x.ManifestId, x.Category })
            .Select(g => new ManifestRevision { ManifestId = g.Key.ManifestId, Category = g.Key.Category, Revision = g.Max(m => m.RevisionNumber) })
            .ToListAsync();

        // Latest revision per bucket kind (history table → group by kind, take the max).
        var bucketRevisions = await context.VaultDataBuckets
            .Where(x => x.OwnerUserId == user.Id)
            .GroupBy(x => x.Category)
            .Select(g => new BucketRevision { Category = g.Key, Revision = g.Max(b => b.RevisionNumber) })
            .ToListAsync();

        return Ok(new StatusResponse
        {
            StorageFormat = manifestRevisions.Count > 0 ? StorageFormat.Manifest : StorageFormat.SqliteBlob,
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

        // Latest revision per logical manifest: keep only rows whose RevisionNumber equals the max for their
        // ManifestId.
        var latestManifests = await context.VaultManifests
            .Where(x => x.OwnerUserId == user.Id && x.StorageFormat == ManifestFormat
                && x.RevisionNumber == context.VaultManifests
                    .Where(y => y.OwnerUserId == user.Id && y.StorageFormat == ManifestFormat && y.ManifestId == x.ManifestId)
                    .Max(y => y.RevisionNumber))
            .Select(x => new { x.RevisionId, x.ManifestId, x.Category, x.ManifestBlob, x.ManifestCiphertextHash, x.RevisionNumber })
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

        // Blob references are scoped per manifest revision. Fetch them for all latest manifests in one query, then
        // group them back onto each manifest so every entry in the list carries exactly the blobs it needs.
        var latestRevisionIds = latestManifests.Select(m => m.RevisionId).ToList();
        var refsByRevision = (await context.VaultBlobReferences
                .Where(r => latestRevisionIds.Contains(r.ManifestRevisionId))
                .Join(
                    context.VaultBlobObjects.Where(b => b.OwnerUserId == user.Id),
                    r => r.BlobHash,
                    b => b.Hash,
                    (r, b) => new { r.ManifestRevisionId, b.Hash, b.Category })
                .ToListAsync())
            .GroupBy(x => x.ManifestRevisionId)
            .ToDictionary(g => g.Key, g => g.Select(x => new BlobReference { Hash = x.Hash, Category = x.Category }).ToList());

        var manifests = latestManifests.Select(m => new Manifest
        {
            ManifestId = m.ManifestId,
            Category = m.Category,
            Blob = m.ManifestBlob,
            CiphertextHash = m.ManifestCiphertextHash,
            Revision = m.RevisionNumber,
            BlobReferences = refsByRevision.TryGetValue(m.RevisionId, out var refs) ? refs : [],
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
            .OrderByDescending(x => x.RevisionNumber)
            .FirstOrDefaultAsync();

        if (latest == null)
        {
            return NotFound();
        }

        var blobRefs = await context.VaultBlobReferences
            .Where(r => r.ManifestRevisionId == latest.RevisionId)
            .Join(
                context.VaultBlobObjects.Where(b => b.OwnerUserId == user.Id),
                r => r.BlobHash,
                b => b.Hash,
                (r, b) => new BlobReference { Hash = b.Hash, Category = b.Category })
            .ToListAsync();

        return Ok(new Manifest
        {
            ManifestId = latest.ManifestId,
            Category = latest.Category,
            Blob = latest.ManifestBlob,
            CiphertextHash = latest.ManifestCiphertextHash,
            Revision = latest.RevisionNumber,
            BlobReferences = blobRefs,
        });
    }

    /// <summary>
    /// Atomic upload. Inserts any new blobs, validates every referenced hash exists, inserts a new Vaults row
    /// for the new manifest, replaces blob references, optionally upserts metadata, optionally syncs email
    /// routing, all in a single DB transaction on purpose.
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

        if (!string.Equals(user.UserName, model.Username, StringComparison.Ordinal))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.USERNAME_MISMATCH, 400));
        }

        // Take a SRP-settings snapshot from the user's latest vault row so we can preserve them on the new v2 row.
        var srpSnapshot = await context.VaultManifests
            .Where(x => x.OwnerUserId == user.Id)
            .OrderByDescending(x => x.RevisionNumber)
            .Select(x => new { x.Salt, x.Verifier, x.EncryptionType, x.EncryptionSettings, x.Version, x.ManifestId })
            .FirstOrDefaultAsync();

        if (srpSnapshot == null)
        {
            // No previous vault exists yet. TODO: test v2 registration flow to ensure this ensures a vault record always is created during registration.
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_NOT_UP_TO_DATE, 400));
        }

        // Optimistic concurrency against the single monotonic RevisionNumber counter, which is shared across
        // legacy ("sqlite-blob") and "manifest-v1" rows. A migrating client sends the legacy revision it last
        // synced as CurrentManifestRevision, so the first manifest-v1 row continues the sequence (e.g. legacy 50 →
        // manifest-v1 51) rather than resetting to 1 and sorting below the legacy rows.
        var serverRevision = await context.VaultManifests
            .Where(x => x.OwnerUserId == user.Id)
            .MaxAsync(x => (long?)x.RevisionNumber) ?? 0;
        var newManifestRevision = model.CurrentManifestRevision + 1;
        if (serverRevision >= newManifestRevision)
        {
            return Ok(new UploadResponse
            {
                Status = VaultStatus.Outdated,
                NewManifestRevision = serverRevision,
            });
        }

        // The DbContext uses a retrying execution strategy (EnableRetryOnFailure), which forbids user-initiated
        // transactions unless the whole unit runs inside the strategy so it can be retried atomically.
        var strategy = context.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync<IActionResult>(async () =>
        {
            await using var tx = await context.Database.BeginTransactionAsync();

            // 1) Upsert any new blob objects this client is contributing. (hash, userId) is the PK so re-upload of
            // an existing blob is a no-op. Clients normally pre-upload blobs via POST /v2/Vault/blobs and send only
            // references here, but inline NewBlobs remain supported for small payloads.
            if (model.NewBlobs.Count > 0)
            {
                if (!await TryUpsertBlobObjectsAsync(context, user.Id, model.NewBlobs))
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

            // 3) Insert the new Vaults row in manifest-v1 format. VaultBlob (legacy column) is left empty for v2 rows.
            var newVault = new VaultManifest
            {
                OwnerUserId = user.Id,

                // Same logical "main" manifest as the user's existing rows, reuse its ManifestId so this revision
                // stays grouped with the prior ones (legacy rows have been backfilled with a per-user ManifestId).
                ManifestId = srpSnapshot.ManifestId,
                Category = VaultManifestCategory.Main,
                VaultBlob = string.Empty,
                StorageFormat = ManifestFormat,
                ManifestBlob = model.ManifestBlob,
                ManifestCiphertextHash = model.ManifestCiphertextHash,
                Version = model.Version,
                RevisionNumber = newManifestRevision,
                FileSize = FileHelper.Base64StringToKilobytes(model.ManifestBlob),
                CredentialsCount = model.CredentialsCount,
                EmailClaimsCount = model.EmailRouting.EmailAddressList.Count,
                Salt = srpSnapshot.Salt,
                Verifier = srpSnapshot.Verifier,
                EncryptionType = srpSnapshot.EncryptionType,
                EncryptionSettings = srpSnapshot.EncryptionSettings,
                Client = clientHeader,
                CreatedAt = timeProvider.UtcNow,
                UpdatedAt = timeProvider.UtcNow,
            };

            await ApplyVaultRetention(context, user.Id, newVault);
            context.VaultManifests.Add(newVault);
            await context.SaveChangesAsync();

            // 4) Replace blob references for this new vault id.
            foreach (var dto in model.BlobReferences)
            {
                context.VaultBlobReferences.Add(new VaultBlobReference
                {
                    ManifestRevisionId = newVault.RevisionId,
                    BlobHash = dto.Hash,
                });
            }

            // 5) Optional data bucket upserts (settings, etc.). Each insert adds a new revision row (history); the
            // revision is server-assigned (currentRevision: null = "increment from whatever the server has"). The
            // bundled path does not do per-bucket concurrency.
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

        if (!await TryUpsertBlobObjectsAsync(context, user.Id, model.Blobs))
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
    /// their LastReferencedAt bumped; new blobs are validated and inserted. Does not call SaveChanges, the caller
    /// owns the transaction boundary.
    /// </summary>
    /// <param name="context">DbContext to operate on.</param>
    /// <param name="userId">Owning user id.</param>
    /// <param name="blobs">Blobs to upsert.</param>
    /// <returns>True when every payload is structurally valid; false when any is malformed (caller should 400).</returns>
    private async Task<bool> TryUpsertBlobObjectsAsync(AliasServerDbContext context, string userId, List<Blob> blobs)
    {
        var nowUtc = timeProvider.UtcNow;
        var hashes = blobs.Select(b => b.Hash).Distinct().ToList();
        var existing = await context.VaultBlobObjects
            .Where(b => b.OwnerUserId == userId && hashes.Contains(b.Hash))
            .ToDictionaryAsync(b => b.Hash, StringComparer.Ordinal);

        foreach (var dto in blobs)
        {
            if (existing.TryGetValue(dto.Hash, out var row))
            {
                // Already have it (or a duplicate within this batch), bump LastReferencedAt so GC leaves it alone.
                row.LastReferencedAt = nowUtc;
                continue;
            }

            byte[] data;
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

            var entity = new VaultBlobObject
            {
                Hash = dto.Hash,
                OwnerUserId = userId,
                Category = dto.Category,
                EncryptedData = data,
                SizeBytes = data.Length,
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

    private async Task ApplyVaultRetention(AliasServerDbContext context, string userId, VaultManifest newVault)
    {
        var existingVaults = await context.VaultManifests
            .Where(x => x.OwnerUserId == userId)
            .OrderByDescending(v => v.UpdatedAt)
            .Select(x => new VaultManifest
            {
                RevisionId = x.RevisionId,
                ManifestId = x.ManifestId,
                Category = x.Category,
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

        var vaultsToDelete = VaultRetentionManager.ApplyRetention(_retentionPolicy, existingVaults, timeProvider.UtcNow, newVault);
        context.VaultManifests.RemoveRange(vaultsToDelete);
    }

    private async Task UpdateUserEmailClaimsAsync(AliasServerDbContext context, AliasVaultUser user, List<string> newEmailAddresses)
    {
        newEmailAddresses = newEmailAddresses.Select(EmailHelper.SanitizeEmail).Distinct().ToList();
        var userOwnedEmailClaims = await context.UserEmailClaims.Where(x => x.UserId == user.Id).ToListAsync();
        var processed = new List<string>();
        var supportedDomains = config.PrivateEmailDomains;

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

            context.UserEmailClaims.Add(new UserEmailClaim
            {
                UserId = user.Id,
                Address = sanitized,
                AddressLocal = sanitized.Split('@')[0],
                AddressDomain = sanitized.Split('@')[1],
                CreatedAt = timeProvider.UtcNow,
                UpdatedAt = timeProvider.UtcNow,
            });
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
