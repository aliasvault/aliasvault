//-----------------------------------------------------------------------
// <copyright file="IdentityController.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.V1;

using AliasServerDb;
using AliasVault.Api.Controllers.Abstracts;
using AliasVault.Api.Helpers;
using Asp.Versioning;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Controller for generating identities taking into account existing information on the AliasVault server.
/// </summary>
/// <param name="userManager">UserManager instance.</param>
/// <param name="dbContextFactory">DbContextFactory instance.</param>
[ApiVersion("1")]
public class IdentityController(UserManager<AliasVaultUser> userManager, IAliasServerDbContextFactory dbContextFactory) : AuthenticatedRequestController(userManager)
{
    /// <summary>
    /// Verify that provided email address is not already taken by another user.
    /// </summary>
    /// <param name="email">The full email address to check.</param>
    /// <returns>True if the email address is already taken, false otherwise.</returns>
    [HttpPost("CheckEmail/{email}")]
    public async Task<IActionResult> CheckEmail(string email)
    {
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return Unauthorized();
        }

        bool isTaken = await EmailClaimExistsAsync(email);
        return Ok(new { isTaken });
    }

    /// <summary>
    /// Verify that provided email address is not already taken by another user.
    /// </summary>
    /// <param name="email">The email address to check.</param>
    /// <returns>True if the email address is already taken, false otherwise.</returns>
    private async Task<bool> EmailClaimExistsAsync(string email)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();

        var sanitizedEmail = EmailHelper.SanitizeEmail(email);
        var claimExists = await context.UserEmailClaims.FirstOrDefaultAsync(c => c.Address == sanitizedEmail);

        return claimExists != null;
    }
}
