//-----------------------------------------------------------------------
// <copyright file="MobileLoginRequestHelper.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using AliasServerDb;

/// <summary>
/// Rules of the mobile login handshake that the endpoints share: the time windows, the poll secret and the client name.
/// </summary>
public static partial class MobileLoginRequestHelper
{
    /// <summary>
    /// How long the mobile app may approve or decline a request after it was created. Clients show a 2 minute countdown.
    /// </summary>
    public static readonly TimeSpan ApprovalWindow = TimeSpan.FromMinutes(3);

    /// <summary>
    /// How long the initiating client may collect an approved request after the approval.
    /// </summary>
    public static readonly TimeSpan RetrievalWindow = TimeSpan.FromMinutes(1);

    /// <summary>
    /// JSON options the encrypted poll payload is written with.
    /// </summary>
    public static readonly JsonSerializerOptions PayloadJsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// Hashes a poll secret for storage.
    /// </summary>
    /// <param name="pollSecret">The poll secret as handed to the initiating client.</param>
    /// <returns>Base64 SHA-256 hash of the secret.</returns>
    public static string HashPollSecret(string pollSecret) => Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(pollSecret)));

    /// <summary>
    /// Checks a presented poll secret against the stored hash in constant time.
    /// </summary>
    /// <param name="request">The mobile login request.</param>
    /// <param name="pollSecret">The poll secret the caller presented.</param>
    /// <returns>True when the secret belongs to the request.</returns>
    public static bool IsPollSecretValid(MobileLoginRequest request, string? pollSecret)
    {
        if (string.IsNullOrEmpty(pollSecret) || string.IsNullOrEmpty(request.PollSecretHash))
        {
            return false;
        }

        return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(HashPollSecret(pollSecret)), Encoding.UTF8.GetBytes(request.PollSecretHash));
    }

    /// <summary>
    /// Whether the time to approve or decline the request has passed.
    /// </summary>
    /// <param name="request">The mobile login request.</param>
    /// <param name="now">The current UTC time.</param>
    /// <returns>True when the request can no longer be answered.</returns>
    public static bool IsApprovalWindowClosed(MobileLoginRequest request, DateTime now) => request.CreatedAt.Add(ApprovalWindow) < now;

    /// <summary>
    /// Whether the time to collect an approved request has passed.
    /// </summary>
    /// <param name="request">The mobile login request.</param>
    /// <param name="now">The current UTC time.</param>
    /// <returns>True when the approval can no longer be collected.</returns>
    public static bool IsRetrievalWindowClosed(MobileLoginRequest request, DateTime now) => request.FulfilledAt == null || request.FulfilledAt.Value.Add(RetrievalWindow) < now;

    /// <summary>
    /// Whether the request still waits for the mobile app: not answered yet and not expired.
    /// </summary>
    /// <param name="request">The mobile login request.</param>
    /// <param name="now">The current UTC time.</param>
    /// <returns>True when the mobile app may still approve or decline.</returns>
    public static bool IsAwaitingApproval(MobileLoginRequest request, DateTime now) => request.FulfilledAt == null && request.DeclinedAt == null && !IsApprovalWindowClosed(request, now);

    /// <summary>
    /// Reduces the client header to something safe to show on the approval screen. The header is attacker-controlled free text.
    /// </summary>
    /// <param name="clientHeader">The raw X-AliasVault-Client header value.</param>
    /// <returns>The header when it has the expected "{client}-{version}" shape, otherwise null.</returns>
    public static string? SanitizeClientName(string? clientHeader) => clientHeader is not null && ClientNameRegex().IsMatch(clientHeader) ? clientHeader : null;

    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$")]
    private static partial Regex ClientNameRegex();
}
