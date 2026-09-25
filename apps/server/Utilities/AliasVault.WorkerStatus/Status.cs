// -----------------------------------------------------------------------
// <copyright file="Status.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
// -----------------------------------------------------------------------

namespace AliasVault.WorkerStatus;

/// <summary>
/// Lifecycle states a worker service reports through its heartbeat record.
/// </summary>
public enum Status
{
    /// <summary>
    /// The host is up but not all workers are running (yet, or after a worker fault while it restarts).
    /// </summary>
    Starting,

    /// <summary>
    /// All workers are running.
    /// </summary>
    Started,

    /// <summary>
    /// The host shut down gracefully.
    /// </summary>
    Stopped,
}
