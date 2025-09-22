//-----------------------------------------------------------------------
// <copyright file="AuthLog.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using AliasVault.Shared.Models.Enums;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Represents the reason for an authentication failure.
/// </summary>
public enum AuthFailureReason
{
    /// <summary>
    /// Indicates that the provided username was invalid or not found.
    /// </summary>
    InvalidUsername = 1,

    /// <summary>
    /// Indicates that the provided password was incorrect.
    /// </summary>
    InvalidPassword = 2,

    /// <summary>
    /// Indicates that the account is locked, possibly due to too many failed attempts.
    /// </summary>
    AccountLocked = 3,

    /// <summary>
    /// Indicates that the provided two-factor authentication code was invalid.
    /// </summary>
    InvalidTwoFactorCode = 4,

    /// <summary>
    /// Indicates that the provided account recovery code was invalid.
    /// </summary>
    InvalidRecoveryCode = 5,

    /// <summary>
    /// Indicates that the provided refresh token was invalid.
    /// </summary>
    InvalidRefreshToken = 6,

    /// <summary>
    /// Indicates that the account is manually blocked by an administrator.
    /// </summary>
    AccountBlocked = 7,

    /// <summary>
    /// Indicates that the failure reason was unknown.
    /// </summary>
    Unknown = 99,
}

/// <summary>
/// Represents an authentication log in the system.
/// </summary>
[Index(nameof(IpAddress), Name = "IX_IpAddress")]
[Index(nameof(Timestamp), Name = "IX_Timestamp")]
[Index(nameof(EventType), Name = "IX_EventType")]
[Index(nameof(Username), nameof(Timestamp), IsDescending = new[] { false, true }, Name = "IX_Username_Timestamp")]
[Index(nameof(Username), nameof(IsSuccess), nameof(Timestamp), IsDescending = new[] { false, false, true }, Name = "IX_Username_IsSuccess_Timestamp")]
public class AuthLog
{
    /// <summary>
    /// Gets or sets the unique identifier for the authentication log entry.
    /// </summary>
    [Key]
    public int Id { get; set; }

    /// <summary>
    /// Gets or sets the date and time when the authentication event occurred.
    /// </summary>
    [Required]
    public DateTime Timestamp { get; set; }

    /// <summary>
    /// Gets or sets the username associated with the authentication event.
    /// </summary>
    [Required]
    [MaxLength(255)]
    public string Username { get; set; } = null!;

    /// <summary>
    /// Gets or sets the type of authentication event (e.g., Login, Logout, FailedLogin).
    /// </summary>
    [Required]
    public AuthEventType EventType { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the authentication event was successful.
    /// This may be null for events where success is not applicable (e.g., Logout).
    /// </summary>
    public bool IsSuccess { get; set; }

    /// <summary>
    /// Gets or sets the reason for failure if the authentication event was unsuccessful.
    /// This is null for successful events or events where failure is not applicable.
    /// </summary>
    public AuthFailureReason? FailureReason { get; set; }

    /// <summary>
    /// Gets or sets the IP address from which the authentication event originated.
    /// </summary>
    [MaxLength(50)]
    public string? IpAddress { get; set; }

    /// <summary>
    /// Gets or sets the type of device used for the authentication event (e.g., Mobile, Desktop, Tablet).
    /// </summary>
    [MaxLength(100)]
    public string? DeviceType { get; set; }

    /// <summary>
    /// Gets or sets the operating system of the device used for the authentication event.
    /// </summary>
    [MaxLength(100)]
    public string? OperatingSystem { get; set; }

    /// <summary>
    /// Gets or sets the browser used for the authentication event.
    /// </summary>
    [MaxLength(100)]
    public string? Browser { get; set; }

    /// <summary>
    /// Gets or sets the country from which the authentication event originated.
    /// </summary>
    [MaxLength(50)]
    public string? Country { get; set; }

    /// <summary>
    /// Gets or sets additional information relevant to the authentication event.
    /// </summary>
    [MaxLength(255)]
    public string? AdditionalInfo { get; set; }

    /// <summary>
    /// Gets or sets the request path of the authentication event.
    /// </summary>
    [MaxLength(100)]
    public string? RequestPath { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the authentication event is flagged as suspicious activity.
    /// </summary>
    public bool IsSuspiciousActivity { get; set; }

    /// <summary>
    /// Gets or sets the client application name and version.
    /// </summary>
    [MaxLength(100)]
    public string? Client { get; set; }
}
