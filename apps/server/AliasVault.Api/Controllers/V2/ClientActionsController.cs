//-----------------------------------------------------------------------
// <copyright file="ClientActionsController.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.V2;

using AliasServerDb;
using AliasVault.Api.Controllers.Abstracts;
using AliasVault.Api.Helpers;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi;
using Asp.Versioning;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Client action queue controller.
/// </summary>
/// <param name="dbContextFactory">The database context factory.</param>
/// <param name="userManager">The user manager.</param>
[ApiVersion("2")]
public class ClientActionsController(IAliasServerDbContextFactory dbContextFactory, UserManager<AliasVaultUser> userManager) : AuthenticatedRequestController(userManager)
{
    /// <summary>
    /// Report an action carried out, which removes it from the queue.
    /// </summary>
    /// <param name="id">The action ID.</param>
    /// <returns>Ok when the action is no longer outstanding.</returns>
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Complete(Guid id)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return Unauthorized();
        }

        var action = await context.ClientActions.FirstOrDefaultAsync(a => a.Id == id);
        if (action is null)
        {
            return Ok();
        }

        if (!await ClientActionHelper.CanCompleteAsync(context, action, me.Id))
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.CLIENT_ACTION_NOT_FOUND, 404));
        }

        context.ClientActions.Remove(action);
        await context.SaveChangesAsync();

        return Ok();
    }
}
