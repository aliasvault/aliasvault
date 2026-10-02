//-----------------------------------------------------------------------
// <copyright file="TestConfig.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.V2.Tests;

#if DEBUG

/// <summary>
/// Config used in DEBUG builds running in Development, where an E2E test can override values for its own requests via
/// request headers.
/// </summary>
/// <param name="httpContextAccessor">IHttpContextAccessor instance.</param>
public class TestConfig(IHttpContextAccessor httpContextAccessor) : Config
{
    /// <summary>
    /// Request header that disables public registration for that request.
    /// </summary>
    public const string DisablePublicRegistrationHeader = "X-AliasVault-Test-Disable-Public-Registration";

    /// <inheritdoc />
    public override bool PublicRegistrationEnabled
    {
        get => !HasHeader(DisablePublicRegistrationHeader) && base.PublicRegistrationEnabled;
        set => base.PublicRegistrationEnabled = value;
    }

    private bool HasHeader(string name) => httpContextAccessor.HttpContext?.Request.Headers.ContainsKey(name) ?? false;
}
#endif
