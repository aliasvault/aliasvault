//-----------------------------------------------------------------------
// <copyright file="TestNoopWorker.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.IntegrationTests.StatusHostedService.Helpers;

using Microsoft.Extensions.Hosting;

/// <summary>
/// A worker that does nothing but stay running until it is cancelled. This is used to test that the
/// StatusWorker reaches and maintains the "Started" state under healthy worker conditions.
/// </summary>
public sealed class TestNoopWorker : BackgroundService
{
    /// <inheritdoc/>
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(Timeout.Infinite, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            // Expected when the worker is stopped.
        }
    }
}
