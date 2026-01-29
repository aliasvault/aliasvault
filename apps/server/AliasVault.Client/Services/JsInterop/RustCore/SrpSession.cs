//-----------------------------------------------------------------------
// <copyright file="SrpSession.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.JsInterop.RustCore;

/// <summary>
/// SRP Session with key and proof.
/// </summary>
public class SrpSession
{
    /// <summary>
    /// Gets or sets the session key (uppercase hex string).
    /// </summary>
    public string Key { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the session proof (uppercase hex string).
    /// </summary>
    public string Proof { get; set; } = string.Empty;
}
