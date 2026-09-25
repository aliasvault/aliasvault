//-----------------------------------------------------------------------
// <copyright file="DeleteAccountRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V1.Auth;

/// <summary>
/// Request model for deleting an account.
/// </summary>
public class DeleteAccountRequest
{
    /// <summary>
    /// Initializes a new instance of the <see cref="DeleteAccountRequest"/> class.
    /// </summary>
    /// <param name="username">The username of the account to delete.</param>
    /// <param name="clientPublicEphemeral">The client public ephemeral of the account to delete.</param>
    /// <param name="clientSessionProof">The client session proof of the account to delete.</param>
    public DeleteAccountRequest(string username, string clientPublicEphemeral, string clientSessionProof)
    {
        Username = username;
        ClientPublicEphemeral = clientPublicEphemeral;
        ClientSessionProof = clientSessionProof;
    }

    /// <summary>
    /// Gets or sets the username of the account to delete.
    /// </summary>
    public string Username { get; set; }

    /// <summary>
    /// Gets or sets the client public ephemeral of the account to delete.
    /// </summary>
    public string ClientPublicEphemeral { get; set; }

    /// <summary>
    /// Gets or sets the client session proof of the account to delete.
    /// </summary>
    public string ClientSessionProof { get; set; }
}
