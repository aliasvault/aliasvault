//-----------------------------------------------------------------------
// <copyright file="FaviconUserUsage.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Services.RateLimiting.Models;

using System;
using System.Collections.Generic;

/// <summary>
/// The favicon extractions of one user within the rolling window of <see cref="FaviconRateLimitService"/>, counted per minute.
/// </summary>
internal sealed class FaviconUserUsage
{
    // One entry per minute instead of per extraction, so re-downloading thousands of favicons stays a few entries.
    private readonly LinkedList<(DateTime BucketStart, int Count)> _entries = new();

    /// <summary>
    /// Gets the lock a caller holds across Prune, the limit check and Add.
    /// </summary>
    public object SyncRoot { get; } = new object();

    /// <summary>
    /// Gets the number of extractions in the retained buckets.
    /// </summary>
    public int Total { get; private set; }

    /// <summary>
    /// Count <paramref name="count"/> extractions in the bucket of the minute of <paramref name="now"/>.
    /// </summary>
    /// <param name="now">The current UTC time.</param>
    /// <param name="count">The number of extractions.</param>
    public void Add(DateTime now, int count)
    {
        var bucket = new DateTime(now.Year, now.Month, now.Day, now.Hour, now.Minute, 0, DateTimeKind.Utc);

        if (_entries.Last is { Value.BucketStart: var lastBucket } lastNode && lastBucket == bucket)
        {
            _entries.Last.Value = (lastBucket, lastNode.Value.Count + count);
        }
        else
        {
            _entries.AddLast((bucket, count));
        }

        Total += count;
    }

    /// <summary>
    /// Drop the buckets that started before <paramref name="cutoff"/>.
    /// </summary>
    /// <param name="cutoff">The start of the window.</param>
    public void Prune(DateTime cutoff)
    {
        while (_entries.First is { Value.BucketStart: var first } node && first < cutoff)
        {
            Total -= node.Value.Count;
            _entries.RemoveFirst();
        }
    }
}
