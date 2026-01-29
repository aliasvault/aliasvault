//-----------------------------------------------------------------------
// <copyright file="MobileLoginRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

using Microsoft.EntityFrameworkCore;

/// <summary>
/// Mobile login request entity for storing temporary login requests.
/// </summary>
[Index(nameof(RetrievedAt), nameof(ClearedAt), nameof(FulfilledAt), Name = "IX_RetrievedAt_ClearedAt_FulfilledAt")]
[Index(nameof(ClientIpAddress), Name = "IX_ClientIpAddress")]
[Index(nameof(MobileIpAddress), Name = "IX_MobileIpAddress")]
[Index(nameof(CreatedAt), Name = "IX_CreatedAt")]
[Index(nameof(UserId), Name = "IX_UserId")]
public class MobileLoginRequest
{
    /// <summary>
    /// Gets or sets the unique identifier for this login request.
    /// </summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the public key from the client (base64 encoded).
    /// </summary>
    public string ClientPublicKey { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the encrypted decryption key from the mobile app (base64 encoded).
    /// Will be null until mobile app responds.
    /// </summary>
    public string? EncryptedDecryptionKey { get; set; }

    /// <summary>
    /// Gets or sets the created timestamp.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the fulfilled timestamp (when mobile app submitted the response).
    /// </summary>
    public DateTime? FulfilledAt { get; set; }

    /// <summary>
    /// Gets or sets the retrieved timestamp (when client successfully retrieved and decrypted).
    /// </summary>
    public DateTime? RetrievedAt { get; set; }

    /// <summary>
    /// Gets or sets the timestamp when sensitive data was cleared from this record.
    /// Sensitive data (ClientPublicKey, EncryptedDecryptionKey, Salt, etc.) is cleared
    /// after a timeout period to minimize risk if server is compromised.
    /// </summary>
    public DateTime? ClearedAt { get; set; }

    /// <summary>
    /// Gets or sets the IP address of the client that initiated the request.
    /// </summary>
    public string? ClientIpAddress { get; set; }

    /// <summary>
    /// Gets or sets the IP address of the mobile device that fulfilled the request.
    /// </summary>
    public string? MobileIpAddress { get; set; }

    /// <summary>
    /// Gets or sets the user ID (foreign key to AliasVaultUser).
    /// Null when record is created, populated when mobile app fulfills the request.
    /// </summary>
    public string? UserId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the user.
    /// </summary>
    public virtual AliasVaultUser? User { get; set; }
}
