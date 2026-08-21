//-----------------------------------------------------------------------
// <copyright file="AuthenticatedRequestController.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.Abstracts;

using System.Security.Claims;
using AliasServerDb;
using AliasVault.Api.Headers;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;

/// <summary>
/// Base controller that concrete controllers can extend from if all requests require authentication.
/// </summary>
/// <param name="userManager">UserManager instance.</param>
[Route("v{version:apiVersion}/[controller]")]
[ApiController]
[Authorize]
public abstract class AuthenticatedRequestController(UserManager<AliasVaultUser> userManager) : ControllerBase
{
    /// <summary>
    /// Gets the raw client header the current request arrived with.
    /// </summary>
    protected string? ClientHeader => Request.Headers[ClientHeaderInfo.HeaderName].FirstOrDefault();

    /// <summary>
    /// Get the userManager instance.
    /// </summary>
    /// <returns>UserManager instance.</returns>
    protected UserManager<AliasVaultUser> GetUserManager() => userManager;

    /// <summary>
    /// Get the current authenticated user.
    /// </summary>
    /// <returns>AliasVaultUser object for current user.</returns>
    protected async Task<AliasVaultUser?> GetCurrentUserAsync()
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? throw new InvalidOperationException("Unable to find user ID.");
        return await userManager.FindByIdAsync(userId);
    }
}
