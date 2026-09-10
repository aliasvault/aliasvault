//-----------------------------------------------------------------------
// <copyright file="PushResult.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.VaultSync.Models;

/// <summary>
/// Result of a push. Revision, fingerprint and blob bookkeeping happens inside the push; callers act on the status.
/// </summary>
/// <param name="Status">The outcome.</param>
/// <param name="Reasons">What went wrong, for the log.</param>
public sealed record PushResult(PushStatus Status, IReadOnlyList<string>? Reasons = null);
