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
    /// Get the ids of every group the user owns.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The user.</param>
    /// <returns>The owned group ids.</returns>
    public static async Task<List<Guid>> GetOwnedGroupIdsAsync(AliasServerDbContext context, string userId)
    {
        return await context.GroupMembers.Where(m => m.UserId == userId && m.Role == GroupRole.Owner).Select(m => m.GroupId).ToListAsync();
    }

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
    /// Get the root manifest of a personal group, i.e. the manifest a user's personal keys and
    /// personal aliases are scoped to.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="personalGroupId">The user's personal group.</param>
    /// <returns>The root manifest id, or null when the group has none.</returns>
    public static async Task<Guid?> GetRootManifestIdAsync(AliasServerDbContext context, Guid personalGroupId)
    {
        return await context.VaultManifests.Where(m => m.IsRoot && m.OwnerGroupId == personalGroupId).Select(m => (Guid?)m.ManifestId).FirstOrDefaultAsync();
    }

    /// <summary>
    /// Check if the user may administer the shared manifest.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="manifestId">The shared manifest.</param>
    /// <param name="userId">The user.</param>
    /// <returns>True when the user can administer the manifest.</returns>
    public static async Task<bool> CanAdministerManifestAsync(AliasServerDbContext context, Guid manifestId, string userId)
    {
        var groupId = await context.VaultManifests
            .Where(m => m.ManifestId == manifestId && !m.IsRoot)
            .Select(m => (Guid?)m.OwnerGroupId)
            .FirstOrDefaultAsync();

        return groupId is not null && await IsGroupAdminAsync(context, groupId.Value, userId);
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

    /// <summary>
    /// Adds the user to the group as a plain member when they are not already in it.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="groupId">The group.</param>
    /// <param name="userId">The user to add.</param>
    /// <param name="now">Current time.</param>
    /// <returns>A task.</returns>
    public static async Task EnsureMembershipAsync(AliasServerDbContext context, Guid groupId, string userId, DateTime now)
    {
        var exists = await context.GroupMembers.AnyAsync(m => m.GroupId == groupId && m.UserId == userId);
        if (exists)
        {
            return;
        }

        context.GroupMembers.Add(new GroupMember
        {
            Id = Guid.NewGuid(),
            GroupId = groupId,
            UserId = userId,
            Role = GroupRole.Member,
            CreatedAt = now,
            UpdatedAt = now,
        });
    }
}
