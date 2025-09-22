//-----------------------------------------------------------------------
// <copyright file="SecurityController.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.Security;

using AliasServerDb;
using AliasVault.Api.Controllers.Abstracts;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi.Security;
using Asp.Versioning;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Security controller for handling security related actions such as showing auth logs or revoking sessions for user.
/// </summary>
/// <param name="dbContextFactory">AliasServerDbContext instance.</param>
/// <param name="userManager">UserManager instance.</param>
[Route("v{version:apiVersion}/[controller]")]
[ApiController]
[ApiVersion("1")]
public class SecurityController(IAliasServerDbContextFactory dbContextFactory, UserManager<AliasVaultUser> userManager) : AuthenticatedRequestController(userManager)
{
    /// <summary>
    /// Returns list of active sessions (refresh tokens) for the current user.
    /// </summary>
    /// <returns>Task with list of active refresh tokens.</returns>
    [HttpGet("sessions")]
    public async Task<IActionResult> Sessions()
    {
        var user = await GetCurrentUserAsync();
        if (user is null)
        {
            return Unauthorized("Not authenticated.");
        }

        await using var context = await dbContextFactory.CreateDbContextAsync();

        var refreshTokenList = await context.AliasVaultUserRefreshTokens.Where(x => x.UserId == user.Id).Select(x => new RefreshTokenModel()
            {
                Id = x.Id,
                DeviceIdentifier = x.DeviceIdentifier,
                ExpireDate = x.ExpireDate,
                CreatedAt = x.CreatedAt,
            })
            .Where(x => x.ExpireDate > DateTime.UtcNow)
            .OrderByDescending(x => x.CreatedAt)
            .ToListAsync();

        return Ok(refreshTokenList);
    }

    /// <summary>
    /// Revokes a specific user session (refresh token).
    /// </summary>
    /// <param name="id">The ID of the refresh token to revoke.</param>
    /// <returns>Http200 if success.</returns>
    [HttpDelete("sessions/{id}")]
    public async Task<IActionResult> RevokeSession(Guid id)
    {
        var user = await GetCurrentUserAsync();
        if (user is null)
        {
            return Unauthorized("Not authenticated.");
        }

        await using var context = await dbContextFactory.CreateDbContextAsync();

        var refreshToken = await context.AliasVaultUserRefreshTokens
            .FirstOrDefaultAsync(x => x.Id == id && x.UserId == user.Id);

        if (refreshToken == null)
        {
            return NotFound("Session not found or does not belong to the current user.");
        }

        context.AliasVaultUserRefreshTokens.Remove(refreshToken);
        await context.SaveChangesAsync();

        return Ok();
    }

    /// <summary>
    /// Returns the last 50 authentication logs for the current user.
    /// </summary>
    /// <returns>Task with a list of the last 50 authentication logs.</returns>
    [HttpGet("authlogs")]
    public async Task<IActionResult> GetUserAuthLogs()
    {
        var user = await GetCurrentUserAsync();
        if (user is null)
        {
            return Unauthorized("Not authenticated.");
        }

        await using var context = await dbContextFactory.CreateDbContextAsync();

        var authLogs = await context.AuthLogs
            .Where(x => x.Username == user.UserName)
            .Where(x => x.EventType != AuthEventType.TokenRefresh)
            .OrderByDescending(x => x.Timestamp)
            .Take(50)
            .Select(x => new AuthLogModel
            {
                Id = x.Id,
                Timestamp = x.Timestamp,
                EventType = x.EventType,
                Username = x.Username,
                IpAddress = x.IpAddress ?? string.Empty,
                Client = x.Client ?? string.Empty,
                IsSuccess = x.IsSuccess,
            })
            .ToListAsync();

        return Ok(authLogs);
    }
}
