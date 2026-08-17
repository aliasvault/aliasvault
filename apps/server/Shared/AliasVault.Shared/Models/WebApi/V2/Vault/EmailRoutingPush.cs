//-----------------------------------------------------------------------
// <copyright file="EmailRoutingPush.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// The email-routing set a vault push uploads: every alias the client wants routed, each carrying the manifest
/// that owns it. Aliases missing from a push are disabled, so a push always carries the complete set of the
/// manifests it covers (see <see cref="CoveredManifestIds"/>).
/// </summary>
public class EmailRoutingPush
{
    /// <summary>
    /// Gets or sets the claimed addresses, each with the manifest whose key encrypts its mail. The manifest ids
    /// are a request, not a grant: the server validates each against what the caller may claim for.
    /// </summary>
    public List<ClaimedEmailAddress> EmailAddressList { get; set; } = [];

    /// <summary>
    /// Gets or sets the manifests this push speaks for: every manifest the client opened to build the address list
    /// above, whether or not it holds any alias.
    /// </summary>
    public List<Guid> CoveredManifestIds { get; set; } = [];
}
