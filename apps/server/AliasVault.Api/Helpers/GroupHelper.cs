//-----------------------------------------------------------------------
// <copyright file="GroupHelper.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

using AliasServerDb;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Helper for group operations.
/// </summary>
public static class GroupHelper
{
    /// <summary>
    /// Get the ids of every group the user may administer.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The user.</param>
    /// <returns>The administered group ids.</returns>
    public static async Task<List<Guid>> GetAdministeredGroupIdsAsync(AliasServerDbContext context, string userId)
    {
        return await context.GroupMembers.Where(m => m.UserId == userId && (m.Role == GroupRole.Owner || m.Role == GroupRole.Admin)).Select(m => m.GroupId).ToListAsync();
    }

    /// <summary>
    /// Create a new user's personal group in memory.
    /// </summary>
    /// <param name="user">The user the group belongs to.</param>
    /// <param name="now">Current time.</param>
    /// <returns>The unpersisted personal group.</returns>
    public static Group CreatePersonalGroup(AliasVaultUser user, DateTime now)
    {
        var group = new Group
        {
            Id = Guid.NewGuid(),
            Name = user.UserName ?? "Personal",
            Type = GroupType.Personal,
            CreatedAt = now,
            UpdatedAt = now,
        };

        user.PersonalGroupId = group.Id;
        return group;
    }

    /// <summary>
    /// Check whether the caller may administer a <see cref="GroupType.Shared"/> group.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="groupId">The shared group ID.</param>
    /// <param name="userId">The user ID.</param>
    /// <returns>False when the group does not exist, is not a shared group, or the caller may not administer it.</returns>
    public static async Task<bool> IsSharedGroupAdminAsync(AliasServerDbContext context, Guid groupId, string userId)
    {
        return await context.Groups.AnyAsync(g => g.Id == groupId
            && g.Type == GroupType.Shared
            && g.Members.Any(m => m.UserId == userId && (m.Role == GroupRole.Owner || m.Role == GroupRole.Admin)));
    }

    /// <summary>
    /// Create the owner's membership row for a group in memory.
    /// </summary>
    /// <param name="group">The group.</param>
    /// <param name="userId">The owning user.</param>
    /// <param name="now">Current time.</param>
    /// <returns>The unpersisted membership.</returns>
    public static GroupMember CreateOwnerMembership(Group group, string userId, DateTime now)
    {
        return new GroupMember
        {
            Id = Guid.NewGuid(),
            GroupId = group.Id,
            UserId = userId,
            Role = GroupRole.Owner,
            CreatedAt = now,
            UpdatedAt = now,
        };
    }

    /// <summary>
    /// Check if the user may administer the group.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="groupId">The group.</param>
    /// <param name="userId">The user.</param>
    /// <returns>True when the user is an owner or admin of the group.</returns>
    public static async Task<bool> IsGroupAdminAsync(AliasServerDbContext context, Guid groupId, string userId)
    {
        return await context.GroupMembers.AnyAsync(m => m.GroupId == groupId && m.UserId == userId && (m.Role == GroupRole.Admin || m.Role == GroupRole.Owner));
    }

    /// <summary>
    /// The manifests owned by a <see cref="GroupType.Shared"/> group, i.e. every manifest that is somebody's shared
    /// vault rather than somebody's personal one.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <returns>Query over the shared manifests.</returns>
    public static IQueryable<VaultManifest> SharedManifests(AliasServerDbContext context)
    {
        return context.VaultManifests.Where(m => m.OwnerGroup.Type == GroupType.Shared);
    }

    /// <summary>
    /// Get the id of the user's personal group, the group owning everything that is theirs alone. Every user has
    /// exactly one, created with the account and enforced by the unique <c>UX_AliasVaultUsers_PersonalGroupId</c>.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The user.</param>
    /// <returns>The personal group id, or null when the user does not exist.</returns>
    public static async Task<Guid?> GetPersonalGroupIdAsync(AliasServerDbContext context, string userId)
    {
        return await context.AliasVaultUsers.Where(u => u.Id == userId).Select(u => (Guid?)u.PersonalGroupId).FirstOrDefaultAsync();
    }

    /// <summary>
    /// Get the personal manifest of a personal group, i.e. the manifest a user's personal keys and personal aliases
    /// are scoped to.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="personalGroupId">The user's personal group.</param>
    /// <returns>The personal manifest id, or null when the group has none.</returns>
    public static async Task<Guid?> GetPersonalManifestIdAsync(AliasServerDbContext context, Guid personalGroupId)
    {
        return await context.VaultManifests.Where(m => m.OwnerGroupId == personalGroupId).Select(m => (Guid?)m.ManifestId).FirstOrDefaultAsync();
    }

    /// <summary>
    /// Get the owning group of each manifest. That group is the quota subject for everything filed under the manifest:
    /// both the rate-limit rules and the usage they are measured against are scoped to it.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="manifestIds">The manifests to get the owning group of.</param>
    /// <returns>Manifest id to owning group id.</returns>
    public static async Task<Dictionary<Guid, Guid>> GetOwnerGroupsAsync(AliasServerDbContext context, IEnumerable<Guid> manifestIds)
    {
        var ids = manifestIds.Distinct().ToList();
        if (ids.Count == 0)
        {
            return [];
        }

        return await context.VaultManifests
            .Where(m => ids.Contains(m.ManifestId))
            .ToDictionaryAsync(m => m.ManifestId, m => m.OwnerGroupId);
    }
}
