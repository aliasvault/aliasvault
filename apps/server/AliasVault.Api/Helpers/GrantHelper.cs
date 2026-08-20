//-----------------------------------------------------------------------
// <copyright file="GrantHelper.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

using AliasServerDb;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi.V2.Groups;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Grant helper for shared manifests.
/// </summary>
public static class GrantHelper
{
    /// <summary>
    /// Build one recipient's grant on a manifest.
    /// </summary>
    /// <param name="manifestId">The manifest ID.</param>
    /// <param name="userId">The recipient user ID.</param>
    /// <param name="publicKeyId">The recipient public key ID.</param>
    /// <param name="encryptedVek">The encrypted VEK.</param>
    /// <param name="algorithm">The algorithm it was encrypted with.</param>
    /// <param name="now">Current time.</param>
    /// <returns>The unpersisted grant.</returns>
    public static VaultManifestAccessKey BuildGrant(Guid manifestId, string userId, Guid publicKeyId, string encryptedVek, VaultKeyAlgorithm algorithm, DateTime now)
    {
        return new VaultManifestAccessKey
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            VaultManifestId = manifestId,
            Type = ManifestKeyType.GrantKey,
            Algorithm = algorithm,
            EncryptedVek = encryptedVek,
            UserGrantKeyId = publicKeyId,
            CreatedAt = now,
            UpdatedAt = now,
        };
    }

    /// <summary>
    /// Get the users holding a grant on each of the given manifests.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="manifestIds">The manifests to look at.</param>
    /// <returns>Manifest id to the user ids holding a grant on it.</returns>
    public static async Task<Dictionary<Guid, HashSet<string>>> GetGrantHoldersByManifestAsync(AliasServerDbContext context, List<Guid> manifestIds)
    {
        return (await context.VaultManifestAccessKeys
                .Where(k => manifestIds.Contains(k.VaultManifestId) && k.Type == ManifestKeyType.GrantKey)
                .Select(k => new { k.VaultManifestId, k.UserId })
                .ToListAsync())
            .GroupBy(k => k.VaultManifestId)
            .ToDictionary(g => g.Key, g => g.Select(k => k.UserId).ToHashSet(StringComparer.Ordinal));
    }

    /// <summary>
    /// Get the primary public key of each given user.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="userIds">The user IDs to look up.</param>
    /// <returns>User ID to their grant recipient details.</returns>
    public static async Task<Dictionary<string, GrantRecipient>> GetPrimaryKeysAsync(AliasServerDbContext context, IEnumerable<string> userIds)
    {
        var ids = userIds.Distinct(StringComparer.Ordinal).ToList();
        if (ids.Count == 0)
        {
            return [];
        }

        return await context.UserGrantKeys
            .Where(k => ids.Contains(k.UserId) && k.IsPrimary)
            .ToDictionaryAsync(k => k.UserId, k => new GrantRecipient { UserId = k.UserId, PublicKeyId = k.Id, PublicKey = k.PublicKey });
    }

    /// <summary>
    /// Take a user's access to a shared manifest away.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="manifestId">The shared manifest.</param>
    /// <param name="userId">The user losing access.</param>
    /// <returns>True when the user actually held a grant, i.e. when something was revoked.</returns>
    public static async Task<bool> RevokeAccessAsync(AliasServerDbContext context, Guid manifestId, string userId)
    {
        var grants = await context.VaultManifestAccessKeys
            .Where(k => k.VaultManifestId == manifestId && k.UserId == userId && k.Type == ManifestKeyType.GrantKey)
            .ToListAsync();

        if (grants.Count == 0)
        {
            return false;
        }

        context.VaultManifestAccessKeys.RemoveRange(grants);

        var personalGroupId = await GroupHelper.GetPersonalGroupIdAsync(context, userId);
        if (personalGroupId is not null)
        {
            await context.EmailClaimLinks
                .Where(l => l.VaultManifest.OwnerGroupId == personalGroupId.Value && context.EmailClaimLinks.Any(s => s.EmailClaimId == l.EmailClaimId && s.VaultManifestId == manifestId))
                .ExecuteUpdateAsync(s => s.SetProperty(l => l.State, EmailClaimLinkState.Removed));
        }

        return true;
    }
}
