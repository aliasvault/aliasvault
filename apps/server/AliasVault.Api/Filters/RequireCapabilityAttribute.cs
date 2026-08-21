//-----------------------------------------------------------------------
// <copyright file="RequireCapabilityAttribute.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Filters;

using System.Security.Claims;
using AliasVault.Api.Headers;
using AliasVault.Api.Services;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi;
using AliasVault.Shared.Server.Capabilities;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

/// <summary>
/// Refuses the request when the capability is not enabled for the calling account.
/// </summary>
/// <param name="capabilityKey">The capability key to require, from <see cref="CapabilityKeys"/>.</param>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class RequireCapabilityAttribute(string capabilityKey) : Attribute, IAsyncAuthorizationFilter
{
    /// <inheritdoc />
    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var userId = context.HttpContext.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId is null)
        {
            context.Result = new UnauthorizedResult();
            return;
        }

        var capabilityService = context.HttpContext.RequestServices.GetRequiredService<CapabilityService>();
        var clientHeader = context.HttpContext.Request.Headers[ClientHeaderInfo.HeaderName].FirstOrDefault();
        if (await capabilityService.IsEnabledAsync(userId, capabilityKey, clientHeader))
        {
            return;
        }

        context.Result = new ObjectResult(ApiErrorCodeHelper.CreateErrorResponse(ApiErrorCode.CAPABILITY_NOT_AVAILABLE, StatusCodes.Status403Forbidden)) { StatusCode = StatusCodes.Status403Forbidden };
    }
}
