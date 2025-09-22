//-----------------------------------------------------------------------
// <copyright file="AuthLogModel.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.Security;

using AliasVault.Shared.Models.Enums;

/// <summary>
/// Auth Log model.
/// </summary>
public class AuthLogModel
{
    /// <summary>
    /// Gets or sets the primary key for the auth log entry.
    /// </summary>
    public int Id { get; set; }

    /// <summary>
    /// Gets or sets the timestamp of the auth log entry.
    /// </summary>
    public DateTime Timestamp { get; set; }

    /// <summary>
    /// Gets or sets the type of authentication event.
    /// </summary>
    public AuthEventType EventType { get; set; }

    /// <summary>
    /// Gets or sets the username associated with the auth log entry.
    /// </summary>
    public string Username { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the IP address from which the authentication attempt was made.
    /// </summary>
    public string IpAddress { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the client application name and version.
    /// </summary>
    public string Client { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets a value indicating whether the authentication attempt was successful.
    /// </summary>
    public bool IsSuccess { get; set; }
}
