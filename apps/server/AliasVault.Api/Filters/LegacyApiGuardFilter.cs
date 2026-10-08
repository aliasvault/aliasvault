//-----------------------------------------------------------------------
// <copyright file="LegacyApiGuardFilter.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Filters;

using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using AliasServerDb;
using AliasVault.Api.Helpers;
using AliasVault.Auth;
using AliasVault.Shared.Models.WebApi.V1.Auth;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

/// <summary>
/// Refuses every v1 request on behalf of a user who migrated to the v2 storage format, so v1 code paths can no
/// longer act on such an account. Registered globally; exempt an action with <see cref="AllowAfterV2MigrationAttribute"/>.
/// </summary>
/// <param name="dbContextFactory">AliasServerDbContext factory.</param>
/// <param name="userManager">UserManager instance.</param>
/// <param name="cache">Memory cache for the migration state.</param>
public sealed class LegacyApiGuardFilter(IAliasServerDbContextFactory dbContextFactory, UserManager<AliasVaultUser> userManager, IMemoryCache cache) : IAsyncActionFilter
{
    /// <inheritdoc />
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (context.HttpContext.RequestedApiVersion?.MajorVersion != 1 || IsExempt(context))
        {
            await next();
            return;
        }

        await using var dbContext = await dbContextFactory.CreateDbContextAsync();
        foreach (var userId in await ResolveUserIdsAsync(context, dbContext))
        {
            if (userId is null || await LegacyVaultHelper.HasMigratedToV2Async(dbContext, cache, userId))
            {
                context.Result = LegacyVaultHelper.UpgradeRequiredResult();
                return;
            }
        }

        await next();
    }

    /// <summary>
    /// Whether the action or its controller carries <see cref="AllowAfterV2MigrationAttribute"/>.
    /// </summary>
    /// <param name="context">The action context.</param>
    /// <returns>True when the action is exempt.</returns>
    private static bool IsExempt(ActionExecutingContext context)
    {
        return context.ActionDescriptor is ControllerActionDescriptor descriptor
            && (descriptor.MethodInfo.IsDefined(typeof(AllowAfterV2MigrationAttribute), true) || descriptor.ControllerTypeInfo.IsDefined(typeof(AllowAfterV2MigrationAttribute), true));
    }

    /// <summary>
    /// Reads the subject of a JWT without validating it. Only used to refuse a request, never to allow one.
    /// </summary>
    /// <param name="token">The JWT.</param>
    /// <returns>The user id, or null when the token cannot be read.</returns>
    private static string? ReadUnvalidatedSubject(string? token)
    {
        var handler = new JwtSecurityTokenHandler();
        if (string.IsNullOrWhiteSpace(token) || !handler.CanReadToken(token))
        {
            return null;
        }

        return handler.ReadJwtToken(token).Claims.FirstOrDefault(c => c.Type == ClaimTypes.NameIdentifier)?.Value;
    }

    /// <summary>
    /// Adds the owner of the refresh token and the subject of the access token, when known.
    /// </summary>
    /// <param name="dbContext">Database context.</param>
    /// <param name="tokens">The token pair from the request body.</param>
    /// <param name="userIds">The list to add to.</param>
    /// <returns>Task.</returns>
    private static async Task AddTokenUserIdsAsync(AliasServerDbContext dbContext, TokenModel tokens, List<string?> userIds)
    {
        var subject = ReadUnvalidatedSubject(tokens.Token);
        if (subject is not null)
        {
            userIds.Add(subject);
        }

        if (string.IsNullOrWhiteSpace(tokens.RefreshToken))
        {
            return;
        }

        var tokenHash = RefreshTokenHasher.Hash(tokens.RefreshToken);
        var owner = await dbContext.AliasVaultUserRefreshTokens.Where(t => t.TokenHash == tokenHash).Select(t => t.UserId).FirstOrDefaultAsync();
        if (owner is not null)
        {
            userIds.Add(owner);
        }
    }

    /// <summary>
    /// Collects the users this request acts on. A null entry stands for a username that does not exist.
    /// </summary>
    /// <param name="context">The action context.</param>
    /// <param name="dbContext">Database context.</param>
    /// <returns>The user ids to check.</returns>
    private async Task<List<string?>> ResolveUserIdsAsync(ActionExecutingContext context, AliasServerDbContext dbContext)
    {
        var userIds = new List<string?>();

        var principalUserId = context.HttpContext.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (principalUserId is not null)
        {
            userIds.Add(principalUserId);
        }

        foreach (var argument in context.ActionArguments.Values)
        {
            switch (argument)
            {
                case LoginInitiateRequest login:
                    userIds.Add((await userManager.FindByNameAsync(login.Username))?.Id);
                    break;
                case ValidateLoginRequest validate:
                    userIds.Add((await userManager.FindByNameAsync(validate.Username))?.Id);
                    break;
                case TokenModel tokens:
                    await AddTokenUserIdsAsync(dbContext, tokens, userIds);
                    break;
            }
        }

        return userIds;
    }
}
