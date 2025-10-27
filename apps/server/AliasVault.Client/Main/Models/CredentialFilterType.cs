//-----------------------------------------------------------------------
// <copyright file="CredentialFilterType.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Main.Models;

/// <summary>
/// Defines the filter type options for credentials.
/// </summary>
public enum CredentialFilterType
{
    /// <summary>
    /// Show all credentials.
    /// </summary>
    All,

    /// <summary>
    /// Show only credentials with passkeys.
    /// </summary>
    Passkeys,

    /// <summary>
    /// Show only credentials with alias fields.
    /// </summary>
    Aliases,

    /// <summary>
    /// Show only credentials with username/password (no aliases, no passkeys).
    /// </summary>
    Userpass,

    /// <summary>
    /// Show only credentials with attachments.
    /// </summary>
    Attachments,
}
