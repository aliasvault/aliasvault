//-----------------------------------------------------------------------
// <copyright file="LegacyVaultRollback.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasServerDb.Legacy;

using Microsoft.EntityFrameworkCore;

/// <summary>
/// Puts a migrated account back on the legacy sqlite-blob storage format.
/// TODO: remove together with the rest of the legacy storage format once every account has migrated.
/// </summary>
public static class LegacyVaultRollback
{
    /// <summary>
    /// Puts the account back on the legacy storage format by making one of its legacy revisions current again and
    /// removing everything that only exists on the manifest format. Runs as a single transaction.
    /// </summary>
    /// <param name="dbContextFactory">DbContext factory, so the work can be retried as one unit.</param>
    /// <param name="userId">The account being reverted.</param>
    /// <param name="manifestId">The account's personal manifest.</param>
    /// <param name="legacyRevisionNumber">The legacy revision to make current.</param>
    /// <returns>The revision number the restored payload is now current at.</returns>
    public static async Task<long> RevertAsync(IAliasServerDbContextFactory dbContextFactory, string userId, Guid manifestId, long legacyRevisionNumber)
    {
        await using var probeContext = await dbContextFactory.CreateDbContextAsync();
        var strategy = probeContext.Database.CreateExecutionStrategy();

        return await strategy.ExecuteAsync<long>(async () =>
        {
            await using var context = await dbContextFactory.CreateDbContextAsync();
            await using var transaction = await context.Database.BeginTransactionAsync();

            var manifest = await context.VaultManifests.FirstAsync(x => x.ManifestId == manifestId);
            var legacyRevision = await context.VaultManifestsHistory
                .FirstAsync(x => x.ManifestId == manifestId && x.RevisionNumber == legacyRevisionNumber && x.StorageFormat == VaultManifestBase.LegacyStorageFormat);

            // The restored payload becomes current one revision above the previous current, so every client still
            // sees the manifest move forward and pulls it, as it does after any other admin restore.
            var newRevisionNumber = manifest.RevisionNumber + 1;
            manifest.CopyPayloadFrom(legacyRevision);
            manifest.RevisionNumber = newRevisionNumber;
            context.VaultManifestsHistory.Remove(legacyRevision);
            await context.SaveChangesAsync();

            // Every manifest-v1 revision is sealed with the VEK removed below, so none of them can ever be opened
            // again. They are dropped rather than left as restorable rows that would brick the account.
            await context.VaultManifestsHistory.Where(x => x.ManifestId == manifestId && x.StorageFormat == VaultManifestBase.ManifestStorageFormat).ExecuteDeleteAsync();

            // Blob objects only exist on the manifest format; the legacy format carries its attachments inside the
            // vault blob itself. The stored bytes go with the references rather than waiting for the sweeper.
            await context.VaultBlobReferences.Where(x => x.ManifestId == manifestId).ExecuteDeleteAsync();
            await context.VaultBlobObjects.Where(x => x.OwnerUserId == userId).ExecuteDeleteAsync();

            // Data buckets only exist on the manifest format; their superseded revisions cascade with them. Leaving
            // them behind would also block the next migration, whose first push writes each bucket from revision 0.
            await context.VaultDataBuckets.Where(x => x.ManifestId == manifestId).ExecuteDeleteAsync();

            /*
             * The account key hierarchy. Without it the v1 endpoints serve this account again, the SRP credentials
             * come from the restored manifest revision, and the client falls back to the password-derived key,
             * which is what the restored blob is encrypted with.
             */
            await context.VaultManifestAccessKeys.Where(x => x.UserId == userId).ExecuteDeleteAsync();
            await context.UserGrantKeys.Where(x => x.UserId == userId).ExecuteDeleteAsync();
            await context.UserUnlockKeysHistory.Where(x => x.UserId == userId).ExecuteDeleteAsync();
            await context.UserUnlockKeys.Where(x => x.UserId == userId).ExecuteDeleteAsync();

            // Both the login credentials and the session key change, so every device has to authenticate again.
            await context.AliasVaultUserRefreshTokens.Where(x => x.UserId == userId).ExecuteDeleteAsync();

            await transaction.CommitAsync();
            return newRevisionNumber;
        });
    }
}
