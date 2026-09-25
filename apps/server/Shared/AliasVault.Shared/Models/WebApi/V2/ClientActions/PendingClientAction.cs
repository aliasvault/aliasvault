//-----------------------------------------------------------------------
// <copyright file="PendingClientAction.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.ClientActions;

/// <summary>
/// A piece of generic work the server needs a client to carry out due to the E2EE model. This primarily affects vault sharing
/// and revocation actions.
/// </summary>
public class PendingClientAction
{
    /// <summary>Gets or sets the action id, the handle it is reported done by.</summary>
    public required Guid Id { get; set; }

    /// <summary>Gets or sets what has to be done, as a token (see the server's <c>ClientActionType</c>).</summary>
    public required string Type { get; set; }

    /// <summary>Gets or sets the manifest the action is about (optional).</summary>
    public Guid? ManifestId { get; set; }

    /// <summary>Gets or sets the optional action-specific parameters as raw JSON.</summary>
    public string? Payload { get; set; }
}
