//-----------------------------------------------------------------------
// <copyright file="ClientActionHelper.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

using AliasServerDb;
using AliasVault.Shared.Models.WebApi.V2.ClientActions;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// The queue of work the server hands to clients: things that became necessary because of something outside a
/// client's own context, and that only a client can finish because they need vault content or a key the server does not hold.
/// </summary>
public static class ClientActionHelper
{
    /// <summary>
    /// Get the actions addressed to a user.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="userId">The user ID.</param>
    /// <returns>The outstanding actions, oldest first.</returns>
    public static async Task<List<PendingClientAction>> GetPendingActionsAsync(AliasServerDbContext context, string userId)
    {
        var administeredGroupIds = await GroupHelper.GetAdministeredGroupIdsAsync(context, userId);
        var actions = await context.ClientActions
            .Where(a => a.TargetUserId == userId || (a.TargetGroupId != null && administeredGroupIds.Contains(a.TargetGroupId.Value)))
            .OrderBy(a => a.CreatedAt)
            .ToListAsync();

        return actions.ConvertAll(a => new PendingClientAction { Id = a.Id, Type = a.Type.ToString(), ManifestId = a.ManifestId, Payload = a.Payload });
    }

    /// <summary>
    /// Whether the user is one of the clients this action is addressed to, and may therefore report it done.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="action">The action.</param>
    /// <param name="userId">The user ID.</param>
    /// <returns>True when the user may complete it.</returns>
    public static async Task<bool> CanCompleteAsync(AliasServerDbContext context, ClientAction action, string userId)
    {
        if (string.Equals(action.TargetUserId, userId, StringComparison.Ordinal))
        {
            return true;
        }

        return action.TargetGroupId is not null && await GroupHelper.IsGroupAdminAsync(context, action.TargetGroupId.Value, userId);
    }

    /// <summary>
    /// Record work for the admins of a group, without queueing the same thing twice.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="type">The work to be done.</param>
    /// <param name="groupId">The group ID.</param>
    /// <param name="manifestId">The manifest ID (optional).</param>
    /// <param name="now">The current time.</param>
    /// <returns>The queued action, or the one already outstanding.</returns>
    public static async Task<ClientAction> EnqueueForGroupAsync(AliasServerDbContext context, ClientActionType type, Guid groupId, Guid? manifestId, DateTime now)
    {
        var existing = await context.ClientActions.FirstOrDefaultAsync(a => a.Type == type && a.TargetGroupId == groupId && a.ManifestId == manifestId);
        if (existing is not null)
        {
            return existing;
        }

        var action = new ClientAction
        {
            Id = Guid.NewGuid(),
            Type = type,
            TargetGroupId = groupId,
            ManifestId = manifestId,
            CreatedAt = now,
            UpdatedAt = now,
        };

        context.ClientActions.Add(action);
        return action;
    }
}
