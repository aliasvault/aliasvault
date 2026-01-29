//-----------------------------------------------------------------------
// <copyright file="SrpEphemeral.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.JsInterop.RustCore;

/// <summary>
/// SRP Ephemeral keypair with public and secret components.
/// </summary>
public class SrpEphemeral
{
    /// <summary>
    /// Gets or sets the public ephemeral value (uppercase hex string).
    /// </summary>
    public string Public { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the secret ephemeral value (uppercase hex string).
    /// </summary>
    public string Secret { get; set; } = string.Empty;
}
