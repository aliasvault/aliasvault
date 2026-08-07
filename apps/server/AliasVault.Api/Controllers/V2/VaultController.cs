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

    /// <summary>
    /// Retention policy for superseded bucket revisions.
    /// </summary>
    private static readonly RetentionPolicy _bucketRetentionPolicy = new()
    {
        Rules =
        [
            new RevisionRetentionRule { RevisionsToKeep = 3 },
            new DailyRetentionRule { DaysToKeep = 7 },
        ],
    };

    /// <summary>
    /// Retention policy for superseded manifest revisions.
    /// </summary>
    private readonly RetentionPolicy _manifestRetentionPolicy = new()
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
    /// Atomic snapshot. Returns the latest encrypted manifest + metadata + blob refs + email routing.
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
        var ownedGroupIds = await GroupHelper.GetOwnedGroupIdsAsync(context, user.Id);

        // Every manifest the caller can open.
        var latestManifests = await AccessibleManifests(context, user.Id)
            .Select(x => new { x.ManifestId, x.IsRoot, x.Name, x.ManifestBlob, x.ManifestCiphertextHash, x.RevisionNumber, x.OwnerGroupId })
            .ToListAsync();

        if (!latestManifests.Any(m => m.IsRoot && ownedGroupIds.Contains(m.OwnerGroupId)))
        {
            // User hasn't migrated to manifest-v1 yet, return the latest legacy SQLite blob.
            var legacy = await context.VaultManifests
                .Where(x => ownedGroupIds.Contains(x.OwnerGroupId) && x.IsRoot)
                .OrderByDescending(x => x.RevisionNumber)
                .FirstOrDefaultAsync();

            return Ok(new GetResponse
            {
                Status = VaultStatus.Ok,
                StorageFormat = StorageFormat.SqliteBlob,
                LegacyVaultBlob = legacy?.VaultBlob ?? string.Empty,
                Version = legacy?.Version ?? string.Empty,
                LegacyRevision = legacy?.RevisionNumber ?? 0,
                RootManifestId = legacy?.ManifestId,
                EmailRouting = emailRouting,
            });
        }

        // The current revision of each bucket is the row itself: superseded revisions live in the history table.
        var buckets = await context.VaultDataBuckets
            .Where(x => x.OwnerUserId == user.Id)
            .Select(x => new Bucket
            {
                Category = x.Category,
                Blob = x.EncryptedData,
                CiphertextHash = x.CiphertextHash,
                Revision = x.RevisionNumber,
            })
            .ToListAsync();

        // Blob references are scoped per manifest revision. Fetch them for all manifests in one query, then keep
        // only the refs belonging to each manifest's current revision.
        var manifestIds = latestManifests.Select(m => m.ManifestId).ToList();
        var currentRevisionByManifest = latestManifests.ToDictionary(m => m.ManifestId, m => m.RevisionNumber);
        var refsByManifest = (await context.VaultBlobReferences
                .Where(r => manifestIds.Contains(r.ManifestId))
                .Join(context.VaultBlobObjects, r => r.BlobHash, b => b.Hash, (r, b) => new { r.ManifestId, r.RevisionNumber, b.Hash, b.Category })
                .ToListAsync())
            .Where(x => currentRevisionByManifest.TryGetValue(x.ManifestId, out var rev) && rev == x.RevisionNumber)
            .GroupBy(x => x.ManifestId)
            .ToDictionary(g => g.Key, g => g.GroupBy(x => x.Hash, StringComparer.Ordinal).Select(h => new BlobReference { Hash = h.Key, Category = h.First().Category }).ToList());

        var accessKeysByManifest = await GetAccessKeysAsync(context, user.Id, manifestIds);
        var encryptionPublicKeys = await GetEncryptionPublicKeysAsync(context, accessKeysByManifest.Values.Where(g => g.UserGrantKeyId != null).Select(g => g.UserGrantKeyId!.Value));

        // A manifest owned by a group the caller does not own is one shared with them: stamp the owning user's name.
        var foreignGroupIds = latestManifests.Where(m => !ownedGroupIds.Contains(m.OwnerGroupId)).Select(m => m.OwnerGroupId).Distinct().ToList();
        var ownerUsernamesByGroupId = await GetGroupOwnerUsernamesAsync(context, foreignGroupIds);

        // Administering a manifest's shares follows group role, not owner identity: an admin of someone else's group
        // may manage it, and heading a group means managing the manifests filed under it (see GrantAccess).
        var administeredGroupIds = await GroupHelper.GetAdministeredGroupIdsAsync(context, user.Id);

        var manifests = latestManifests.Select(m =>
        {
            accessKeysByManifest.TryGetValue(m.ManifestId, out var accessKey);

            // An account-key row's ciphertext is not sent: the caller unwrapped that VEK from their password chain before this call.
            var grant = accessKey != null && ManifestKeyTypes.CarriesEncryptedVek(accessKey.Type) ? accessKey : null;
            return new Manifest
            {
                ManifestId = m.ManifestId,
                IsRoot = m.IsRoot,
                Name = m.Name,
                Blob = m.ManifestBlob,
                CiphertextHash = m.ManifestCiphertextHash,
                Revision = m.RevisionNumber,
                BlobReferences = refsByManifest.TryGetValue(m.ManifestId, out var refs) ? refs : [],
                OwnerUsername = ownerUsernamesByGroupId.GetValueOrDefault(m.OwnerGroupId),
                CanAdminister = !m.IsRoot && administeredGroupIds.Contains(m.OwnerGroupId),
                KeyType = accessKey != null ? ManifestKeyTypes.ToToken(accessKey.Type) : null,
                EncryptedVek = grant?.EncryptedVek,
                Algorithm = grant != null ? VaultKeyAlgorithms.ToToken(grant.Algorithm) : null,
                EncryptionPublicKey = grant?.UserGrantKeyId != null ? encryptionPublicKeys.GetValueOrDefault(grant.UserGrantKeyId.Value) : null,
            };
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
    /// Single-manifest fetch. Returns the latest revision of one logical manifest (by ManifestId)
    /// plus its blob references, without the rest of the snapshot.
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

        // The caller can fetch a manifest owned by a group they own, or one granted to them (a shared manifest).
        var latest = await AccessibleManifests(context, user.Id).FirstOrDefaultAsync(x => x.ManifestId == manifestId);

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

        // How this manifest's VEK reaches the caller.
        var accessKey = (await GetAccessKeysAsync(context, user.Id, [latest.ManifestId])).GetValueOrDefault(latest.ManifestId);
        manifest.KeyType = accessKey != null ? ManifestKeyTypes.ToToken(accessKey.Type) : null;
        if (accessKey != null && ManifestKeyTypes.CarriesEncryptedVek(accessKey.Type))
        {
            manifest.EncryptedVek = accessKey.EncryptedVek;
            manifest.Algorithm = VaultKeyAlgorithms.ToToken(accessKey.Algorithm);
            if (accessKey.UserGrantKeyId != null)
            {
                manifest.EncryptionPublicKey = await context.UserGrantKeys.Where(k => k.Id == accessKey.UserGrantKeyId).Select(k => k.PublicKey).FirstOrDefaultAsync();
            }
        }

        // Ownership display and administer rights are only meaningful on a manifest that is not the caller's own home one.
        if (!latest.IsRoot)
        {
            // Set owner username for shared manifests for display purposes.
            var isOwnedByCaller = await context.GroupMembers.AnyAsync(gm => gm.GroupId == latest.OwnerGroupId && gm.UserId == user.Id && gm.Role == GroupRole.Owner);
            if (!isOwnedByCaller)
            {
                manifest.OwnerUsername = (await GetGroupOwnerUsernamesAsync(context, [latest.OwnerGroupId])).GetValueOrDefault(latest.OwnerGroupId);
            }

            manifest.CanAdminister = isOwnedByCaller || await GroupHelper.IsGroupAdminAsync(context, latest.OwnerGroupId, user.Id);
        }

        return Ok(manifest);
    }

    /// <summary>
    /// Unified atomic write. Applies any number of changed manifests (root and/or shared manifests), changed data
    /// buckets, and new blobs in a single all-or-nothing DB transaction.
    /// </summary>
    /// <param name="model">Vault write request DTO.</param>
    /// <param name="clientHeader">Client header.</param>
    /// <returns>Vault write response DTO.</returns>
    [HttpPost("")]
    public async Task<IActionResult> Write([FromBody] VaultWriteRequest model, [FromHeader(Name = "X-AliasVault-Client")] string? clientHeader)
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

        /*
         * Account-key migration: when writing the root manifest the first time, the client needs to generate a VEK,
         * encrypt it with the AccountKey, and store it in the root manifest. AccountKeys blobs (KEK-encrypted AK + AK-encrypted account keypair).
         * A non-root write must never carry one. We reject rather than silently ignore, so a misdirected key can never be dropped unnoticed.
         * TODO: these guards can be removed once all users have migrated and we don't support legacy users anymore.
         */
        if (model.Manifests.Any(m => !m.IsRoot && !string.IsNullOrEmpty(m.EncryptedVek)))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_KEY_NOT_FOUND, 400));
        }

        var migrationEncryptedVek = rootWrite?.EncryptedVek;
        var hasExistingUnlockKey = await context.UserUnlockKeys.AnyAsync(x => x.UserId == user.Id && x.Type == UnlockMethodType.Password);
        if (!string.IsNullOrEmpty(migrationEncryptedVek) && hasExistingUnlockKey)
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_KEY_ALREADY_EXISTS, 400));
        }

        // A root push from a not-yet-migrated user must carry the encrypted VEK to migrate the vault into the manifest-v1 format.
        if (rootWrite != null && string.IsNullOrEmpty(migrationEncryptedVek) && !hasExistingUnlockKey)
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_KEY_NOT_FOUND, 400));
        }

        // The migration VEK and the account-key blobs only make sense together: the VEK is encrypted under the AK.
        var accountKeys = model.AccountKeys;
        var accountKeysComplete = accountKeys != null && !string.IsNullOrEmpty(accountKeys.EncryptedAccountKey) && !string.IsNullOrEmpty(accountKeys.AccountPublicKey) && !string.IsNullOrEmpty(accountKeys.EncryptedAccountPrivateKey);
        if (!string.IsNullOrEmpty(migrationEncryptedVek) && !accountKeysComplete)
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_KEY_NOT_FOUND, 400));
        }

        /*
         * Resolve + authorize each manifest write to its stored row.
         */
        var resolved = new List<(ManifestWrite Write, VaultManifest Row)>();
        foreach (var mw in model.Manifests)
        {
            VaultManifest? row;
            if (mw.ManifestId != null)
            {
                row = await WritableManifests(context, user.Id).FirstOrDefaultAsync(x => x.ManifestId == mw.ManifestId);
            }
            else if (mw.IsRoot)
            {
                row = await context.VaultManifests.FirstOrDefaultAsync(x => x.IsRoot && x.OwnerGroupId == user.PersonalGroupId);
            }
            else
            {
                // A non-root write must name its manifest; a missing id must never fall through to the root.
                return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_NOT_UP_TO_DATE, 400));
            }

            if (row == null)
            {
                // A missing root is a state error on the caller's own vault; a missing shared manifest is a bad target.
                return mw.IsRoot
                    ? BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_NOT_UP_TO_DATE, 400))
                    : NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404));
            }

            // The target must agree with what its id resolved to, and a root write only ever means the caller's own
            // personal root: refuse rather than guess which manifest was intended.
            if (row.IsRoot != mw.IsRoot || (mw.IsRoot && row.OwnerGroupId != user.PersonalGroupId))
            {
                return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_NOT_UP_TO_DATE, 400));
            }

            resolved.Add((mw, row));
        }

        // All-or-nothing revision gate: every manifest and bucket must be exactly one ahead of the server's current.
        // On any staleness, reject the whole write with Outdated and hand back the current revisions to pull/merge.
        var writeCategories = model.Buckets.Select(b => b.Category).ToList();
        var bucketRows = await context.VaultDataBuckets.Where(x => x.OwnerUserId == user.Id && writeCategories.Contains(x.Category)).ToDictionaryAsync(x => x.Category);
        var bucketCurrentRevisions = writeCategories.ToDictionary(c => c, c => bucketRows.TryGetValue(c, out var row) ? row.RevisionNumber : 0);

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
                if (!await TryUpsertBlobObjectsAsync(context, user.Id, model.NewBlobs, overwrite: !string.IsNullOrEmpty(migrationEncryptedVek)))
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

                // Deprecated column: manifest-v1 revisions no longer carry a data-model version (see VaultManifestBase.Version).
                row.Version = string.Empty;
                row.RevisionNumber = mw.CurrentRevision + 1;
                row.FileSize = FileHelper.Base64StringToKilobytes(mw.ManifestBlob);
                row.CredentialsCount = mw.CredentialsCount;
                row.Client = clientHeader;
                row.UpdatedAt = timeProvider.UtcNow;

                // Every manifest counts the aliases the push filed against it, shared manifests included.
                if (model.EmailRouting != null)
                {
                    row.EmailClaimsCount = model.EmailRouting.EmailAddressList.Count(x => x.ManifestId == row.ManifestId);
                }

                if (row.IsRoot)
                {
                    row.CreatedAt = timeProvider.UtcNow;

                    // Create the account-key hierarchy atomically with this write on the migration (first push after
                    // the client re-encrypted the vault under a fresh VEK). Move the SRP credentials off the manifest row.
                    if (!string.IsNullOrEmpty(migrationEncryptedVek))
                    {
                        context.UserUnlockKeys.Add(new UserUnlockKey
                        {
                            Id = Guid.NewGuid(),
                            UserId = user.Id,
                            Type = UnlockMethodType.Password,
                            Algorithm = VaultKeyAlgorithm.Aes256Gcm,
                            EncryptedAccountKey = accountKeys!.EncryptedAccountKey!,
                            Metadata = new VaultKeyMetadata
                            {
                                Salt = row.Salt,
                                SrpVerifier = row.Verifier,
                                EncryptionType = row.EncryptionType,
                                EncryptionSettings = row.EncryptionSettings,
                            }.ToJson(),
                            CreatedAt = timeProvider.UtcNow,
                            UpdatedAt = timeProvider.UtcNow,
                        });

                        context.UserGrantKeys.Add(new UserGrantKey
                        {
                            Id = Guid.NewGuid(),
                            UserId = user.Id,
                            PublicKey = accountKeys.AccountPublicKey!,
                            EncryptedPrivateKey = accountKeys.EncryptedAccountPrivateKey!,
                            IsPrimary = true,
                            CreatedAt = timeProvider.UtcNow,
                            UpdatedAt = timeProvider.UtcNow,
                        });

                        context.VaultManifestAccessKeys.Add(new VaultManifestAccessKey
                        {
                            Id = Guid.NewGuid(),
                            UserId = user.Id,
                            VaultManifestId = row.ManifestId,
                            Type = ManifestKeyType.AccountKey,
                            Algorithm = VaultKeyAlgorithm.Aes256Gcm,
                            EncryptedVek = migrationEncryptedVek,
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

                var rev = await UpsertBucketAsync(context, user.Id, bucket.Category, bucket.Blob, bucket.CiphertextHash, bucket.CurrentRevision, bucketRows.GetValueOrDefault(bucket.Category));
                newBucketRevisions.Add(new BucketRevision { Category = bucket.Category, Revision = rev });
            }

            // 6) Root-scoped email routing + public keys. The personal key is published scoped to the caller's
            // root manifest, the exact same flow as a shared manifest's delivery key below.
            if (!string.IsNullOrEmpty(model.UserEncryptionPublicKey))
            {
                var rootManifestId = await GroupHelper.GetRootManifestIdAsync(context, user.PersonalGroupId);
                if (rootManifestId is not null)
                {
                    await PublishManifestPublicKeyAsync(context, rootManifestId.Value, model.UserEncryptionPublicKey);
                }
            }

            // Publish shared manifest delivery keys.
            if (model.SharedManifestEncryptionPublicKeys.Count > 0)
            {
                var publishable = await GetAdminAccessSharedManifestIdsAsync(context, user.Id, model.SharedManifestEncryptionPublicKeys.Select(k => k.ManifestId));
                foreach (var manifestKey in model.SharedManifestEncryptionPublicKeys.Where(k => publishable.Contains(k.ManifestId)))
                {
                    await PublishManifestPublicKeyAsync(context, manifestKey.ManifestId, manifestKey.PublicKey);
                }

                // Claim resolution below reads these rows back, so they must be visible to the query.
                await context.SaveChangesAsync();
            }

            if (model.EmailRouting is { EmailAddressList.Count: > 0 })
            {
                await UpdateEmailClaimsAsync(context, user, model.EmailRouting);
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

        // Hashes not in the caller's own store may belong to a shared manifest: any blob referenced by the current
        // revision of a manifest the caller can access (granted to them, or a manifest they own that another member
        // pushed blobs for) is downloadable regardless of which member's store holds the ciphertext.
        var missing = wanted.Except(rows.Select(r => r.Hash), StringComparer.Ordinal).ToList();
        if (missing.Count > 0)
        {
            var accessibleManifests = await AccessibleManifests(context, user.Id)
                .Where(m => !m.IsRoot)
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
    /// Gets the manifestIds that user has access to and may claim aliases for. A push files personal aliases
    /// against the caller's own root manifest, which they reach by owning its group rather than by holding a
    /// grant on it, so both arms of <see cref="ManifestAccessHelper"/> count here.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The calling user.</param>
    /// <param name="manifestIds">Candidate manifest ids from the request.</param>
    /// <returns>The subset of <paramref name="manifestIds"/> the user may act on.</returns>
    private static async Task<HashSet<Guid>> GetEmailClaimableManifestIdsAsync(AliasServerDbContext context, string userId, IEnumerable<Guid> manifestIds)
    {
        var ids = manifestIds.Distinct().ToList();
        if (ids.Count == 0)
        {
            return [];
        }

        var accessible = await ManifestAccessHelper.AccessibleManifests(context, userId)
            .Where(m => ids.Contains(m.ManifestId))
            .Select(m => m.ManifestId)
            .ToListAsync();

        return [.. accessible];
    }

    /// <summary>
    /// Gets the manifest ids that a user has admin access to.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The calling user.</param>
    /// <param name="manifestIds">Candidate manifest ids from the request.</param>
    /// <returns>The subset of <paramref name="manifestIds"/> the user has access to and may claim new aliases for.</returns>
    private static async Task<HashSet<Guid>> GetAdminAccessSharedManifestIdsAsync(AliasServerDbContext context, string userId, IEnumerable<Guid> manifestIds)
    {
        var ids = manifestIds.Distinct().ToList();
        if (ids.Count == 0)
        {
            return [];
        }

        var administered = await context.VaultManifests
            .Where(m => ids.Contains(m.ManifestId) && !m.IsRoot
                && context.GroupMembers.Any(gm => gm.GroupId == m.OwnerGroupId && gm.UserId == userId && (gm.Role == GroupRole.Admin || gm.Role == GroupRole.Owner)))
            .Select(m => m.ManifestId)
            .ToListAsync();

        return [.. administered];
    }

    /// <summary>
    /// Gets the account public key each grant's VEK was encrypted with (see <see cref="UserGrantKey"/>).
    /// </summary>
    private static async Task<Dictionary<Guid, string>> GetEncryptionPublicKeysAsync(AliasServerDbContext context, IEnumerable<Guid> publicKeyIds)
    {
        var ids = publicKeyIds.Distinct().ToList();
        if (ids.Count == 0)
        {
            return new Dictionary<Guid, string>();
        }

        return await context.UserGrantKeys
            .Where(k => ids.Contains(k.Id))
            .ToDictionaryAsync(k => k.Id, k => k.PublicKey);
    }

    /// <summary>
    /// The manifest-v1 manifests a user can access.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The calling user.</param>
    /// <returns>Query over the accessible manifest-v1 manifests.</returns>
    private static IQueryable<VaultManifest> AccessibleManifests(AliasServerDbContext context, string userId)
    {
        return ManifestAccessHelper.AccessibleManifests(context, userId).Where(m => m.StorageFormat == ManifestFormat);
    }

    /// <summary>
    /// The manifests a user can write to.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The calling user.</param>
    /// <returns>Query over the manifests the user may write to, in any storage format.</returns>
    private static IQueryable<VaultManifest> WritableManifests(AliasServerDbContext context, string userId)
    {
        return ManifestAccessHelper.AccessibleManifests(context, userId);
    }

    /// <summary>
    /// Gets the caller's key row on each of the given manifests, whichever way that manifest's VEK is wrapped for
    /// them: an account-key row (unlocked through their password chain) or a grant encrypted to one of their public
    /// keys. An account-key row wins when a manifest has both, being the caller's own direct path to it.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The calling user.</param>
    /// <param name="manifestIds">The manifests to get key rows for.</param>
    /// <returns>The key row per manifest id, empty when the caller holds none.</returns>
    private static async Task<Dictionary<Guid, VaultManifestAccessKey>> GetAccessKeysAsync(AliasServerDbContext context, string userId, IEnumerable<Guid> manifestIds)
    {
        var ids = manifestIds.Distinct().ToList();
        if (ids.Count == 0)
        {
            return [];
        }

        return (await context.VaultManifestAccessKeys
                .Where(k => k.UserId == userId && ids.Contains(k.VaultManifestId))
                .ToListAsync())
            .GroupBy(k => k.VaultManifestId)
            .ToDictionary(g => g.Key, g => g.OrderBy(k => k.Type == ManifestKeyType.AccountKey ? 0 : 1).ThenByDescending(k => k.CreatedAt).ThenBy(k => k.Id).First());
    }

    /// <summary>
    /// Gets the display owner of each group: the user who owns it, oldest membership first when co-owned.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="groupIds">The groups to resolve.</param>
    /// <returns>The owner's username per group id.</returns>
    private static async Task<Dictionary<Guid, string?>> GetGroupOwnerUsernamesAsync(AliasServerDbContext context, IEnumerable<Guid> groupIds)
    {
        var ids = groupIds.Distinct().ToList();
        if (ids.Count == 0)
        {
            return [];
        }

        return (await context.GroupMembers
                .Where(gm => ids.Contains(gm.GroupId) && gm.Role == GroupRole.Owner)
                .Join(context.AliasVaultUsers, gm => gm.UserId, u => u.Id, (gm, u) => new { gm.GroupId, gm.CreatedAt, gm.UserId, u.UserName })
                .ToListAsync())
            .GroupBy(x => x.GroupId)
            .ToDictionary(g => g.Key, g => g.OrderBy(x => x.CreatedAt).ThenBy(x => x.UserId).First().UserName);
    }

    /// <summary>
    /// Writes a new revision of a (user, bucket kind): the current row is copied to the history table and then updated in place.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The bucket owner.</param>
    /// <param name="kind">The bucket category.</param>
    /// <param name="encryptedData">The new encrypted payload.</param>
    /// <param name="ciphertextHash">Storage-layer integrity hash of the payload.</param>
    /// <param name="currentRevision">The revision the client believes is current, used to seed a first write.</param>
    /// <param name="existing">The current row, already loaded by the revision gate, or null when none exists yet.</param>
    /// <returns>The new revision number.</returns>
    private async Task<long> UpsertBucketAsync(AliasServerDbContext context, string userId, VaultDataBucketCategory kind, string encryptedData, string? ciphertextHash, long? currentRevision, VaultDataBucket? existing)
    {
        var now = timeProvider.UtcNow;

        if (existing is null)
        {
            var firstRev = (currentRevision ?? 0) + 1;
            context.VaultDataBuckets.Add(new VaultDataBucket
            {
                OwnerUserId = userId,
                Category = kind,
                EncryptedData = encryptedData,
                CiphertextHash = ciphertextHash,
                RevisionNumber = firstRev,
                CreatedAt = now,
                UpdatedAt = now,
            });
            return firstRev;
        }

        // Archive the outgoing revision before overwriting it, exactly as the manifest write path does.
        var archived = VaultDataBucketsHistory.CreateFrom(existing);
        context.VaultDataBucketsHistory.Add(archived);

        var newRev = existing.RevisionNumber + 1;
        existing.EncryptedData = encryptedData;
        existing.CiphertextHash = ciphertextHash;
        existing.RevisionNumber = newRev;
        existing.UpdatedAt = now;

        await ApplyBucketRetentionAsync(context, userId, kind, archived);
        return newRev;
    }

    /// <summary>
    /// Prunes superseded revisions of one bucket down to <see cref="_bucketRetentionPolicy"/>.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The bucket owner.</param>
    /// <param name="kind">The bucket category.</param>
    /// <param name="justArchived">The revision archived by this write, included in the retention window.</param>
    private async Task ApplyBucketRetentionAsync(AliasServerDbContext context, string userId, VaultDataBucketCategory kind, VaultDataBucketsHistory justArchived)
    {
        var history = await context.VaultDataBucketsHistory.Where(x => x.OwnerUserId == userId && x.Category == kind && x.RevisionNumber != justArchived.RevisionNumber).ToListAsync();
        history.Add(justArchived);

        var toDelete = VaultRetentionManager.ApplyRetention(_bucketRetentionPolicy, history, timeProvider.UtcNow);
        if (toDelete.Count > 0)
        {
            context.VaultDataBucketsHistory.RemoveRange(toDelete);
        }
    }

    /// <summary>
    /// Upserts a batch of encrypted blob objects for a user in one round-trip. Existing blobs (same hash) only get
    /// their LastReferencedAt bumped, unless <paramref name="overwrite"/> is set (KEK/VEK migration) in which case
    /// their ciphertext is replaced with the re-encrypted bytes. The caller of this method should call SaveChanges after calling this method.
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
                // Already have it (or a duplicate within this batch), bump LastReferencedAt so garbage collector leaves it alone.
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

    /// <summary>
    /// Builds the email routing DTO for a user.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="user">The user.</param>
    /// <returns>The email routing DTO.</returns>
    private async Task<EmailRouting> BuildEmailRoutingAsync(AliasServerDbContext context, AliasVaultUser user)
    {
        var claims = await context.EmailClaims
            .Where(c => !c.Disabled && context.GroupMembers.Any(gm => gm.GroupId == c.VaultManifest!.OwnerGroupId && gm.UserId == user.Id && gm.Role == GroupRole.Owner))
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
    /// Applies the retention policy to the history revisions of a manifest and removes the pruned revisions and
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

        var revisionsToDelete = VaultRetentionManager.ApplyRetention(_manifestRetentionPolicy, historyRevisions, timeProvider.UtcNow, currentManifest);
        context.VaultManifestsHistory.RemoveRange(revisionsToDelete);

        // Blob references of pruned revisions are deleted explicitly (they only cascade with the whole manifest).
        var prunedRevisionNumbers = revisionsToDelete.Select(x => x.RevisionNumber).ToList();
        if (prunedRevisionNumbers.Count > 0)
        {
            await context.VaultBlobReferences.Where(r => r.ManifestId == currentManifest.ManifestId && prunedRevisionNumbers.Contains(r.RevisionNumber)).ExecuteDeleteAsync();
        }
    }

    /// <summary>
    /// Updates the email claims based on the routing data pushed by the client.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="user">The calling user.</param>
    /// <param name="routing">The pushed routing data: every claimed address with the manifest it is filed under.</param>
    private async Task UpdateEmailClaimsAsync(AliasServerDbContext context, AliasVaultUser user, EmailRoutingPush routing)
    {
        var accessibleManifests = await GetEmailClaimableManifestIdsAsync(context, user.Id, routing.EmailAddressList.Select(x => x.ManifestId));
        var ownerGroupByManifest = await GroupHelper.GetOwnerGroupsAsync(context, accessibleManifests);

        // Resolved server-side and never read off the push: this is what stops a client filing an alias under a manifest it merely named.
        var rootManifestId = await context.VaultManifests.Where(m => m.IsRoot && m.OwnerGroupId == user.PersonalGroupId).Select(m => (Guid?)m.ManifestId).FirstOrDefaultAsync();
        if (rootManifestId is null)
        {
            logger.LogError("No root manifest found for {User}; skipping email claim update.", user.UserName);
            return;
        }

        // Get the manifests with a delivery key.
        var manifestsWithDeliveryKey = (await context.VaultManifestDeliveryKeys
            .Where(k => accessibleManifests.Contains(k.VaultManifestId) && k.IsPrimary)
            .Select(k => k.VaultManifestId)
            .ToListAsync()).ToHashSet();

        var manifestByAddress = new Dictionary<string, Guid>();
        foreach (var claimed in routing.EmailAddressList)
        {
            var sanitizedClaimed = EmailHelper.SanitizeEmail(claimed.Address);
            if (!accessibleManifests.Contains(claimed.ManifestId))
            {
                logger.LogWarning("{User} claimed alias {Email} for manifest {Manifest} they cannot access; filing it under their own root manifest instead.", user.UserName, sanitizedClaimed, claimed.ManifestId);
                continue;
            }

            manifestByAddress[sanitizedClaimed] = claimed.ManifestId;
            if (claimed.ManifestId != rootManifestId.Value && !manifestsWithDeliveryKey.Contains(claimed.ManifestId))
            {
                logger.LogWarning("{User} claimed shared alias {Email} for manifest {Manifest} with no published delivery key; its mail stays readable by the routing owner alone until a delivery key is published.", user.UserName, sanitizedClaimed, claimed.ManifestId);
            }
        }

        var newEmailAddresses = routing.EmailAddressList
            .Select(x => EmailHelper.SanitizeEmail(x.Address))
            .Distinct()
            .ToList();

        // Get the claims this push may update: every claim whose manifest is owned by a group the caller owns, plus every claim belonging to a shared manifest they can currently access.
        var userOwnedEmailClaims = await context.EmailClaims
            .Where(x => context.GroupMembers.Any(gm => gm.GroupId == x.VaultManifest!.OwnerGroupId && gm.UserId == user.Id && gm.Role == GroupRole.Owner)
                || (x.VaultManifestId != null && accessibleManifests.Contains(x.VaultManifestId.Value)))
            .ToListAsync();
        var processed = new List<string>();
        var supportedDomains = config.PrivateEmailDomains;

        // Max-alias check: how many new aliases each quota subject (the group owning the manifest) may still create.
        var remainingAliases = await GetRemainingAliasAllowancesAsync(context, user, ownerGroupByManifest.Values);
        var limitLoggedFor = new HashSet<Guid>();

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

            // Which manifest the alias is filed against: the one the push named when the caller may claim for it, their own root otherwise.
            var resolvedManifestId = manifestByAddress.TryGetValue(sanitized, out var claimedManifestId) ? claimedManifestId : rootManifestId.Value;

            // The quota subject is the group owning that manifest: the shared manifest's group, or the caller's personal group.
            var quotaGroupId = ownerGroupByManifest.TryGetValue(resolvedManifestId, out var ownerGroupId) ? ownerGroupId : user.PersonalGroupId;

            var existing = userOwnedEmailClaims.FirstOrDefault(x => x.Address == sanitized);
            if (existing != null)
            {
                if (existing.Disabled)
                {
                    existing.Disabled = false;
                    existing.UpdatedAt = timeProvider.UtcNow;
                }

                // Re-point the claim when the alias moved into or out of a shared manifest.
                if (existing.VaultManifestId != resolvedManifestId)
                {
                    existing.VaultManifestId = resolvedManifestId;
                    existing.UpdatedAt = timeProvider.UtcNow;
                }

                continue;
            }

            var foreignClaim = await context.EmailClaims.FirstOrDefaultAsync(x => x.Address == sanitized);
            if (foreignClaim != null)
            {
                // The address already exists: either a genuine attempt on someone else's address, or a shared alias of a manifest this caller cannot access. Neither may touch the claim.
                logger.LogWarning("{User} tried to claim email already owned by another user: {Email}", user.UserName, sanitized);
                continue;
            }

            // Once the quota group's max is reached, silently skip creating further aliases charged to it
            // (logged once per group for audits), while aliases charged to other groups in the same push carry on.
            if (remainingAliases.TryGetValue(quotaGroupId, out var remaining))
            {
                if (remaining <= 0)
                {
                    if (limitLoggedFor.Add(quotaGroupId))
                    {
                        logger.LogWarning("Alias creation limit reached for group {QuotaGroup} (pushed by {User}). Skipping creation of additional aliases charged to it.", quotaGroupId, user.UserName);
                    }

                    continue;
                }

                remainingAliases[quotaGroupId] = remaining - 1;
            }

            context.EmailClaims.Add(new EmailClaim
            {
                VaultManifestId = resolvedManifestId,
                Address = sanitized,
                AddressLocal = sanitized.Split('@')[0],
                AddressDomain = sanitized.Split('@')[1],
                CreatedAt = timeProvider.UtcNow,
                UpdatedAt = timeProvider.UtcNow,
            });
        }

        // Disable claims that were not processed in this push and the user had access to (all active claims should be pushed on every change.)
        var disabledClaims = userOwnedEmailClaims.Where(x => !x.Disabled && !processed.Contains(x.Address)).ToList();
        foreach (var claim in disabledClaims)
        {
            claim.Disabled = true;
            claim.UpdatedAt = timeProvider.UtcNow;
        }

        context.EmailClaims.UpdateRange(disabledClaims);
    }

    /// <summary>
    /// Gets how many new aliases each quota subject may still create. The subject is the group that owns the manifest
    /// the alias is filed under: the caller's personal group for personal aliases, and the owning group of each shared
    /// manifest this push adds aliases to. Both the rules (see <see cref="RateLimit"/>) and the consumption they are
    /// measured against are scoped to that group, so a shared group's aliases never drain the caller's personal
    /// allowance. When multiple limits apply to a group the strictest one wins. Groups without any configured limit
    /// are absent from the result (unlimited).
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="caller">The pushing user; their personal group is always a subject via their personal aliases.</param>
    /// <param name="sharedGroupIds">The owning group of each shared manifest in this push.</param>
    /// <returns>Remaining alias amount per quota group, for the groups that have limits at all.</returns>
    private async Task<Dictionary<Guid, int>> GetRemainingAliasAllowancesAsync(AliasServerDbContext context, AliasVaultUser caller, IEnumerable<Guid> sharedGroupIds)
    {
        // The caller's personal group is always in play; the shared manifests add their owning groups on top.
        var subjectIds = sharedGroupIds.Append(caller.PersonalGroupId).Distinct().ToList();
        var subjects = await context.Groups.Where(g => subjectIds.Contains(g.Id)).ToListAsync();

        var remaining = new Dictionary<Guid, int>();
        foreach (var group in subjects)
        {
            var groupId = group.Id;
            foreach (var limit in await rateLimitService.GetLimitsAsync(group, RateLimitType.AliasCreation))
            {
                int currentCount;
                if (limit.WindowSeconds == 0)
                {
                    // Global absolute cap: every claim ever charged to this group (including disabled ones).
                    currentCount = await context.EmailClaims.CountAsync(x => x.VaultManifest!.OwnerGroupId == groupId);
                }
                else
                {
                    // Time-based cap: aliases created within the rolling window (create-then-delete still counts).
                    var windowStart = timeProvider.UtcNow.AddSeconds(-limit.WindowSeconds);
                    currentCount = await context.EmailClaims.CountAsync(x => x.CreatedAt >= windowStart && x.VaultManifest!.OwnerGroupId == groupId);
                }

                var allowed = limit.MaxCount - currentCount;
                remaining[groupId] = remaining.TryGetValue(groupId, out var existing) ? Math.Min(existing, allowed) : allowed;
            }
        }

        return remaining;
    }

    /// <summary>
    /// Publishes <paramref name="newPublicKey"/> as the primary key of a manifest and demotes the previous one.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="vaultManifestId">
    /// The manifest this key belongs to: the caller's root manifest for their personal key, a shared manifest
    /// for its delivery key. Everything here is scoped by it, promoting a shared manifest's key must never demote
    /// the user's personal key, and rotating the personal key must never demote a shared manifest's delivery key. The key
    /// carries no user owner at all: it must survive the publishing admin deleting their account, and a later
    /// admin republishing must land on the same scope rather than a per-user copy.
    /// </param>
    /// <param name="newPublicKey">The public key to publish.</param>
    private async Task PublishManifestPublicKeyAsync(AliasServerDbContext context, Guid vaultManifestId, string newPublicKey)
    {
        var scope = context.VaultManifestDeliveryKeys.Where(x => x.VaultManifestId == vaultManifestId);

        var exists = await scope.AnyAsync(x => x.IsPrimary && x.PublicKey == newPublicKey);
        if (exists)
        {
            return;
        }

        var others = await scope.ToListAsync();
        foreach (var key in others)
        {
            key.IsPrimary = false;
            key.UpdatedAt = timeProvider.UtcNow;
        }

        var existingKey = others.FirstOrDefault(x => x.PublicKey == newPublicKey);
        if (existingKey != null)
        {
            existingKey.IsPrimary = true;
            existingKey.UpdatedAt = timeProvider.UtcNow;
            return;
        }

        context.VaultManifestDeliveryKeys.Add(new VaultManifestDeliveryKey
        {
            VaultManifestId = vaultManifestId,
            PublicKey = newPublicKey,
            IsPrimary = true,
            CreatedAt = timeProvider.UtcNow,
            UpdatedAt = timeProvider.UtcNow,
        });
    }
}
