//-----------------------------------------------------------------------
// <copyright file="MobileLoginRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;
using AliasVault.Shared.Models.Enums;
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
    /// Maximum length of the client description columns.
    /// </summary>
    public const int ClientDescriptionMaxLength = 100;

    /// <summary>
    /// Gets or sets the unique identifier for this login request.
    /// </summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the algorithm <see cref="ClientPublicKey"/> is for, which is what the mobile app must
    /// encrypt <see cref="EncryptedUnlockKey"/> with.
    /// </summary>
    [StringLength(30)]
    public VaultKeyAlgorithm Algorithm { get; set; } = VaultKeyAlgorithm.RsaOaepSha256;

    /// <summary>
    /// Gets or sets the public key from the client (base64 encoded).
    /// </summary>
    public string ClientPublicKey { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the SHA-256 hash (base64) of the poll secret that only the initiating client holds.
    /// </summary>
    [StringLength(44)]
    public string PollSecretHash { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the account unlock key from the mobile app, encrypted with <see cref="ClientPublicKey"/> (base64 encoded).
    /// Will be null until mobile app responds.
    /// </summary>
    public string? EncryptedUnlockKey { get; set; }

    /// <summary>
    /// Gets or sets the created timestamp.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the fulfilled timestamp (when mobile app submitted the response).
    /// </summary>
    public DateTime? FulfilledAt { get; set; }

    /// <summary>
    /// Gets or sets the declined timestamp (when the mobile app refused the request).
    /// </summary>
    public DateTime? DeclinedAt { get; set; }

    /// <summary>
    /// Gets or sets the retrieved timestamp (when client successfully retrieved and decrypted).
    /// </summary>
    public DateTime? RetrievedAt { get; set; }

    /// <summary>
    /// Gets or sets the timestamp when sensitive data was cleared from this record.
    /// Sensitive data (ClientPublicKey, EncryptedUnlockKey) is cleared
    /// after a timeout period to minimize risk if server is compromised.
    /// </summary>
    public DateTime? ClearedAt { get; set; }

    /// <summary>
    /// Gets or sets the IP address of the client that initiated the request.
    /// </summary>
    public string? ClientIpAddress { get; set; }

    /// <summary>
    /// Gets or sets the X-AliasVault-Client header of the client that initiated the request, e.g. "chrome-0.30.0".
    /// </summary>
    [StringLength(ClientDescriptionMaxLength)]
    public string? ClientName { get; set; }

    /// <summary>
    /// Gets or sets the browser of the client that initiated the request, derived from its user agent.
    /// </summary>
    [StringLength(ClientDescriptionMaxLength)]
    public string? ClientBrowser { get; set; }

    /// <summary>
    /// Gets or sets the operating system of the client that initiated the request, derived from its user agent.
    /// </summary>
    [StringLength(ClientDescriptionMaxLength)]
    public string? ClientOperatingSystem { get; set; }

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
