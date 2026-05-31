//-----------------------------------------------------------------------
// <copyright file="EmailViewMode.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Main.Components.Email;

/// <summary>
/// Available view modes for rendering an email body.
/// </summary>
public enum EmailViewMode
{
    /// <summary>Rendered HTML (sanitized) in a sandboxed iframe.</summary>
    Html,

    /// <summary>Plain-text part rendered with a sans-serif font.</summary>
    Plain,

    /// <summary>Raw email source content as received by the email server.</summary>
    Source,
}
