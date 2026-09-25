//-----------------------------------------------------------------------
// <copyright file="PushStatus.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.VaultSync.Models;

/// <summary>
/// Outcome of a push.
/// </summary>
public enum PushStatus
{
    /// <summary>
    /// Every changed manifest and bucket was written, or nothing had changed.
    /// </summary>
    Ok,

    /// <summary>
    /// The server holds newer state (or the vault holds rows this session cannot write); pull, merge and retry.
    /// </summary>
    Outdated,

    /// <summary>
    /// The server still reports blobs missing after they were re-uploaded once.
    /// </summary>
    MissingBlobs,

    /// <summary>
    /// The vault failed structural validation and was not uploaded.
    /// </summary>
    Rejected,
}
