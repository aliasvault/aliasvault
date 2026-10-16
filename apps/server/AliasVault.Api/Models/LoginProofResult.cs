//-----------------------------------------------------------------------
// <copyright file="LoginProofResult.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Models;

using AliasServerDb;
using AliasVault.Shared.Models.Enums;
using SecureRemotePassword;

/// <summary>
/// Outcome of checking a login's user state and SRP proof: the user and session on success, an error code otherwise.
/// </summary>
/// <param name="User">The user, set on success.</param>
/// <param name="ServerSession">The SRP server session, set on success.</param>
/// <param name="UnlockMethodId">The unlock method the proof was checked against; null for a legacy account.</param>
/// <param name="Error">The error code to answer with, null on success.</param>
public sealed record LoginProofResult(AliasVaultUser? User, SrpSession? ServerSession, Guid? UnlockMethodId, ApiErrorCode? Error);
