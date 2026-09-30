// -----------------------------------------------------------------------
// <copyright file="TimeValidationJwtBearerEvents.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
// -----------------------------------------------------------------------

namespace AliasVault.Api.Jwt;

using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.JsonWebTokens;

/// <summary>
/// JwtBearerEvents implementation that validates the token expiration time based on
/// the current time provided by the injected TimeProvider. This is used to be able to
/// test the token expiration logic in unit tests.
/// </summary>
public class TimeValidationJwtBearerEvents(TimeProvider timeProvider) : JwtBearerEvents
{
    /// <summary>
    /// Validates the token expiration time based on the current time provided by the TimeProvider.
    /// </summary>
    /// <param name="context">TokenValidatedContext.</param>
    /// <returns>Async task.</returns>
    public override Task TokenValidated(TokenValidatedContext context)
    {
        if (context.SecurityToken is JsonWebToken jwtToken)
        {
            var now = timeProvider.GetUtcNow().UtcDateTime;
            if (jwtToken.ValidTo < now)
            {
                context.Fail("Token has expired.");
            }
        }

        return Task.CompletedTask;
    }
}
