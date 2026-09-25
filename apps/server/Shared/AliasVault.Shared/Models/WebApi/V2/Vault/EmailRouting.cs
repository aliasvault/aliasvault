//-----------------------------------------------------------------------
// <copyright file="EmailRouting.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Email-routing plaintext data returned on a vault read. The push direction has its own model,
/// <see cref="EmailRoutingPush"/>, which carries the owning manifest of every address.
/// </summary>
public class EmailRouting
{
    /// <summary>Gets or sets the user's claimed email addresses (forwarded inbound).</summary>
    public List<string> EmailAddressList { get; set; } = [];

    /// <summary>Gets or sets the private email domains available to this user.</summary>
    public List<string> PrivateEmailDomainList { get; set; } = [];

    /// <summary>Gets or sets the private email domains hidden in UI but still functional.</summary>
    public List<string> HiddenPrivateEmailDomainList { get; set; } = [];

    /// <summary>Gets or sets the publicly available email domains.</summary>
    public List<string> PublicEmailDomainList { get; set; } = [];
}
