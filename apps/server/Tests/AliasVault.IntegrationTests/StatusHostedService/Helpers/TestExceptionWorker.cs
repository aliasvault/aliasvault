//-----------------------------------------------------------------------
// <copyright file="TestExceptionWorker.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.IntegrationTests.StatusHostedService.Helpers;

using Microsoft.Extensions.Hosting;

/// <summary>
/// A simple worker that throws an exception during task execution. This is used for testing purposes.
/// </summary>
public class TestExceptionWorker() : BackgroundService
{
    /// <inheritdoc/>
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromMilliseconds(100), stoppingToken);
        throw new Exception("Test exception");
    }
}
