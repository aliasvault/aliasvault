//-----------------------------------------------------------------------
// <copyright file="EmailDomains.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// The email domains this server serves.
/// </summary>
public class EmailDomains
{
    /// <summary>Gets or sets the private email domains available to this user, hidden ones included.</summary>
    public List<string> PrivateEmailDomainList { get; set; } = [];

    /// <summary>Gets or sets the private email domains hidden in UI but still functional.</summary>
    public List<string> HiddenPrivateEmailDomainList { get; set; } = [];

    /// <summary>Gets or sets the publicly available email domains.</summary>
    public List<string> PublicEmailDomainList { get; set; } = [];
}
