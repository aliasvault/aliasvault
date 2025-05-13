//-----------------------------------------------------------------------
// <copyright file="Config.cs" company="lanedirt">
// Copyright (c) lanedirt. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api;

using AliasVault.Shared.Models.Configuration;

/// <summary>
/// Configuration class for the Client project with values loaded from appsettings.json.
/// </summary>
public class Config : SharedConfig
{
    /// <summary>
    /// Gets or sets a value indicating whether public registration is enabled.
    /// </summary>
    public bool PublicRegistrationEnabled { get; set; }

    /// <summary>
    /// Gets or sets the list of private email domains that are available.
    /// </summary>
    public List<string> PrivateEmailDomains { get; set; } = [];
}
