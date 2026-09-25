//-----------------------------------------------------------------------
// <copyright file="SrpValidationResult.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Models;

using AliasServerDb;
using SecureRemotePassword;

/// <summary>
/// The outcome of checking a client's SRP proof against the credentials of the unlock method it authenticates with.
/// </summary>
/// <param name="Session">The derived server session, or null when the proof did not validate.</param>
/// <param name="ActiveSessionFound">Whether a server ephemeral was still cached, i.e. whether the client actually initiated this exchange.</param>
/// <param name="UnlockKeyId">The unlock method whose secret was proven, or null for a legacy user that has no unlock key yet.</param>
public sealed record SrpValidationResult(SrpSession? Session, bool ActiveSessionFound, Guid? UnlockKeyId)
{
    /// <summary>
    /// Gets the reason to log when <see cref="Session"/> is null: a cached ephemeral means the client got the
    /// secret wrong, no ephemeral means it never initiated the exchange or took too long over it.
    /// </summary>
    public AuthFailureReason FailureReason => ActiveSessionFound ? AuthFailureReason.InvalidPassword : AuthFailureReason.SrpSessionNotFound;
}
