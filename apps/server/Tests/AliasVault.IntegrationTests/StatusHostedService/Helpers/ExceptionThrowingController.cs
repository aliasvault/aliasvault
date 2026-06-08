//-----------------------------------------------------------------------
// <copyright file="ExceptionThrowingController.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.IntegrationTests.StatusHostedService.Helpers;

/// <summary>
/// Controls the throwing of exceptions inside the StatusWorker.
/// </summary>
public sealed class ExceptionThrowingController
{
    private readonly HashSet<int> _throwOnCalls;
    private int _saveCount;

    /// <summary>
    /// Initializes a new instance of the <see cref="ExceptionThrowingController"/> class.
    /// </summary>
    /// <param name="throwOnCalls">The one-based save-call indexes on which to throw.</param>
    public ExceptionThrowingController(params int[] throwOnCalls)
    {
        _throwOnCalls = [.. throwOnCalls];
    }

    /// <summary>
    /// Records a save attempt and throws a <see cref="TaskCanceledException"/> when the current attempt
    /// index is one of the configured fault indexes.
    /// </summary>
    public void ThrowIfScheduled()
    {
        var current = Interlocked.Increment(ref _saveCount);
        if (_throwOnCalls.Contains(current))
        {
            throw new TaskCanceledException("Simulated transient database cancellation.");
        }
    }
}
